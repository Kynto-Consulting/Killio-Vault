import { api } from './http';

/** Providers the backend has env-configured (OAuth ready / manual). */
export async function getConfigured(): Promise<string[]> {
  const { data } = await api.get<{ providers?: string[] }>('/integrations/configured');
  return data.providers ?? [];
}

/**
 * Connected providers for the user's personal scope. Reuses the agent endpoint
 * which resolves scope + returns the connected provider_types.
 */
export async function getConnectedProviders(teamId: string): Promise<string[]> {
  const { data } = await api.get<{ providers?: string[] }>(
    '/agent/integrations/available',
    { params: { teamId } },
  );
  return data.providers ?? [];
}

/** OAuth connect URL for a provider; open it in the browser to authorize. */
export async function getConnectUrl(
  teamId: string,
  connectPath: string,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/integrations/${teamId}/${connectPath}/connect-url`,
  );
  return data.url;
}

/** Saves a manual-credential integration (Slack/WhatsApp/Stripe/MercadoPago). */
export async function saveManualCredential(
  teamId: string,
  manualPath: string,
  body: Record<string, string>,
): Promise<void> {
  await api.post(`/integrations/${teamId}/${manualPath}`, body);
}
