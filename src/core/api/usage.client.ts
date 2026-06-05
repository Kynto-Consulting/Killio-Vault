import { api } from './http';

export interface AiUsage {
  teamId: string;
  periodStart: string; // YYYY-MM-DD (month start)
  creditsUsed: number;
  tokensUsed: number;
  limit: number;
  remaining: number;
  myCreditsUsed: number;
}

/** Monthly AI usage for the team (GET /ai/team/:teamId/usage). */
export async function getUsage(teamId: string): Promise<AiUsage> {
  const { data } = await api.get<AiUsage>(`/ai/team/${teamId}/usage`);
  return data;
}

/** First day of the month AFTER periodStart — when usage resets. */
export function resetDate(periodStart: string): Date {
  const [y, m] = periodStart.split('-').map(Number);
  // m is 1-based; next month rolls the year over automatically via Date.
  return new Date(y, m, 1);
}

export function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
