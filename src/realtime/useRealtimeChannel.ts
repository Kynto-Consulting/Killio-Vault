import { useEffect, useRef } from 'react';

import { subscribePulse } from './pulse';

/**
 * Subscribe a component to a Pulse channel. The `eventMap` keys are the
 * server event names; values are the latest callback for each. Callbacks are
 * stored in a ref so re-renders don't churn the subscription. Returns nothing
 * — the channel is auto-released when the component unmounts.
 *
 * Pass `enabled: false` (or `channelName: null`) to skip the connection while
 * dependencies are still loading (e.g. teamId, docId).
 */
export interface RealtimeChannelOptions {
  enabled?: boolean;
  /** Map of event name → handler. */
  events: Record<string, (payload: unknown) => void>;
  /** Optional presence callback ({ event: 'join'|'leave'|'sync', ... }). */
  onPresence?: (event: {
    event: 'join' | 'leave' | 'sync';
    userId?: string;
    metadata?: Record<string, unknown>;
    users?: Array<{ userId: string; metadata?: Record<string, unknown> }>;
  }) => void;
}

export function useRealtimeChannel(
  channelName: string | null,
  options: RealtimeChannelOptions,
): void {
  const eventsRef = useRef(options.events);
  const presenceRef = useRef(options.onPresence);
  eventsRef.current = options.events;
  presenceRef.current = options.onPresence;

  const enabled = !!channelName && options.enabled !== false;

  useEffect(() => {
    if (!enabled || !channelName) return;
    const { channel, release } = subscribePulse(channelName);
    const disposers: Array<() => void> = [];
    // Hook every event listed in the map. We dispatch through the ref so
    // changing callbacks doesn't require re-subscribing.
    for (const event of Object.keys(eventsRef.current)) {
      disposers.push(
        channel.on(event, (payload) => {
          eventsRef.current[event]?.(payload);
        }),
      );
    }
    if (presenceRef.current) {
      disposers.push(channel.onPresence((e) => presenceRef.current?.(e)));
    }
    return () => {
      for (const d of disposers) d();
      release();
    };
    // We intentionally only re-run when the channel name or enabled flag
    // change — listener identity is funnelled through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled]);
}
