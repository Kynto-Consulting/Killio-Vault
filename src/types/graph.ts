// Knowledge-graph data model. Nodes are entities (documents, boards, cards,
// meshes) and optionally mesh bricks; edges capture reference pills, portals,
// mirrors, mesh connections and (in enhanced mode) token-similarity links.

export type GNodeType = "document" | "board" | "mesh" | "card" | "meshBrick";

export type GNode = {
  id: string;
  type: GNodeType;
  label: string;
  route?: string;
  /** Parent entity id (card→board, meshBrick→mesh). */
  parentId?: string;
  /** Concatenated essential text (used for tokenization + hover preview). */
  text?: string;
  /** Has at least one media/draw brick (for the media-render toggle). */
  hasMedia?: boolean;
  /** First representative image ref/url (asset:<name> or http url) for thumbnails. */
  image?: string;
};

export type GEdgeType = "ref" | "portal" | "mirror" | "connection" | "similarity";

export type GEdge = {
  source: string;
  target: string;
  type: GEdgeType;
  weight?: number;
};

export type GraphData = { nodes: GNode[]; edges: GEdge[] };

/** Normalized input the builder understands (filled by local/online collectors). */
export type EntityInput =
  | { type: "document"; id: string; title: string; route: string; bricks: Array<{ kind: string; content: unknown }> }
  | { type: "board"; id: string; title: string; route: string; cards: Array<{ id: string; title: string; blocks: Array<{ kind: string; content: unknown }> }> }
  | { type: "mesh"; id: string; title: string; route: string; bricks: Array<{ id: string; kind: string; content: unknown }>; connections: Array<{ source: string; target: string }> };
