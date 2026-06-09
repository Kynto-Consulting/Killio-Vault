/**
 * Vault integration catalog. Mirrors Killio-Frontend
 * src/lib/integrations/integration-catalog.ts (keep id/provider in sync with the
 * backend). `icon` is a lucide name (rendered via lucide-react-native, same set
 * the web app uses). `color` matches the web pills.
 */
export type IntegrationKind = 'oauth' | 'manual' | 'device' | 'pair' | 'soon';

export interface ManualField {
  key: string;
  label: string;
  secret?: boolean;
}

export interface VaultIntegration {
  id: string;
  provider: string;
  name: string;
  icon: string; // lucide icon name (kebab-case)
  color: string;
  category: string;
  kind: IntegrationKind;
  /** OAuth: GET /integrations/{teamId}/{connectPath}/connect-url → { url } */
  connectPath?: string;
  /** Manual: POST /integrations/{teamId}/{manualPath} with the fields below. */
  manualPath?: string;
  manualFields?: ManualField[];
  /** device: the OS permission this grants (drives the connect button). */
  devicePermission?: 'calendar' | 'contacts' | 'location';
}

export const CATALOG: VaultIntegration[] = [
  // ── Device (no OAuth — granted by an OS permission, work via Vault) ──────────
  { id: 'device_calendar', provider: 'device_calendar', name: 'Calendario', icon: 'calendar', color: '#4285f4', category: 'calendar', kind: 'device', devicePermission: 'calendar' },
  { id: 'device_contacts', provider: 'device_contacts', name: 'Contactos', icon: 'contact', color: '#22c55e', category: 'device', kind: 'device', devicePermission: 'contacts' },
  { id: 'device_location', provider: 'device_location', name: 'Ubicación', icon: 'map-pin', color: '#ef4444', category: 'device', kind: 'device', devicePermission: 'location' },

  // ── OAuth (cloud, via the existing backend integration endpoints) ───────────
  { id: 'github', provider: 'github', name: 'GitHub', icon: 'github', color: '#8b949e', category: 'dev', kind: 'oauth', connectPath: 'github' },
  { id: 'google_drive', provider: 'google_drive', name: 'Google Drive', icon: 'hard-drive', color: '#1a73e8', category: 'storage', kind: 'oauth', connectPath: 'google-drive' },
  { id: 'onedrive', provider: 'onedrive', name: 'OneDrive', icon: 'cloud', color: '#0364b8', category: 'storage', kind: 'oauth', connectPath: 'onedrive' },
  { id: 'notion', provider: 'notion', name: 'Notion', icon: 'file-text', color: '#cfcfcf', category: 'productivity', kind: 'oauth', connectPath: 'notion' },
  { id: 'trello', provider: 'trello', name: 'Trello', icon: 'trello', color: '#0079bf', category: 'productivity', kind: 'oauth', connectPath: 'trello' },

  // ── Manual credentials ──────────────────────────────────────────────────────
  {
    id: 'slack', provider: 'slack_webhook', name: 'Slack', icon: 'slack', color: '#4a154b', category: 'communication', kind: 'manual',
    manualPath: 'slack/webhook-credentials',
    manualFields: [
      { key: 'name', label: 'Nombre' },
      { key: 'webhookUrl', label: 'Webhook URL' },
    ],
  },
  {
    id: 'whatsapp_business', provider: 'whatsapp', name: 'WhatsApp Business', icon: 'message-circle', color: '#25d366', category: 'communication', kind: 'manual',
    manualPath: 'whatsapp/credentials',
    manualFields: [
      { key: 'name', label: 'Nombre' },
      { key: 'phoneNumberId', label: 'Phone Number ID' },
      { key: 'accessToken', label: 'Access Token', secret: true },
    ],
  },
  // WhatsApp Personal: Baileys bridge with PAIRING CODE flow (8-digit code the
  // user enters in WhatsApp → Linked devices → Link with phone number). The
  // dedicated screen "/whatsapp-pair" handles input + polling — no QR scan
  // needed, fully mobile-native.
  {
    id: 'whatsapp_personal', provider: 'whatsapp_personal', name: 'WhatsApp (personal)', icon: 'message-circle', color: '#128c7e', category: 'communication', kind: 'pair',
  },
  {
    id: 'stripe', provider: 'stripe', name: 'Stripe', icon: 'credit-card', color: '#635bff', category: 'payments', kind: 'manual',
    manualPath: 'payments/stripe/credentials',
    manualFields: [
      { key: 'name', label: 'Nombre' },
      { key: 'publishableKey', label: 'Publishable Key' },
      { key: 'secretKey', label: 'Secret Key', secret: true },
    ],
  },
  {
    id: 'mercadopago', provider: 'mercadopago', name: 'Mercado Pago', icon: 'circle-dollar-sign', color: '#00b1ea', category: 'payments', kind: 'manual',
    manualPath: 'payments/mercadopago/credentials',
    manualFields: [
      { key: 'name', label: 'Nombre' },
      { key: 'accessToken', label: 'Access Token', secret: true },
    ],
  },

  // ── Coming soon (OAuth backend service pending app credentials) ─────────────
  { id: 'google_calendar', provider: 'google_calendar', name: 'Google Calendar', icon: 'calendar-days', color: '#4285f4', category: 'calendar', kind: 'soon' },
  { id: 'gmail', provider: 'gmail', name: 'Gmail', icon: 'mail', color: '#ea4335', category: 'communication', kind: 'soon' },
  // Spotify works out of the box: background SEARCH via the backend Spotify Web
  // API (client-credentials) + play/open/transport via the device. No per-user
  // connect step needed, so it's a "device"-kind capability, not "soon".
  { id: 'spotify', provider: 'spotify', name: 'Spotify', icon: 'music', color: '#1db954', category: 'media', kind: 'device' },
  { id: 'google_tasks', provider: 'google_tasks', name: 'Google Tasks', icon: 'list-checks', color: '#4285f4', category: 'productivity', kind: 'soon' },
  { id: 'todoist', provider: 'todoist', name: 'Todoist', icon: 'list-todo', color: '#e44332', category: 'productivity', kind: 'soon' },
  { id: 'n8n', provider: 'n8n', name: 'n8n', icon: 'workflow', color: '#ea4b71', category: 'automation', kind: 'soon' },
];
