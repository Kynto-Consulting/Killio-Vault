import { api } from './http';

export interface PairCodeResp {
  code: string; // formatted XXXX-XXXX
  expiresInSec?: number;
}
export interface WaStatus {
  connected: boolean;
  phone: string | null;
}

/** Request a Baileys pairing code (8 digits). User enters it in WhatsApp. */
export async function requestPairCode(teamId: string, phone: string): Promise<PairCodeResp> {
  const { data } = await api.post<PairCodeResp>(
    `/integrations/${teamId}/whatsapp/personal/pair-code`,
    { phone },
  );
  return data;
}

/** Poll connection status — flip "Connected" badge once Baileys reports up. */
export async function getStatus(teamId: string): Promise<WaStatus> {
  const { data } = await api.get<WaStatus>(`/integrations/${teamId}/whatsapp/personal/status`);
  return data;
}

export async function disconnect(teamId: string): Promise<void> {
  await api.post(`/integrations/${teamId}/whatsapp/personal/disconnect`);
}
