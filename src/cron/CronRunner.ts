import { streamAgentChat, type AgentChatBody } from '../core/api/agent.client';
import { getAccessToken, getActiveTeamId } from '../core/auth/token-store';
import { isDbAvailable } from '../db/sqlite';
import { runClientAction } from '../actions/ClientActions';
import { activeCronJobCount, dueCronJobs, markCronJobRan, type CronJob } from './cron.store';
import { ensureCronKeepAlive, releaseCronKeepAlive } from './CronKeepAlive';

/**
 * On-device scheduler for LOCAL cron jobs (saved recurring prompts).
 *
 * LOCAL-ONLY by design: this is a JS setInterval that only ticks WHILE THE VAULT
 * APP IS ALIVE (foreground or background-running). It is NOT a server cron — when
 * the app is fully closed/swapped-away, nothing fires. The cron_create tool
 * description and the backend prompt both state this so the assistant tells the
 * user.
 *
 * BACKGROUND SURVIVAL: the tick below is deliberately NOT gated on AppState —
 * it keeps firing when the app is backgrounded. BUT on Android the JS runtime is
 * only kept alive in the background while a FOREGROUND SERVICE (FGS) holds it.
 * Vault already runs a capture FGS (killio-speech / killio-capture) whenever
 * capture is ON, so cron rides on that for free. When capture is OFF but active
 * cron jobs exist, ensureCronKeepAlive() (see CronKeepAlive.ts) brings up an FGS
 * so the timer survives backgrounding; releaseCronKeepAlive() drops it once no
 * jobs remain. Without an FGS the OS suspends the timer shortly after the screen
 * turns off and jobs only catch up when the app is next foregrounded.
 *
 * Each tick: find active, due jobs (next_run_at <= now, runs_done < max_runs) and
 * fire each one's prompt to the assistant via the SAME streaming path the
 * assistant screen uses (streamAgentChat → /agent/chat/stream), targeting the
 * job's conversation_id so the AI responds in that conversation. Client actions
 * the AI requests during a cron run are executed autonomously (no UI confirm —
 * cron is unattended) so the turn can finalize. Everything is wrapped in
 * try/catch per job; a failing job never crashes the app and is still advanced
 * to its next run so it doesn't hot-loop.
 */

const TICK_MS = 45_000; // ~45s — cron resolution is per-minute, so this is safe.

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/** Start the scheduler. Idempotent. No-op when the native DB is unavailable. */
export function startCronRunner(): void {
  if (timer) return;
  if (!isDbAvailable()) return; // Expo Go / no native SQLite — nothing to schedule.
  // Kick once shortly after start (catches jobs already overdue from a prior
  // session), then on a steady interval.
  timer = setInterval(() => void tick(), TICK_MS);
  setTimeout(() => void tick(), 5_000);
}

export function stopCronRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Drop any cron-owned FGS so we don't leak a notification when the scheduler
  // stops (e.g. app teardown). No-op if capture owns the service.
  void releaseCronKeepAlive();
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    // Keep an FGS up iff there are active jobs, so the timer survives the screen
    // turning off (see header). Cheap COUNT; wrapped so it never breaks the tick.
    try {
      if (activeCronJobCount() > 0) void ensureCronKeepAlive();
      else void releaseCronKeepAlive();
    } catch {
      /* keep-alive is best-effort; never block the tick on it */
    }

    let jobs: CronJob[] = [];
    try {
      jobs = dueCronJobs(Date.now());
    } catch {
      return; // DB hiccup — try again next tick.
    }
    if (jobs.length === 0) return;

    // Need an authed team to talk to the agent. If we can't resolve one, leave
    // the jobs due and retry next tick (the user may still be signing in).
    const [teamId, token] = await Promise.all([getActiveTeamId(), getAccessToken()]);
    if (!teamId || !token) return;

    for (const job of jobs) {
      const firedAt = Date.now();
      try {
        await runCronJob(job, teamId);
      } catch (e) {
        try {
          // eslint-disable-next-line no-console
          console.warn('[CronRunner] job failed', job.id, (e as Error)?.message);
        } catch {
          /* noop */
        }
      } finally {
        // Always advance the job (even on failure) so a broken prompt can't
        // hot-loop every tick. Deactivates automatically when the cap is hit.
        try {
          markCronJobRan(job, firedAt);
        } catch {
          /* noop */
        }
      }
    }
  } finally {
    ticking = false;
  }
}

/**
 * Fire one job's prompt to the assistant and drive the turn to completion,
 * resolving any client actions autonomously. Resolves when the stream is done
 * or errors. The reply lands in the job's conversation_id.
 */
function runCronJob(job: CronJob, teamId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const body: AgentChatBody = {
      teamId,
      message: job.prompt,
      conversationId: job.conversation_id ?? undefined,
      entityType: 'vault',
    };

    // pendingMessageId of the paused "waiting" bubble, so a client-action resume
    // updates that bubble in place instead of inserting a second one.
    let pendingMessageId: string | undefined;
    let convId: string | undefined = job.conversation_id ?? undefined;
    // The backend emits `client_action` immediately followed by `done` when it
    // pauses a turn for a device action. So when a client action is pending we
    // must NOT settle on that `done` — the resume stream continues the turn.
    let clientActionPending = false;

    const handleClientAction = async (e: { id: string; tool: string; input: Record<string, unknown> }) => {
      clientActionPending = true;
      try {
        // Cron jobs are unattended — run the action directly (no confirm dialog).
        const result = await runClientAction(e.tool, e.input);
        await resume({ id: e.id, tool: e.tool, success: result.success, output: result.output, error: result.error });
      } catch (err) {
        await resume({ id: e.id, tool: e.tool, success: false, error: (err as Error)?.message ?? 'client action failed' });
      }
    };

    const resume = (clientActionResult: NonNullable<AgentChatBody['clientActionResult']>) =>
      streamAgentChat(
        {
          ...body,
          conversationId: convId,
          clientActionResult: { ...clientActionResult, pendingMessageId },
        },
        streamHandlers,
      ).catch(() => finish());

    const streamHandlers = {
      onClientAction: (e: { id: string; tool: string; input: Record<string, unknown> }) =>
        void handleClientAction(e),
      onDone: (e: { conversationId: string; messageId: string }) => {
        convId = e.conversationId;
        pendingMessageId = e.messageId;
        if (clientActionPending) {
          // This `done` just paused the turn for a device action; the resume
          // stream (kicked off by handleClientAction) will carry the real end.
          clientActionPending = false;
          return;
        }
        finish();
      },
      onError: () => finish(),
    };

    // streamAgentChat returns a handle but resolves immediately; the handlers
    // above drive completion. Guard the kickoff itself.
    void streamAgentChat(body, streamHandlers).catch(() => finish());
  });
}
