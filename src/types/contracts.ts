// Mirrored from Killio-Frontend/src/lib/api/contracts.ts (type-only).
// Runtime helpers (`request`, `authHeaders`, `emitBoardMutation`, every
// `export async function …`) are intentionally NOT mirrored — Vault has its
// own HTTP client (`@/core/api/http`) and its own realtime bus. The point of
// this file is to share the wire-format contracts so brick / domain code can
// move between web and Vault without re-typing.

export type BackendHealth = {
  status: string;
  service: string;
  timestamp: string;
};

export type ActivityLogEntry = {
  id: string;
  scope: 'team' | 'board' | 'list' | 'card' | 'document';
  scopeId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TeamView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon?: string | null;
  isPersonal?: boolean;
  planTier?: 'free' | 'pro' | 'max' | 'enterprise';
  isArchived?: boolean;
  myRole?: string | null;
};

export type TeamRole = 'owner' | 'admin' | 'member' | 'guest' | 'viewer';

/**
 * Resumen de un board para listas y vistas generales.
 *
 * Lógica de cover (previsualización):
 * - coverImageUrl tiene prioridad sobre backgroundKind en las miniaturas
 * - El campo puede venir en formato: "image::https://..." o URL directa
 * - La función resolveSerializedCover() procesa el formato serializado
 */
export type BoardSummary = {
  id: string;
  teamId: string;
  boardType: 'kanban' | 'mesh';
  name: string;
  slug: string;
  description: string | null;
  /** Imagen de portada del board. Formato: "kind::value" o URL directa. */
  coverImageUrl: string | null;
  backgroundKind: 'none' | 'preset' | 'image' | 'color' | 'gradient';
  backgroundValue: string | null;
  backgroundImageUrl: string | null;
  backgroundGradient: string | null;
  themeKind: 'preset' | 'custom';
  themePreset: string | null;
  themeCustom: Record<string, unknown>;
  updatedAt: string;
};

export type InviteSummary = {
  id: string;
  email: string;
  role: TeamRole;
  status: string;
  deliveryStatus: string;
  createdAt: string;
  /**
   * Raw invite token (one-time use). Only present on POST /teams/:teamId/invites
   * responses, never on list-invites responses (which omit it for security).
   */
  token?: string | null;
  /**
   * Pre-built accept URL the inviter can copy to share manually. Only present on
   * POST /teams/:teamId/invites; null/undefined on list-invites responses.
   */
  acceptUrl?: string | null;
};

export type AcceptInviteResult = {
  inviteId: string;
  teamId: string;
  teamName: string;
  role: TeamRole;
  accepted: true;
};

export type RevokeInviteResult = {
  inviteId: string;
  revoked: true;
};

export type UpdateTeamMemberRoleResult = {
  membershipId: string;
  role: TeamRole;
  updated: true;
};

export type RemoveTeamMemberResult = {
  membershipId: string;
  removed: true;
};

export type UpdateTeamMemberAliasResult = {
  membershipId: string;
  id: string;
  alias: string | null;
  updated: true;
};

export type TeamMemberSummary = {
  membershipId: string;
  id: string;
  userId?: string;
  role: TeamRole;
  status: string;
  name: string;
  alias: string | null;
  primaryEmail: string;
  avatarUrl: string | null;
  joinedAt: string | null;
  displayName?: string | null;
  workspaceAlias?: string | null;
  baseDisplayName?: string | null;
  email?: string | null;
};

export type TeamMetricsSummary = {
  memberCount: number;
  ownerCount: number;
  adminCount: number;
  boardCount: number;
  cardCount: number;
  completedCardCount: number;
  assignmentCount: number;
  pendingInviteCount: number;
  scriptCount: number;
  activeScriptCount: number;
  monthlyScriptRuns: number;
  activityCount: number;
  activityActorCount: number;
};

export type TeamMetricsRoleBreakdown = {
  role: TeamRole | string;
  count: number;
};

export type TeamMetricsMember = {
  membershipId: string;
  id: string;
  userId?: string;
  role: TeamRole | string;
  status: string;
  name: string;
  alias: string | null;
  primaryEmail: string;
  avatarUrl: string | null;
  joinedAt: string | null;
  assignmentsCount: number;
  createdCardsCount: number;
  completedCardsCount: number;
  activityCount: number;
  lastActiveAt: string | null;
  displayName?: string | null;
};

export type TeamMetricsBoard = {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
  cardsCount: number;
  openCardsCount: number;
  overdueCardsCount: number;
  staleCardsCount: number;
  createdCardsWindowCount: number;
  completedCardsWindowCount: number;
  completionRatePct: number | null;
  completedCardsCount: number;
  assignmentsCount: number;
  activityCount: number;
  lastActiveAt: string | null;
};

export type TeamMetricsActivitySeriesPoint = {
  date: string;
  activityCount: number;
  assignmentsCount: number;
  completionsCount: number;
  createdCardsCount: number;
};

export type TeamMetricsWindowSummary = {
  activityCount: number;
  assignmentsCount: number;
  completionsCount: number;
  createdCardsCount: number;
};

export type TeamMetricsTrendMetric = 'activity' | 'assignments' | 'completions' | 'createdCards';

export type TeamMetricsTrend = {
  metric: TeamMetricsTrendMetric;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'flat';
};

export type TeamMetricsKpis = {
  completionRatePct: number | null;
  throughputPerActiveMember: number;
  avgCycleTimeHours: number | null;
  activeMemberCount: number;
  collaborationRatePct: number;
  workloadBalanceScore: number;
  openCards: number;
  overdueOpenCards: number;
  dueSoonCards: number;
  staleOpenCards: number;
};

export type TeamMetricsWorkloadMember = {
  id: string;
  userId?: string;
  name: string;
  avatarUrl: string | null;
  assignmentsCount: number;
  activityCount: number;
  completedCardsCount: number;
  displayName?: string | null;
};

export type TeamMetricsWorkloadInsights = {
  overloadedMembers: TeamMetricsWorkloadMember[];
  underutilizedMembers: TeamMetricsWorkloadMember[];
};

export type TeamMetricsAutomation = {
  scriptCount: number;
  activeScriptCount: number;
  monthlyRuns: number;
  limit: number | null;
  remaining: number | null;
};

export type TeamMetricsResponse = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  windowDays: number;
  generatedAt: string;
  summary: TeamMetricsSummary;
  windowSummary: TeamMetricsWindowSummary;
  previousWindowSummary: TeamMetricsWindowSummary;
  trends: TeamMetricsTrend[];
  kpis: TeamMetricsKpis;
  workloadInsights: TeamMetricsWorkloadInsights;
  roleBreakdown: TeamMetricsRoleBreakdown[];
  members: TeamMetricsMember[];
  boards: TeamMetricsBoard[];
  activitySeries: TeamMetricsActivitySeriesPoint[];
  automation: TeamMetricsAutomation;
  recentActivity: ActivityLogEntry[];
};

type BrickBase = {
  id: string;
  position: number;
  parentBlockId: string | null;
};

export type ChildrenByContainer = Record<string, string[]>;

export type ContainerMeta = {
  childrenByContainer?: ChildrenByContainer;
};

export type TextBrick = BrickBase & {
  kind: 'text';
  displayStyle: 'paragraph' | 'checklist' | 'quote' | 'code' | 'callout';
  markdown: string;
  tasks: Array<{
    id: string;
    label: string;
    checked: boolean;
  }>;
};

export type MediaBrick = BrickBase & {
  kind: 'media';
  mediaType: 'image' | 'file';
  title: string | null;
  url: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  caption: string | null;
};

export type AiBrick = BrickBase & {
  kind: 'ai';
  status: 'idle' | 'running' | 'done' | 'error';
  title: string;
  prompt: string;
  response: string;
  model: string | null;
  confidence: number | null;
};

export type TableBrick = BrickBase & {
  kind: 'table';
  rows: string[][];
};

export type GraphBrick = BrickBase & {
  kind: 'graph';
  type: 'line' | 'bar' | 'pie';
  data?: any[];
  title?: string;
};

export type ChecklistBrick = BrickBase & {
  kind: 'checklist';
  items: Array<{ id: string; label: string; checked: boolean }>;
};

export type AccordionBrick = BrickBase & {
  kind: 'accordion';
  title: string;
  body: string;
  isExpanded: boolean;
  content?: ContainerMeta & Record<string, unknown>;
};

export type TabsBrick = BrickBase & {
  kind: 'tabs';
  tabs: Array<{ id: string; label: string; content?: string }>;
  content?: ContainerMeta & Record<string, unknown>;
};

export type ColumnsBrick = BrickBase & {
  kind: 'columns';
  columns: Array<{ id: string }>;
  content?: ContainerMeta & Record<string, unknown>;
};

export type PaymentBrick = BrickBase & {
  kind: 'payment';
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  provider: 'stripe' | 'paypal' | 'mercadopago';
  connectionId: string | null;
  externalProductId: string | null;
  checkoutUrl: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paidAt: string | null;
  payerEmail: string | null;
  webhookEventId: string | null;
  webhookUrl?: string | null;
  scriptId?: string | null;
  credentialsLocked?: boolean;
  credentialsLastUpdatedAt?: string | null;
};

export type BoardBrick =
  | TextBrick
  | MediaBrick
  | AiBrick
  | TableBrick
  | GraphBrick
  | ChecklistBrick
  | AccordionBrick
  | TabsBrick
  | ColumnsBrick
  | PaymentBrick;

export type BrickMutationInput =
  | {
    kind: 'text';
    displayStyle: TextBrick['displayStyle'];
    markdown: string;
  }
  | {
    kind: 'media';
    mediaType: MediaBrick['mediaType'];
    title: string | null;
    url: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    caption: string | null;
  }
  | {
    kind: 'ai';
    status: AiBrick['status'];
    title: string;
    prompt: string;
    response: string;
    model: string | null;
    confidence: number | null;
  } | {
    kind: 'table';
    rows: string[][];
  }
  | {
    kind: 'graph';
    type: 'line' | 'bar' | 'pie';
    data?: any[];
    title?: string;
  }
  | {
    kind: 'checklist';
    items: Array<{ id: string; label: string; checked: boolean }>;
  }
  | {
    kind: 'accordion';
    title: string;
    body: string;
    isExpanded: boolean;
    content?: ContainerMeta & Record<string, unknown>;
  }
  | {
    kind: 'tabs';
    tabs: Array<{ id: string; label: string; content?: string }>;
    content?: ContainerMeta & Record<string, unknown>;
  }
  | {
    kind: 'columns';
    columns?: Array<{ id: string }>;
    columnsCount?: number;
    content?: ContainerMeta & Record<string, unknown>;
  }
  | {
    kind: 'payment';
    title: string;
    description: string | null;
    amount: number;
    currency: string;
    provider: 'stripe' | 'paypal' | 'mercadopago';
    connectionId: string | null;
    externalProductId?: string | null;
    checkoutUrl?: string | null;
    status?: 'pending' | 'paid' | 'failed' | 'refunded';
    paidAt?: string | null;
    payerEmail?: string | null;
    webhookEventId?: string | null;
    webhookUrl?: string | null;
    scriptId?: string | null;
    credentialsLocked?: boolean;
  };

export type TagView = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  tag_kind: 'priority' | 'ux' | 'bug' | 'feature' | 'custom';
};

export type CardView = {
  id: string;
  title: string;
  summary?: string | null;
  status?: 'draft' | 'active' | 'done' | 'archived';
  startAt?: string | null;
  dueAt: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  listId?: string;
  listName?: string;
  boardId?: string;
  boardName?: string;
  position?: number;
  urgency: 'normal' | 'urgent';
  blocks: BoardBrick[];
  tags?: TagView[];
  assignees?: any[];
  createdAt: string;
  updatedAt: string;
  commentsCount?: number;
};

export type ActiveCardTimer = {
  cardId: string;
  title: string;
  boardId: string;
  boardName: string;
  listId: string;
  listName: string;
  startAt: string;
  dueAt: string;
};

export type ListView = {
  id: string;
  name: string;
  cards: CardView[];
};

export type BoardView = {
  id: string;
  teamId: string;
  boardType: 'kanban' | 'mesh';
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  backgroundKind: 'none' | 'preset' | 'image' | 'color' | 'gradient';
  backgroundValue: string | null;
  backgroundImageUrl: string | null;
  backgroundGradient: string | null;
  themeKind: 'preset' | 'custom';
  themePreset: string | null;
  themeCustom: Record<string, unknown>;
  visibility: 'private' | 'team' | 'public_link';
  lists: ListView[];
};

export type CardBrickMutationResult = {
  cardId: string;
  brick: BoardBrick;
};

export type ReorderCardBricksResult = {
  cardId: string;
  operationId: string;
  aggregateVersion: number;
  bricks: BoardBrick[];
};

export type DeleteCardBrickResult = {
  cardId: string;
  brickId: string;
};

export type AuthResponse = {
  user: {
    id: string;
    name: string;
    alias: string | null;
    bio?: string | null;
    timezone?: string | null;
    locale?: string | null;
  };
  session: {
    id: string;
    expiresAt: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  otp_required?: false;
};

export type OtpRequiredResponse = {
  otp_required: true;
  userId: string;
  email: string;
};

export type OtpPurpose = 'login' | 'password_reset' | 'register';

export type RequestOtpPayload = {
  email: string;
  useMagicLink?: boolean;
  purpose?: OtpPurpose;
};

export type VerifyOtpPayload = {
  email?: string;
  code?: string;
  token?: string;
  rememberMe?: boolean;
  purpose?: OtpPurpose;
  autoRegister?: boolean;
};

export type ResetPasswordWithOtpPayload = {
  email?: string;
  code?: string;
  token?: string;
  newPassword: string;
};

/**
 * Register payload (kept exported from the type contracts so callers can build
 * RegisterWithOtpPayload). In the web file this was a non-exported helper, but
 * Vault re-exports it so register screens stay in sync.
 */
export type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  username?: string;
  acceptedTerms?: boolean;
  allowCommunications?: boolean;
};

export type RegisterWithOtpPayload = RegisterPayload & {
  code?: string;
  token?: string;
};

export type UpdateBoardAppearancePayload = {
  coverImageUrl?: string | null;
  backgroundKind?: 'none' | 'preset' | 'image' | 'color' | 'gradient';
  backgroundValue?: string | null;
  backgroundImageUrl?: string | null;
  backgroundGradient?: string | null;
  themeKind?: 'preset' | 'custom';
  themePreset?: string | null;
  themeCustom?: Record<string, unknown>;
};

export type MeshBrickKind =
  | 'board_empty'
  | 'text'
  | 'frame'
  | 'script'
  | 'mirror'
  | 'portal'
  | 'decision'
  | 'draw';

export type MeshBrick = {
  id: string;
  kind: MeshBrickKind;
  parentId: string | null;
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation?: number;
  metadata?: Record<string, unknown>;
  content?: Record<string, unknown>;
};

export type MeshConnection = {
  id: string;
  cons: [string, string];
  label: { type: 'doc'; content?: unknown[] };
  style?: Record<string, unknown>;
};

export type MeshState = {
  version: string;
  viewport: { x: number; y: number; zoom: number };
  rootOrder: string[];
  bricksById: Record<string, MeshBrick>;
  connectionsById: Record<string, MeshConnection>;
};

export type MeshSnapshot = {
  meshId: string;
  schemaVersion: string;
  revision: number;
  updatedAt: string;
  state: MeshState;
};

export type TeamGraphPayload = {
  documents: Array<{ id: string; title: string; bricks: Array<{ kind: string; content: unknown }> }>;
  boards: Array<{ id: string; name: string; cards: Array<{ id: string; title: string; blocks: Array<{ kind: string; content: unknown }> }> }>;
  meshes: Array<{ id: string; name: string; bricks: Array<{ id: string; kind: string; content: unknown }>; connections: Array<{ source: string; target: string }> }>;
};

export type TeamCatalog = {
  boards: BoardSummary[];
  documents: { id: string; title: string }[];
  cards: { id: string; title: string; boardId: string; boardName: string }[];
};

export type ArchivedListSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface TeamAiUsageAllocation {
  userId: string;
  name: string;
  role: string;
  creditsUsed: number;
  tokensUsed: number;
  sharePct: number;
  isCurrentUser: boolean;
}

export interface TeamAiUsage {
  teamId: string;
  periodStart: string;
  creditsUsed: number;
  tokensUsed: number;
  limit: number;
  remaining: number;
  myCreditsUsed?: number;
  myTokensUsed?: number;
  mySharePct?: number;
  memberAllocations?: TeamAiUsageAllocation[];
  billingOwnerUserId?: string;
  billingOwnerName?: string;
  isBillingOwner?: boolean;
}

export interface TeamRagStatus {
  teamId: string;
  planTier: 'free' | 'pro' | 'max' | 'enterprise';
  periodDate: string;
  sourceCounts: {
    documents: number;
    cards: number;
    boards: number;
  };
  policy: {
    dailyBaseSync: number;
    dailyExtraSync: number;
    extraThresholdPct: number | null;
  };
  usage: {
    baseUsed: number;
    baseRemaining: number;
    extraUsed: number;
    extraRemaining: number;
    lastRunAt: string | null;
  };
  vectorIndex: {
    indexedEntities: number;
    indexedChunks: number;
    coveragePct: number;
    lastRunAt: string | null;
    lastRunStatus: 'indexed' | 'skipped' | 'error' | null;
    lastRunReason: string | null;
    embeddingProvider: string | null;
    embeddingModel: string | null;
  };
  lastRun: {
    runType: 'base' | 'extra' | 'skipped';
    changedEntities: number;
    removedEntities: number;
    totalEntities: number;
    changeRatioPct: number;
    thresholdPct: number | null;
    createdAt: string;
  } | null;
}

export interface TeamRagSyncResult {
  teamId: string;
  planTier: 'free' | 'pro' | 'max' | 'enterprise';
  runType: 'base' | 'extra' | 'skipped';
  reason: string;
  changedEntities: number;
  removedEntities: number;
  totalEntities: number;
  comparedEntities: number;
  changeRatioPct: number;
  thresholdPct: number | null;
  policy: {
    dailyBaseSync: number;
    dailyExtraSync: number;
    extraThresholdPct: number | null;
  };
  usage: {
    baseUsed: number;
    baseRemaining: number;
    extraUsed: number;
    extraRemaining: number;
  };
  vectorIndexRun: {
    status: 'indexed' | 'skipped' | 'error';
    reason: string;
    changedEntities: number;
    removedEntities: number;
    totalEntities: number;
    indexedChunks: number;
    createdAt: string;
  } | null;
}

export interface TeamRagRunHistoryItem {
  id: string;
  runType: 'base' | 'extra' | 'skipped';
  triggerSource: 'manual' | 'api' | 'system';
  triggeredByUserId: string | null;
  changedEntities: number;
  removedEntities: number;
  totalEntities: number;
  changeRatioPct: number;
  thresholdPct: number | null;
  reason: string;
  createdAt: string;
}

export type GeneratedMeshShape = 'rect' | 'rounded-rect' | 'ellipse' | 'diamond' | 'note' | 'cylinder';

export interface GeneratedMeshNode {
  ref: string;
  kind: 'board' | 'shape' | 'text';
  label: string;
  shape?: GeneratedMeshShape;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional parent ref — nests this node inside another node (e.g. a board). */
  parent?: string;
  /** Optional explicit colors (hex or rgba). */
  stroke?: string;
  fill?: string;
  /** Optional label/text color. */
  textColor?: string;
  /** Optional normalized (0..1) polygon points — renders an arbitrary filled
   *  shape (chart slices, radar polygons, …) instead of a preset. */
  vectorPoints?: Array<{ x: number; y: number }>;
}

export interface GeneratedMeshEdge {
  from: string;
  to: string;
  label?: string;
  /** Stroke color (hex or rgba). */
  color?: string;
  /** Line pattern. */
  pattern?: 'solid' | 'dashed' | 'dotted';
  /** Connection rendering style. */
  connType?: 'technical' | 'curved' | 'bezier' | 'handdrawn';
  /** Stroke width override. */
  width?: number;
}

export interface GeneratedMesh {
  nodes: GeneratedMeshNode[];
  edges: GeneratedMeshEdge[];
}

// ------ BOARD SHARING & VISIBILITY ------

export interface BoardMemberSummary {
  id: string;
  email: string | null;
  name: string | null;
  alias: string | null;
  role: string;
  avatarUrl: string | null;
  displayName?: string | null;
  workspaceAlias?: string | null;
  baseDisplayName?: string | null;
}

// ==========================================
// Mesh sharing / members / visibility
// ==========================================

export type MeshMemberSummary = {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
};
