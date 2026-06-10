import { useEffect, useRef } from 'react';

import { useCapture } from '../capture/CaptureContext';
import { useAuth } from '../core/auth/AuthContext';
import { streamAgentChat } from '../core/api/agent.client';
import { useTranslations } from '../i18n';
import { speak } from '../tts/Tts';
import { listAgents } from '../agents/local-agent.model';
import { LocalAgentRuntime } from '../agents/LocalAgentRuntime';
import { recentTranscriptText } from '../db/outbox';
import { isWakeWordEnabled } from '../settings/settings-store';
import { flog } from '../core/filelog';
import type { WakeMatch } from './WakeWord';

/*
 * ── 24/7 wake-word flow: end-to-end trace ──────────────────────────────────
 *
 * GOAL: anywhere in the app (even backgrounded / screen off), saying
 * "Hey Killio" / "Oye Killio" / "Hey {agentName}" should chime "Te escucho",
 * start a FRESH conversation, then send whatever the human says next (when they
 * stop talking) and speak the agent's reply back.
 *
 * 1. CaptureController (the app-global capture FGS) streams on-device
 *    SpeechRecognizer transcripts 24/7 via handleTranscript(). For each final
 *    transcript it (a) enqueues it to the diary outbox, then (b) runs
 *    matchWake(text, agentNames). matchWake is intentionally lenient: the wake
 *    phrase only has to appear at/near the START of the utterance — a bare
 *    "Hey Killio" with no trailing command now matches (command === '').
 *
 * 2. On a match the controller fires onWakeCb(match) → this component's
 *    `onWake` (registered globally via CaptureContext.setOnWake in _layout, so
 *    it works regardless of which screen — if any — is focused).
 *
 * 3. onWake:
 *      - bails if busy or the master wake toggle (/settings) is off;
 *      - resets convId.current = undefined → the next streamAgentChat call has
 *        NO conversationId, so the backend creates a NEW conversation (a fresh
 *        chat, never appended to a prior one);
 *      - mutes capture and speaks the localized confirmation `wakeListener.heard`
 *        ("Te escucho" / "I'm listening"). Muting stops the chime from being
 *        re-recorded / re-matched as a wake.
 *      - When the chime's onFinish fires:
 *          • if the wake utterance ALREADY carried an inline command
 *            ("Hey Killio qué hora es") → send it immediately (one-shot);
 *          • else → unmute + arm command capture via setOnCommandUtterance.
 *
 * 4. Command capture (armed): the controller routes every subsequent non-wake
 *    transcript to onCommandUtterance(text). We accumulate the pieces and
 *    (re)start a silence timer on each one. When the human STOPS talking
 *    (no new transcript for SILENCE_MS) the timer fires sendCommand().
 *
 * 5. sendCommand(): disarms capture, prepends ~1 min of recent diary context,
 *    composes through the matched agent's LocalAgentRuntime (if any), then
 *    streamAgentChat({ conversationId: undefined }) → new conversation. The
 *    streamed reply is accumulated and, on done, spoken back via TTS (voice
 *    turn) with the agent's voice while capture stays muted; convId.current is
 *    set to the new id so a follow-up within the same wake session could reuse
 *    it (next wake resets it again).
 *
 * 6. A 60s watchdog (armed on wake) guarantees we always disarm + release busy
 *    even if a transcript/stream callback is dropped.
 */

/** How long the human can pause before we treat the command as finished. */
const SILENCE_MS = 1_800;
/** Absolute cap on a single wake session (chime + listen + reply). */
const SESSION_TIMEOUT_MS = 60_000;

/**
 * Headless wake-word handler. Mounted once, app-global (see app/_layout.tsx),
 * so wake works on any screen and while backgrounded.
 */
export function WakeListener() {
  const t = useTranslations('wakeListener');
  const { setOnWake, setOnCommandUtterance, setMuted, flushNow } = useCapture();
  const { activeTeam } = useAuth();

  // Mutable session state kept in refs so the long-lived controller callbacks
  // (registered once) always see the latest values without re-registering.
  const busy = useRef(false);
  const convId = useRef<string | undefined>(undefined);
  const matchedAgentName = useRef<string | undefined>(undefined);
  const commandParts = useRef<string[]>([]);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTeamId = useRef<string | undefined>(undefined);
  activeTeamId.current = activeTeam?.id;

  useEffect(() => {
    const clearTimers = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
      silenceTimer.current = null;
      sessionTimer.current = null;
    };

    const endSession = () => {
      setOnCommandUtterance(null);
      clearTimers();
      commandParts.current = [];
      matchedAgentName.current = undefined;
      busy.current = false;
    };

    const resolveAgent = (name?: string) =>
      name
        ? listAgents().find(
            (a) => (a.wakePhrase || a.name).toLowerCase() === name.toLowerCase(),
          ) ?? null
        : null;

    const sendCommand = async (command: string) => {
      const teamId = activeTeamId.current;
      const text = command.trim();
      flog('WakeFlow', `sendCommand text="${text.slice(0, 50)}" team=${!!teamId} agent=${matchedAgentName.current ?? '-'}`);
      if (!text || !teamId) {
        flog('WakeFlow', 'sendCommand BAIL (empty text or no team)');
        endSession();
        return;
      }
      // Stop listening for more command pieces while we answer.
      setOnCommandUtterance(null);
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = null;

      try {
        try {
          await flushNow();
        } catch {
          /* offline — agent still answers from what's on the server */
        }

        const agent = resolveAgent(matchedAgentName.current);
        const ctx = recentTranscriptText(60_000);
        const ctxPrefix = ctx ? `${t('recentContext', { text: ctx })}\n\n` : '';
        const base = agent
          ? await new LocalAgentRuntime(agent).composeMessage(text)
          : text;
        const message = ctxPrefix + base;

        let finalText = '';
        await streamAgentChat(
          {
            teamId,
            message,
            // NEW conversation: convId.current was reset to undefined on wake.
            conversationId: convId.current,
            entityType: 'vault',
          },
          {
            onDelta: (d) => {
              finalText += d;
            },
            onDone: ({ conversationId }) => {
              convId.current = conversationId;
              flog('WakeFlow', `stream done replyLen=${finalText.trim().length} → ${finalText.trim() ? 'speak reply' : 'empty, end'}`);
              if (finalText.trim()) {
                setMuted(true);
                void speak(finalText, {
                  language: agent?.voice ?? 'es-ES',
                  onFinish: () => {
                    setMuted(false);
                    endSession();
                  },
                  onError: () => {
                    setMuted(false);
                    endSession();
                  },
                });
              } else {
                endSession();
              }
            },
            onError: (e: unknown) => {
              flog('WakeFlow', `stream onError: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
              endSession();
            },
          },
        );
      } catch (e) {
        flog('WakeFlow', `sendCommand threw: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
        endSession();
      }
    };

    // Called for each non-wake transcript while armed (post-chime).
    const onCommandUtterance = (text: string) => {
      const piece = text.trim();
      if (!piece) return;
      flog('WakeFlow', `command piece: "${piece.slice(0, 40)}" (silence timer ${SILENCE_MS}ms)`);
      commandParts.current.push(piece);
      // Restart the "user stopped talking" timer on every new piece.
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        void sendCommand(commandParts.current.join(' '));
      }, SILENCE_MS);
    };

    const onWake = async (m: WakeMatch) => {
      flog('WakeFlow', `onWake agent=${m.agentName ?? '(killio)'} cmd="${m.command}" busy=${busy.current}`);
      if (busy.current) { flog('WakeFlow', 'BAIL busy'); return; }
      const enabled = await isWakeWordEnabled();
      if (!enabled) { flog('WakeFlow', 'BAIL wake toggle OFF (settings)'); return; }
      if (!activeTeamId.current) { flog('WakeFlow', 'BAIL no activeTeam'); return; }
      busy.current = true;

      // Fresh state for this wake session.
      clearTimers();
      commandParts.current = [];
      matchedAgentName.current = m.agentName;
      // NEW chat — never append to a prior conversation.
      convId.current = undefined;

      // Watchdog so a dropped callback can't wedge the listener forever.
      sessionTimer.current = setTimeout(endSession, SESSION_TIMEOUT_MS);

      const inlineCommand = m.command.trim();

      // Chime "Te escucho" first (mute capture so we don't record/match it).
      setMuted(true);
      flog('WakeFlow', `chime speak("${t('heard')}") start (TTS)`);
      await speak(t('heard'), {
        onStart: () => flog('WakeFlow', 'chime TTS onStart (audio playing)'),
        onFinish: () => {
          flog('WakeFlow', `chime done → ${inlineCommand ? 'inline cmd' : 'arm command capture'}`);
          setMuted(false);
          if (inlineCommand) {
            // One-shot: "Hey Killio, ¿qué hora es?" → answer immediately.
            void sendCommand(inlineCommand);
          } else {
            // Listen for what the human says next; send when they stop.
            setOnCommandUtterance(onCommandUtterance);
          }
        },
        onError: () => {
          flog('WakeFlow', 'chime TTS onError — proceeding anyway');
          setMuted(false);
          if (inlineCommand) void sendCommand(inlineCommand);
          else setOnCommandUtterance(onCommandUtterance);
        },
      });
    };

    setOnWake(onWake);
    return () => {
      setOnWake(null);
      setOnCommandUtterance(null);
      clearTimers();
      busy.current = false;
    };
  }, [setOnWake, setOnCommandUtterance, setMuted, flushNow, t]);

  return null;
}
