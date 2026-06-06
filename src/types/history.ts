// Cross-engine op/delta history. An Op is a serializable delta with its own
// inverse, so it can be applied, reversed (undo), re-applied (redo) and shipped
// over the existing realtime channels to peers and mirrors.

export type OpScopeKind = "document" | "board" | "mesh";

export interface OpScope {
  kind: OpScopeKind;
  id: string;
}

export type OpOrigin = "local" | "remote" | "undo" | "redo";

export interface Op<P = any, IP = any> {
  id: string; // uuid — dedupe key across the local stack + WS echo + peers
  scope: OpScope;
  type: string; // engine-specific, e.g. "doc.batch"
  payload: P;
  inverse: { type: string; payload: IP };
  actorId: string;
  ts: number;
  origin: OpOrigin;
}

// A new op to dispatch/record: the core fills in id/actor/ts/origin.
export type OpDraft = Pick<Op, "type" | "payload" | "inverse">;

// Engine-supplied. Applies a delta to local state and, when shouldPersist,
// pushes it through the existing persistence seam. Must be idempotent so that
// the legacy backend broadcast + the op echo can both land safely.
export type OpApplier = (
  op: Op,
  ctx: { origin: OpOrigin; shouldPersist: boolean },
) => void | Promise<void>;
