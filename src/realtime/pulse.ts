import { API_BASE_URL } from '@/core/api/config';
import { api } from '@/core/api/http';

/**
 * Vault port of the web `pulse-realtime-provider`. Connects to the same
 * Kynto Pulse WebSocket worker the Killio frontend uses so live updates on
 * rooms (chat) and documents (collaborative brick edits) work 1:1 between
 * the two clients.
 *
 * Wire format (kept identical to the web):
 *   ← server  { event, payload }
 *   ← server  { type: 'presence', event: 'join'|'leave'|'sync', userId, users? }
 *   ← server  { type: 'system' | 'error', ... }
 *   → client  { type: 'pulse', event: 'ping', ts }                 (heartbeat)
 *   → client  { event, payload }                                    (publish)
 */

const HEARTBEAT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface PresenceMember {
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface PresenceEvent {
  event: 'join' | 'leave' | 'sync';
  userId?: string;
  metadata?: Record<string, unknown>;
  users?: PresenceMember[];
}

export type ChannelEventListener = (payload: unknown) => void;
export type ChannelWildcardListener = (event: string, payload: unknown) => void;
export type PresenceListener = (event: PresenceEvent) => void;

interface PulseMessage {
  event?: string;
  payload?: unknown;
  type?: 'presence' | 'system' | 'error';
  userId?: string;
  metadata?: Record<string, unknown>;
  users?: Array<{ userId: string; metadata?: Record<string, unknown> }>;
}

const baseUrl = (() => {
  // Worker URL is shared with the web client: same default, overridable via
  // EXPO_PUBLIC_PULSE_WORKER_URL (or expoConfig.extra.pulseWorkerUrl).
  const env = (process.env.EXPO_PUBLIC_PULSE_WORKER_URL as string | undefined) ?? '';
  return env || 'https://websockets.kynto.workers.dev';
})();

async function fetchChannelToken(channel: string): Promise<string> {
  const { data } = await api.get<{ token: string; channelName: string; expiresIn: number }>(
    '/pulse/auth',
    { params: { channel } },
  );
  return data.token;
}

class PulseChannel {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<ChannelEventListener>>();
  private readonly allListeners = new Set<ChannelWildcardListener>();
  private readonly presenceListeners = new Set<PresenceListener>();
  private readonly presence = new Map<string, PresenceMember>();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  /** Promise of the in-flight connect so multiple `connect()` calls share one socket. */
  private connecting: Promise<void> | null = null;

  constructor(private readonly channelName: string) {}

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.connecting = (async () => {
      try {
        const token = await fetchChannelToken(this.channelName);
        const wsBase = baseUrl.replace(/^http/, 'ws');
        const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => {
          this.reconnectAttempt = 0;
          this.startHeartbeat();
        };
        ws.onmessage = (evt) => this.handleMessage(String(evt.data ?? ''));
        ws.onclose = () => {
          this.stopHeartbeat();
          if (!this.intentionalClose) this.scheduleReconnect();
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* swallow */
          }
        };
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  /** Subscribe to a single named event. Returns a disposer. */
  on(eventName: string, cb: ChannelEventListener): () => void {
    const set = this.listeners.get(eventName) ?? new Set();
    set.add(cb);
    this.listeners.set(eventName, set);
    return () => {
      set.delete(cb);
    };
  }

  /** Subscribe to every event on this channel. */
  onAll(cb: ChannelWildcardListener): () => void {
    this.allListeners.add(cb);
    return () => {
      this.allListeners.delete(cb);
    };
  }

  /** Subscribe to presence (join/leave/sync). */
  onPresence(cb: PresenceListener): () => void {
    this.presenceListeners.add(cb);
    return () => {
      this.presenceListeners.delete(cb);
    };
  }

  /** Snapshot of the current presence set. */
  presenceMembers(): PresenceMember[] {
    return Array.from(this.presence.values());
  }

  publish(event: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    }
  }

  close(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* swallow */
      }
      this.ws = null;
    }
    this.listeners.clear();
    this.allListeners.clear();
    this.presenceListeners.clear();
    this.presence.clear();
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: PulseMessage;
    try {
      msg = JSON.parse(raw) as PulseMessage;
    } catch {
      return;
    }
    if (msg.type === 'presence') {
      this.handlePresence(msg);
      return;
    }
    if (msg.type === 'system' || msg.type === 'error') return;
    const event = msg.event;
    if (!event) return;
    const payload = msg.payload;
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(payload);
        } catch {
          /* swallow listener errors */
        }
      }
    }
    for (const cb of this.allListeners) {
      try {
        cb(event, payload);
      } catch {
        /* swallow */
      }
    }
  }

  private handlePresence(msg: PulseMessage): void {
    const ev = (msg as { event?: string }).event;
    if (ev === 'sync' && Array.isArray(msg.users)) {
      this.presence.clear();
      for (const u of msg.users) this.presence.set(u.userId, u);
    } else if (ev === 'join' && msg.userId) {
      this.presence.set(msg.userId, { userId: msg.userId, metadata: msg.metadata });
    } else if (ev === 'leave' && msg.userId) {
      this.presence.delete(msg.userId);
    }
    const presenceEvt: PresenceEvent = {
      event: (ev as 'join' | 'leave' | 'sync') ?? 'sync',
      userId: msg.userId,
      metadata: msg.metadata,
      users: msg.users,
    };
    for (const cb of this.presenceListeners) {
      try {
        cb(presenceEvt);
      } catch {
        /* swallow */
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'pulse', event: 'ping', ts: Date.now() }));
        } catch {
          /* swallow */
        }
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(8, this.reconnectAttempt),
    );
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }
}

// ─── Singleton-ish channel registry ──────────────────────────────────────────

const CHANNELS = new Map<string, PulseChannel>();
const REFCOUNT = new Map<string, number>();

export function getPulseChannel(channelName: string): PulseChannel {
  let ch = CHANNELS.get(channelName);
  if (!ch) {
    ch = new PulseChannel(channelName);
    CHANNELS.set(channelName, ch);
  }
  return ch;
}

/**
 * Reference-counted subscribe — returns the channel so a consumer can call
 * `.on(...)` and a `release()` that closes the channel when the last
 * subscriber goes away.
 */
export function subscribePulse(channelName: string): {
  channel: PulseChannel;
  release(): void;
} {
  const channel = getPulseChannel(channelName);
  REFCOUNT.set(channelName, (REFCOUNT.get(channelName) ?? 0) + 1);
  void channel.connect();
  return {
    channel,
    release: () => {
      const next = (REFCOUNT.get(channelName) ?? 1) - 1;
      if (next <= 0) {
        REFCOUNT.delete(channelName);
        CHANNELS.delete(channelName);
        channel.close();
      } else {
        REFCOUNT.set(channelName, next);
      }
    },
  };
}

void API_BASE_URL;
