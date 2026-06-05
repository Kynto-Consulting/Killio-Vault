import { useEffect, useRef } from 'react';

import { useCapture } from '../capture/CaptureContext';
import { useAuth } from '../core/auth/AuthContext';
import { streamAgentChat } from '../core/api/agent.client';
import { speak } from '../tts/Tts';
import { listAgents } from '../agents/local-agent.model';
import { LocalAgentRuntime } from '../agents/LocalAgentRuntime';
import { recentTranscriptText } from '../db/outbox';
import type { WakeMatch } from './WakeWord';

/**
 * Headless wake-word handler. When "Hey Killio …" (or "Hey {agent} …") is heard
 * in the live transcript, it routes the spoken command to the matched agent and
 * speaks the reply with that agent's voice — hands-free, screen locked.
 */
export function WakeListener() {
  const { setOnWake, setMuted, flushNow } = useCapture();
  const { personalTeam } = useAuth();
  const busy = useRef(false);
  const convId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const releaseBusy = () => {
      busy.current = false;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };

    const handler = async (m: WakeMatch) => {
      if (busy.current) return;
      const command = m.command.trim();
      if (!command || !personalTeam?.id) return; // wake with no command → ignore
      busy.current = true;
      // Safety: never leave the listener locked for more than 60s — a missed
      // onDone/onError would otherwise block subsequent wake invocations.
      timeout = setTimeout(releaseBusy, 60_000);
      try {
        const agent = m.agentName
          ? listAgents().find(
              (a) =>
                (a.wakePhrase || a.name).toLowerCase() === m.agentName!.toLowerCase(),
            ) ?? null
          : null;

        try {
          await flushNow();
        } catch {
          /* offline */
        }

        const ctx = recentTranscriptText(60_000);
        const ctxPrefix = ctx
          ? `Contexto reciente (último minuto): "${ctx}"\n\n`
          : '';
        const base = agent
          ? await new LocalAgentRuntime(agent).composeMessage(command)
          : command;
        const message = ctxPrefix + base;

        let finalText = '';
        await streamAgentChat(
          {
            teamId: personalTeam.id,
            message,
            conversationId: convId.current,
            entityType: 'vault',
          },
          {
            onDelta: (t) => {
              finalText += t;
            },
            onDone: ({ conversationId }) => {
              convId.current = conversationId;
              if (finalText.trim()) {
                setMuted(true);
                void speak(finalText, {
                  language: agent?.voice ?? 'es-ES',
                  onFinish: () => {
                    setMuted(false);
                    releaseBusy();
                  },
                });
              } else {
                releaseBusy();
              }
            },
            onError: () => {
              releaseBusy();
            },
          },
        );
      } catch {
        releaseBusy();
      }
    };

    setOnWake(handler);
    return () => {
      setOnWake(null);
      releaseBusy();
    };
  }, [setOnWake, setMuted, flushNow, personalTeam?.id]);

  return null;
}
