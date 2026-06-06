/**
 * PAR-01 — Realtime provider abstraction
 *
 * Vendor-agnostic interfaces for pub/sub channels and presence.
 * Swap the underlying WebSocket library by providing a different IRealtimeProvider
 * implementation — no hook or component changes required.
 */

// ─── Presence ────────────────────────────────────────────────────────────────

export interface PresenceMemberData {
  displayName: string;
  email: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  status?: "online" | "in-call";
  avatarColor?: string;
}

export interface PresenceMember {
  clientId: string;
  data: PresenceMemberData;
}

// ─── Channel ─────────────────────────────────────────────────────────────────

export type MessageListener = (message: { name: string; data: unknown; clientId?: string }) => void;
export type PresenceAction = "enter" | "leave" | "update";
export type PresenceListener = (member: PresenceMember) => void;

export interface IRealtimeChannel {
  /** Subscribe to a named event. */
  subscribe(eventName: string, listener: MessageListener): void;
  /** Subscribe to all events. */
  subscribeAll(listener: MessageListener): void;
  /** Unsubscribe a named-event listener. */
  unsubscribe(eventName: string, listener: MessageListener): void;
  /** Unsubscribe an all-events listener. */
  unsubscribeAll(listener: MessageListener): void;
  /** Publish an event. */
  publish(eventName: string, data: unknown): Promise<void>;

  // ── Presence ──────────────────────────────────────────────────────────────
  presence: {
    enter(data: PresenceMemberData): Promise<void>;
    leave(): Promise<void>;
    update(data: PresenceMemberData): Promise<void>;
    get(): Promise<PresenceMember[]>;
    subscribe(action: PresenceAction | PresenceAction[], listener: PresenceListener): void;
    unsubscribe(action?: PresenceAction | PresenceAction[], listener?: PresenceListener): void;
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface IRealtimeProvider {
  /** Get (or create) a channel by name. Channels are cached per-name. */
  getChannel(name: string): IRealtimeChannel;
  /** Gracefully disconnect and clean up all channels. */
  disconnect(): void;
}
