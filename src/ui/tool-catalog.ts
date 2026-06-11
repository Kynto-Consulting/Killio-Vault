/**
 * Tool catalog (icon + i18n key) shared 1:1 with Killio-Frontend
 * (src/lib/agent-tool-catalog.ts).
 *
 * All keys live under the FRONTEND-CANONICAL i18n namespace
 * `common.agent.toolAction.*` so the SAME conversation history renders
 * identically in the web chat and the Vault chat.
 *
 * Vault's local i18n mirrors this under namespace `agentTool` (without the
 * "common.agent." prefix); update both when adding a tool here.
 */
export interface ToolMeta {
  /** Lucide icon name (kebab-case — matches lucide-react / lucide-react-native). */
  icon: string;
  /** i18n key under "agent.toolAction.<key>". */
  i18nKey: string;
}

export const TOOL_CATALOG: Record<string, ToolMeta> = {
  // ─── Vault / mobile ───────────────────────────────────────────────────────
  tts_search: { icon: 'search', i18nKey: 'ttsSearch' },
  document_search_keyword: { icon: 'search', i18nKey: 'docSearchKeyword' },
  vault_disconnect: { icon: 'phone-off', i18nKey: 'vaultDisconnect' },
  vault_upload_screenshot: { icon: 'image-up', i18nKey: 'vaultUploadScreenshot' },
  calendar_list_events: { icon: 'calendar', i18nKey: 'calendarList' },
  calendar_create_event: { icon: 'calendar-plus', i18nKey: 'calendarCreate' },
  contacts_search: { icon: 'contact', i18nKey: 'contactsSearch' },
  get_location: { icon: 'map-pin', i18nKey: 'getLocation' },
  send_sms: { icon: 'message-square', i18nKey: 'sendSms' },
  call_number: { icon: 'phone', i18nKey: 'callNumber' },
  open_browser: { icon: 'globe', i18nKey: 'openBrowser' },
  open_app: { icon: 'square-arrow-out-up-right', i18nKey: 'openApp' },
  save_memory: { icon: 'sparkles', i18nKey: 'saveMemory' },
  search_memory: { icon: 'sparkles', i18nKey: 'searchMemory' },
  list_memory: { icon: 'sparkles', i18nKey: 'listMemory' },
  read_memory: { icon: 'sparkles', i18nKey: 'readMemory' },
  // Local integrations
  spotify_play: { icon: 'play', i18nKey: 'spotifyPlay' },
  spotify_open: { icon: 'external-link', i18nKey: 'spotifyOpen' },
  spotify_pause: { icon: 'pause', i18nKey: 'spotifyPause' },
  spotify_next: { icon: 'arrow-right', i18nKey: 'spotifyNext' },
  spotify_previous: { icon: 'arrow-left', i18nKey: 'spotifyPrevious' },
  spotify_search: { icon: 'search', i18nKey: 'spotifySearch' },
  spotify_current: { icon: 'music', i18nKey: 'spotifyCurrent' },
  whatsapp_message: { icon: 'message-circle', i18nKey: 'whatsappSend' },
  whatsapp_call: { icon: 'phone', i18nKey: 'whatsappCall' },
  whatsapp_personal_send_message: { icon: 'message-circle', i18nKey: 'whatsappSend' },
  whatsapp_personal_send: { icon: 'message-circle', i18nKey: 'whatsappSend' },
  whatsapp_business_send_message: { icon: 'message-circle', i18nKey: 'whatsappSend' },
  whatsapp_send_message: { icon: 'message-circle', i18nKey: 'whatsappSend' },
  clipboard_read: { icon: 'clipboard', i18nKey: 'clipboardRead' },
  clipboard_write: { icon: 'clipboard', i18nKey: 'clipboardWrite' },
  share_text: { icon: 'share-2', i18nKey: 'shareText' },
  // App deep-links (Gemini-style app control)
  youtube_search: { icon: 'youtube', i18nKey: 'youtubeSearch' },
  youtube_open: { icon: 'youtube', i18nKey: 'youtubeOpen' },
  maps_search: { icon: 'map-pin', i18nKey: 'mapsSearch' },
  maps_navigate: { icon: 'navigation', i18nKey: 'mapsNavigate' },
  instagram_open: { icon: 'instagram', i18nKey: 'instagramOpen' },
  gmail_compose: { icon: 'mail', i18nKey: 'gmailCompose' },
  twitter_search: { icon: 'twitter', i18nKey: 'twitterSearch' },
  x_open: { icon: 'twitter', i18nKey: 'xOpen' },
  telegram_open: { icon: 'send', i18nKey: 'telegramOpen' },
  tiktok_search: { icon: 'music', i18nKey: 'tiktokSearch' },
  play_store_open: { icon: 'shopping-bag', i18nKey: 'playStoreOpen' },
  uber_request: { icon: 'car', i18nKey: 'uberRequest' },
  open_deeplink: { icon: 'external-link', i18nKey: 'openDeeplink' },
  save_user_memory: { icon: 'brain', i18nKey: 'saveUserMemory' },
  search_user_memory: { icon: 'brain', i18nKey: 'searchUserMemory' },
  list_user_memories: { icon: 'brain', i18nKey: 'listUserMemories' },
  // ─── Workspaces ──────────────────────────────────────────────────────────
  get_workspaces: { icon: 'layers', i18nKey: 'getWorkspaces' },
  get_workspace_members: { icon: 'users', i18nKey: 'getWorkspaceMembers' },
  // ─── Cards ────────────────────────────────────────────────────────────────
  card_create: { icon: 'plus-circle', i18nKey: 'cardCreated' },
  card_move: { icon: 'arrow-right', i18nKey: 'cardMoved' },
  card_update: { icon: 'edit-2', i18nKey: 'cardUpdated' },
  card_archive: { icon: 'trash-2', i18nKey: 'cardDeleted' },
  card_get: { icon: 'hash', i18nKey: 'cardRead' },
  card_get_bricks: { icon: 'hash', i18nKey: 'cardBricksRead' },
  // ─── Boards ───────────────────────────────────────────────────────────────
  board_create: { icon: 'layout-dashboard', i18nKey: 'boardCreated' },
  board_get: { icon: 'layout-dashboard', i18nKey: 'boardRead' },
  board_list: { icon: 'layout-dashboard', i18nKey: 'boardListed' },
  // ─── Lists ────────────────────────────────────────────────────────────────
  list_create: { icon: 'list', i18nKey: 'listCreated' },
  list_update: { icon: 'edit-2', i18nKey: 'listUpdated' },
  list_delete: { icon: 'trash-2', i18nKey: 'listDeleted' },
  // ─── Documents / bricks ───────────────────────────────────────────────────
  document_create: { icon: 'file-plus', i18nKey: 'documentCreated' },
  document_get: { icon: 'file-text', i18nKey: 'documentRead' },
  document_get_bricks: { icon: 'file-text', i18nKey: 'documentBricksRead' },
  document_list: { icon: 'file-text', i18nKey: 'documentListed' },
  document_update: { icon: 'edit-2', i18nKey: 'documentUpdated' },
  document_append_block: { icon: 'plus-square', i18nKey: 'brickCreated' },
  document_update_brick: { icon: 'edit-2', i18nKey: 'brickUpdated' },
  document_move_brick: { icon: 'arrow-right', i18nKey: 'brickMoved' },
  document_remove_brick: { icon: 'trash-2', i18nKey: 'brickDeleted' },
  // ─── Mesh ─────────────────────────────────────────────────────────────────
  mesh_board_create: { icon: 'layout-dashboard', i18nKey: 'meshBoardCreated' },
  mesh_get_state: { icon: 'layout-dashboard', i18nKey: 'meshRead' },
  mesh_list: { icon: 'layout-dashboard', i18nKey: 'meshListed' },
  // ─── Rooms / messages ─────────────────────────────────────────────────────
  room_create: { icon: 'message-square-plus', i18nKey: 'roomCreated' },
  room_list: { icon: 'message-square', i18nKey: 'roomListed' },
  room_send_message: { icon: 'send', i18nKey: 'messageSent' },
  // ─── Scripts ──────────────────────────────────────────────────────────────
  script_create: { icon: 'zap', i18nKey: 'scriptCreated' },
  script_execute: { icon: 'zap', i18nKey: 'scriptExecuted' },
  script_get: { icon: 'zap', i18nKey: 'scriptRead' },
  script_list: { icon: 'zap', i18nKey: 'scriptListed' },
  script_add_node: { icon: 'zap', i18nKey: 'nodeAdded' },
  script_connect_nodes: { icon: 'zap', i18nKey: 'nodesConnected' },
  // ─── Search / web / tools meta ────────────────────────────────────────────
  search_workspace: { icon: 'search', i18nKey: 'searched' },
  web_search: { icon: 'globe', i18nKey: 'webSearched' },
  tool_search: { icon: 'wrench', i18nKey: 'toolSearched' },
  tool_load: { icon: 'wrench', i18nKey: 'toolLoaded' },
  complete_step: { icon: 'check-circle-2', i18nKey: 'completeStep' },
  // ─── Virtual OS / VFS (edit tools) ────────────────────────────────────────
  read_file: { icon: 'file-search', i18nKey: 'fileRead' },
  write_file: { icon: 'file-plus-2', i18nKey: 'fileWritten' },
  edit_file: { icon: 'file-pen', i18nKey: 'fileEdited' },
  os_download_file: { icon: 'download', i18nKey: 'fileDownloaded' },
  os_upload_file: { icon: 'upload', i18nKey: 'fileUploaded' },
  os_delete: { icon: 'trash-2', i18nKey: 'fileDeleted' },
  os_move: { icon: 'arrow-right', i18nKey: 'fileMoved' },
  os_list_dir: { icon: 'folder', i18nKey: 'dirListed' },
  os_mkdir: { icon: 'folder-plus', i18nKey: 'dirCreated' },
  os_search: { icon: 'search', i18nKey: 'searched' },
  os_bash: { icon: 'terminal', i18nKey: 'systemCommand' },
  os_execute: { icon: 'play', i18nKey: 'systemCommand' },
  os_execute_file: { icon: 'play', i18nKey: 'scriptExecuted' },
  // ─── Tags ─────────────────────────────────────────────────────────────────
  tag_create: { icon: 'tag', i18nKey: 'tagCreated' },
  card_tag_add: { icon: 'tag', i18nKey: 'tagAttached' },
  // ─── Misc ─────────────────────────────────────────────────────────────────
  killio_import: { icon: 'download', i18nKey: 'killioImport' },
  sub_agent: { icon: 'bot', i18nKey: 'subAgent' },
  chat_read_attachment: { icon: 'paperclip', i18nKey: 'attachmentRead' },
  data_manipulate: { icon: 'sigma', i18nKey: 'computed' },
};

const PREFIX_TABLE: { prefix: string; icon: string; i18nKey: string }[] = [
  { prefix: 'git_', icon: 'git-branch', i18nKey: 'gitCommand' },
  { prefix: 'card_', icon: 'hash', i18nKey: 'card' },
  { prefix: 'board_', icon: 'layout-dashboard', i18nKey: 'board' },
  { prefix: 'document_', icon: 'file-text', i18nKey: 'document' },
  { prefix: 'mesh_', icon: 'layout-dashboard', i18nKey: 'mesh' },
  { prefix: 'room_', icon: 'message-square', i18nKey: 'room' },
  { prefix: 'script_', icon: 'zap', i18nKey: 'script' },
  { prefix: 'web_', icon: 'globe', i18nKey: 'webSearched' },
  { prefix: 'tag_', icon: 'tag', i18nKey: 'tag' },
  { prefix: 'calendar_', icon: 'calendar', i18nKey: 'calendarList' },
  { prefix: 'os_', icon: 'terminal', i18nKey: 'systemCommand' },
  { prefix: 'whatsapp_', icon: 'message-circle', i18nKey: 'whatsappSend' },
  { prefix: 'contacts_', icon: 'contact', i18nKey: 'contactsSearch' },
];

export function resolveTool(name: string): ToolMeta {
  if (TOOL_CATALOG[name]) return TOOL_CATALOG[name];
  for (const p of PREFIX_TABLE) {
    if (name.startsWith(p.prefix)) return { icon: p.icon, i18nKey: p.i18nKey };
  }
  return { icon: 'wrench', i18nKey: 'generic' };
}
