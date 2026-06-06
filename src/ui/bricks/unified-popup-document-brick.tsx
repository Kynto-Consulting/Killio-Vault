"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { FileText, ExternalLink, X, Loader2, ChevronRight, Pencil, Folder as FolderIcon } from "lucide-react";
import {
  createDocument,
  getDocument,
  getDocumentBricks,
  listDocuments,
  updateDocumentTitle,
  createDocumentBrick,
  updateDocumentBrick,
  deleteDocumentBrick,
  reorderDocumentBricks,
  DocumentSummary,
  patchBrickCell,
  DocumentView,
  DocumentBrick,
} from "@/lib/api/documents";
import { listTeamBoards, listTeamMembers, BoardSummary, TeamMemberSummary } from "@/lib/api/contracts";
import { useSession } from "@/components/providers/session-provider";
import { useTranslations } from "@/components/providers/i18n-provider";
import { sanitizeChildrenByContainer } from "@/lib/bricks/nesting";

export interface PopupDocumentContent {
  title?: string;
  inlineDocumentId?: string | null;
  externalSource?: {
    provider: "google_drive" | "onedrive";
    fileId: string;
    fileName: string;
    mimeType?: string;
    webViewLink?: string;
    webUrl?: string;
    isPublic: boolean;
    credentialId: string;
  } | null;
}

interface UnifiedPopupDocumentBrickProps {
  id: string;
  content: PopupDocumentContent;
  canEdit: boolean;
  onUpdate: (content: PopupDocumentContent) => void;
}

function sanitizeBricks(bricks: DocumentBrick[]): DocumentBrick[] {
  const deduped = Array.from(new Map(bricks.map((b) => [b.id, b])).values());
  const ids = new Set(deduped.map((b) => b.id));
  return deduped.map((b) => ({
    ...b,
    content: sanitizeChildrenByContainer(b.content || {}, ids),
  }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

function buildFallbackDocumentView(documentId: string, title: string, bricks: DocumentBrick[]): DocumentView {
  const now = new Date().toISOString();
  return {
    id: documentId,
    title,
    teamId: "",
    visibility: "private",
    createdByUserId: "",
    createdAt: now,
    updatedAt: now,
    role: "editor",
    bricks,
  };
}

let cachedUnifiedBrickList: React.ComponentType<any> | null = null;
let unifiedBrickListImportPromise: Promise<React.ComponentType<any>> | null = null;

function loadUnifiedBrickListComponent(): Promise<React.ComponentType<any>> {
  if (cachedUnifiedBrickList) {
    return Promise.resolve(cachedUnifiedBrickList);
  }
  if (!unifiedBrickListImportPromise) {
    unifiedBrickListImportPromise = import("@/components/bricks/unified-brick-list")
      .then((m) => {
        cachedUnifiedBrickList = m.UnifiedBrickList;
        return m.UnifiedBrickList;
      })
      .finally(() => {
        unifiedBrickListImportPromise = null;
      });
  }
  return unifiedBrickListImportPromise;
}

export function UnifiedPopupDocumentBrick({
  id,
  content,
  canEdit,
  onUpdate,
}: UnifiedPopupDocumentBrickProps) {
  const t = useTranslations("document-detail");
  const { accessToken, activeTeamId } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(content.title ?? "");

  const title = content.title || t("popupDocument.untitled", { fallback: "Untitled document" });

  const handleTitleSave = () => {
    const trimmed = tempTitle.trim();
    if (trimmed && trimmed !== content.title) {
      onUpdate({ ...content, title: trimmed });
    }
    setIsEditingTitle(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") {
      setTempTitle(content.title ?? "");
      setIsEditingTitle(false);
    }
  };

  return (
    <>
      {/* Brick card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.03)",
          cursor: "default",
          userSelect: "none",
        }}
      >
        <FileText style={{ width: 16, height: 16, color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />

        {isEditingTitle && canEdit ? (
          <input
            autoFocus
            value={tempTitle}
            onChange={(e) => setTempTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.3)",
              outline: "none",
              fontSize: 13,
              color: "rgba(255,255,255,0.88)",
              padding: "0 2px",
            }}
          />
        ) : (
          <span
            style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onDoubleClick={canEdit ? () => { setTempTitle(content.title ?? ""); setIsEditingTitle(true); } : undefined}
          >
            {title}
          </span>
        )}

        {canEdit && !isEditingTitle && (
          <button
            type="button"
            onClick={() => { setTempTitle(content.title ?? ""); setIsEditingTitle(true); }}
            style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", lineHeight: 1 }}
            title="Rename"
          >
            <Pencil style={{ width: 12, height: 12 }} />
          </button>
        )}

        {content.inlineDocumentId && (
          <a
            href={`/d/${content.inlineDocumentId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: 4, background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", lineHeight: 1 }}
            title="Open in new tab"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        )}

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 7,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "rgba(255,255,255,0.6)",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <ChevronRight style={{ width: 12, height: 12 }} />
          {t("popupDocument.open", { fallback: "Open" })}
        </button>
      </div>

      {/* Slide-over panel */}
      {isOpen && (
        <PopupDocumentPanel
          content={content}
          canEdit={canEdit}
          teamId={activeTeamId ?? null}
          accessToken={accessToken ?? ""}
          onClose={() => setIsOpen(false)}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}

// ─── PopupDocumentPanel ───────────────────────────────────────────────────────

interface PopupDocumentPanelProps {
  content: PopupDocumentContent;
  canEdit: boolean;
  teamId: string | null;
  accessToken: string;
  onClose: () => void;
  onUpdate: (content: PopupDocumentContent) => void;
}

function PopupDocumentPanel({ content, canEdit, teamId, accessToken, onClose, onUpdate }: PopupDocumentPanelProps) {
  const t = useTranslations("document-detail");
  const params = useParams() as Record<string, string | string[] | undefined>;
  const routeDocId = params?.docId;
  const parentDocumentId = Array.isArray(routeDocId) ? routeDocId[0] : routeDocId;
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingInlineDoc, setIsCreatingInlineDoc] = useState(false);
  const creatingInlineDocRef = useRef(false);
  const [parentDocumentTitle, setParentDocumentTitle] = useState<string | null>(null);
  const [teamDocuments, setTeamDocuments] = useState<DocumentSummary[]>([]);
  const [teamBoards, setTeamBoards] = useState<BoardSummary[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberSummary[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [panelWidth, setPanelWidth] = useState(860);
  const isResizingRef = useRef(false);

  const { inlineDocumentId } = content;

  const loadInlineDocument = useCallback(
    async (documentId: string, titleFallback?: string): Promise<DocumentView> => {
      const safeTitle = (titleFallback || content.title || "").trim() || t("popupDocument.untitled", { fallback: "Untitled document" });

      try {
        const full = await withTimeout(
          getDocument(documentId, accessToken),
          7000,
          t("popupDocument.loadTimeout", { fallback: "Document load timeout" }),
        );
        return { ...full, bricks: sanitizeBricks(full.bricks) };
      } catch {
        const bricks = await withTimeout(
          getDocumentBricks(documentId, accessToken),
          7000,
          t("popupDocument.loadTimeout", { fallback: "Document load timeout" }),
        );
        return buildFallbackDocumentView(documentId, safeTitle, sanitizeBricks(bricks));
      }
    },
    [accessToken, content.title, t],
  );

  const fetchDoc = useCallback(async () => {
    if (!inlineDocumentId || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadInlineDocument(inlineDocumentId, content.title);
      setDoc(result);
    } catch (err: any) {
      setError(err.message ?? "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [inlineDocumentId, accessToken, loadInlineDocument, content.title]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  useEffect(() => {
    if (!parentDocumentId || !accessToken) {
      setParentDocumentTitle(null);
      return;
    }

    let cancelled = false;

    getDocument(parentDocumentId, accessToken)
      .then((parentDoc) => {
        if (!cancelled) {
          setParentDocumentTitle(parentDoc.title || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setParentDocumentTitle(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [parentDocumentId, accessToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(media.matches);
    update();

    const savedWidth = window.localStorage.getItem("killio.popupDrawer.width");
    if (savedWidth) {
      const parsed = Number(savedWidth);
      if (!Number.isNaN(parsed)) {
        setPanelWidth(Math.max(700, Math.min(1400, parsed)));
      }
    }

    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current || isMobile) return;
      const next = Math.max(700, Math.min(1400, window.innerWidth - event.clientX));
      setPanelWidth(next);
    };

    const onMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (!isMobile) {
        window.localStorage.setItem("killio.popupDrawer.width", String(panelWidth));
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isMobile, panelWidth]);

  const startResize = (event: React.MouseEvent) => {
    if (isMobile) return;
    event.preventDefault();
    isResizingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  useEffect(() => {
    void loadUnifiedBrickListComponent();
  }, []);

  useEffect(() => {
    if (!teamId || !accessToken) {
      setTeamDocuments([]);
      setTeamBoards([]);
      setTeamMembers([]);
      return;
    }

    let cancelled = false;

    Promise.all([
      listDocuments(teamId, accessToken).catch(() => [] as DocumentSummary[]),
      listTeamBoards(teamId, accessToken).catch(() => [] as BoardSummary[]),
      listTeamMembers(teamId, accessToken).catch(() => [] as TeamMemberSummary[]),
    ]).then(([docs, boards, members]) => {
      if (!cancelled) {
        setTeamDocuments(docs);
        setTeamBoards(boards);
        setTeamMembers(members);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [teamId, accessToken]);

  useEffect(() => {
    if (inlineDocumentId || content.externalSource) return;
    if (!canEdit || !teamId || !accessToken) return;
    if (creatingInlineDocRef.current) return;

    let cancelled = false;

    const provisionInlineDocument = async () => {
      creatingInlineDocRef.current = true;
      setIsCreatingInlineDoc(true);
      setLoading(true);
      setError(null);
      try {
        const baseTitle = (content.title || "").trim() || t("popupDocument.untitled", { fallback: "Untitled document" });
        const created = await createDocument(
          {
            teamId,
            title: baseTitle,
            isInlinePopup: true,
            parentDocumentId: parentDocumentId || undefined,
          },
          accessToken,
        );
        await createDocumentBrick(
          created.id,
          { kind: "text", position: 1000, content: { text: "" } },
          accessToken,
        );

        if (cancelled) return;

        onUpdate({
          ...content,
          title: content.title || created.title,
          inlineDocumentId: created.id,
        });

        const full = await loadInlineDocument(created.id, content.title || created.title);
        if (!cancelled) {
          setDoc(full);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? t("popupDocument.createFailed", { fallback: "Failed to create popup document" }));
        }
      } finally {
        creatingInlineDocRef.current = false;
        if (!cancelled) {
          setLoading(false);
          setIsCreatingInlineDoc(false);
        }
      }
    };

    provisionInlineDocument();

    return () => {
      cancelled = true;
    };
  }, [inlineDocumentId, content.externalSource, content.title, canEdit, teamId, accessToken, onUpdate, t, loadInlineDocument, parentDocumentId]);

  // External source (Drive/OneDrive file) – show iframe viewer
  const externalSource = content.externalSource;
  const viewerUrl = externalSource
    ? externalSource.provider === "google_drive" && externalSource.webViewLink
      ? `https://drive.google.com/file/d/${externalSource.fileId}/preview`
      : externalSource.webUrl ?? null
    : null;

  const currentTitle = doc?.title ?? externalSource?.fileName ?? content.title ?? t("popupDocument.untitled", { fallback: "Untitled" });
  const standaloneHref = (() => {
    if (!inlineDocumentId) return null;
    return `/d/${inlineDocumentId}`;
  })();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: isMobile ? "flex-end" : "stretch",
        justifyContent: "flex-end",
        pointerEvents: "none",
      }}
    >
      {/* Backdrop */}
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)", pointerEvents: "auto" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          width: isMobile ? "100vw" : `min(${panelWidth}px, 96vw)`,
          height: isMobile ? "min(86vh, 100%)" : "100%",
          background: "#0c0e14",
          borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.1)",
          borderTop: isMobile ? "1px solid rgba(255,255,255,0.1)" : "none",
          borderTopLeftRadius: isMobile ? 16 : 0,
          borderTopRightRadius: isMobile ? 16 : 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          pointerEvents: "auto",
          animation: isMobile ? "slideInFromBottom 0.22s ease-out" : "slideInFromRight 0.2s ease-out",
        }}
      >
        {!isMobile && (
          <div
            onMouseDown={startResize}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 10,
              cursor: "col-resize",
              zIndex: 20,
              background: "transparent",
            }}
            title="Drag to resize"
          />
        )}

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: isMobile ? "12px 14px" : "14px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <a href="/d" style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.58)", textDecoration: "none", fontSize: 12, padding: "4px 6px", borderRadius: 6 }}>
              <FolderIcon style={{ width: 14, height: 14 }} />
              <span>{t("allDocuments")}</span>
            </a>

            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>/</span>

            {parentDocumentTitle && (
              <>
                <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {parentDocumentTitle}
                </span>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>/</span>
              </>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "4px 8px" }}>
              <FileText style={{ width: 14, height: 14, color: "rgba(255,255,255,0.55)", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {currentTitle}
              </span>
            </div>
          </div>

          {standaloneHref && (
            <a
              href={standaloneHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.14)",
                color: "rgba(255,255,255,0.8)",
                textDecoration: "none",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1,
              }}
              title={t("popupDocument.openFull", { fallback: "Open full" })}
            >
              <span>{t("popupDocument.openFull", { fallback: "Open full" })}</span>
              <ExternalLink style={{ width: 14, height: 14 }} />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ padding: 6, background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", lineHeight: 1, borderRadius: 6 }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "10px 8px 120px" : "16px 20px 120px" }}>
          {loading && (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {error && (
            <div style={{ fontSize: 13, color: "#f87171", textAlign: "center", paddingTop: 40 }}>{error}</div>
          )}

          {/* External source: iframe preview */}
          {!loading && !error && externalSource && viewerUrl && (
            <iframe
              src={viewerUrl}
              sandbox="allow-scripts allow-popups allow-same-origin allow-forms allow-top-navigation"
              style={{ width: "100%", height: "100%", minHeight: 500, border: "none", borderRadius: 8 }}
              title={externalSource.fileName}
            />
          )}

          {/* Inline document: lazy-loaded brick list */}
          {!loading && !error && doc && !externalSource && (
            <div style={{ paddingLeft: isMobile ? 8 : 80, paddingRight: isMobile ? 8 : 32, paddingTop: 4 }}>
              <InlineDocumentBody
                doc={doc}
                canEdit={canEdit}
                accessToken={accessToken}
                documents={teamDocuments}
                boards={teamBoards}
                users={teamMembers}
                onDocUpdate={setDoc}
              />
            </div>
          )}

          {/* No linked document yet */}
          {!loading && !error && !inlineDocumentId && !externalSource && !isCreatingInlineDoc && (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", paddingTop: 40 }}>
              {t("popupDocument.noContent", { fallback: "No content linked yet." })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInFromRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        @keyframes slideInFromBottom {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── InlineDocumentBody ───────────────────────────────────────────────────────

interface InlineDocumentBodyProps {
  doc: DocumentView;
  canEdit: boolean;
  accessToken: string;
  documents: DocumentSummary[];
  boards: BoardSummary[];
  users: TeamMemberSummary[];
  onDocUpdate: (doc: DocumentView) => void;
}

function InlineDocumentBody({ doc, canEdit, accessToken, documents, boards, users, onDocUpdate }: InlineDocumentBodyProps) {
  const [BrickListComponent, setBrickListComponent] = useState<React.ComponentType<any> | null>(() => cachedUnifiedBrickList);
  const [brickListLoadError, setBrickListLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (BrickListComponent) return;
    loadUnifiedBrickListComponent()
      .then((Component) => {
        setBrickListComponent(() => Component);
        setBrickListLoadError(null);
      })
      .catch(() => {
        setBrickListLoadError("Failed to load document renderer");
      });
  }, [BrickListComponent]);

  const handleBrickUpdate = useCallback(
    async (brickId: string, newContent: any) => {
      if (!canEdit) return;
      try {
        await updateDocumentBrick(doc.id, brickId, newContent, accessToken);
        onDocUpdate({
          ...doc,
          bricks: doc.bricks.map((b) => (b.id === brickId ? { ...b, content: newContent } : b)),
        });
      } catch {
        // ignore
      }
    },
    [doc, canEdit, accessToken, onDocUpdate],
  );

  const handleAddBrick = useCallback(
    async (kind: string, afterBrickId?: string, _parentProps?: any, initialContent?: any) => {
      if (!canEdit) return;
      try {
        let position: number;
        if (afterBrickId) {
          const after = doc.bricks.find((b) => b.id === afterBrickId);
          position = after ? after.position + 1000 : (doc.bricks.length + 1) * 1000;
        } else {
          position = (doc.bricks.length + 1) * 1000;
        }
        const newBrick = await createDocumentBrick(
          doc.id,
          { kind, position, content: initialContent ?? {} },
          accessToken,
        );
        const updatedBricks = [...doc.bricks];
        if (afterBrickId) {
          const idx = updatedBricks.findIndex((b) => b.id === afterBrickId);
          updatedBricks.splice(idx + 1, 0, newBrick);
        } else {
          updatedBricks.push(newBrick);
        }
        onDocUpdate({ ...doc, bricks: updatedBricks });
      } catch {
        // ignore
      }
    },
    [doc, canEdit, accessToken, onDocUpdate],
  );

  const handleDeleteBrick = useCallback(
    async (brickId: string) => {
      if (!canEdit) return;
      try {
        await deleteDocumentBrick(doc.id, brickId, accessToken);
        onDocUpdate({ ...doc, bricks: doc.bricks.filter((b) => b.id !== brickId) });
      } catch {
        // ignore
      }
    },
    [doc, canEdit, accessToken, onDocUpdate],
  );

  const handleReorderBricks = useCallback(
    async (ids: string[]) => {
      if (!canEdit) return;
      const updates = ids.map((id, idx) => ({ id, position: (idx + 1) * 1000 }));
      const reordered = ids
        .map((id, idx) => {
          const brick = doc.bricks.find((b) => b.id === id);
          if (!brick) return null;
          return { ...brick, position: (idx + 1) * 1000 };
        })
        .filter(Boolean) as typeof doc.bricks;
      onDocUpdate({ ...doc, bricks: reordered });
      try {
        await reorderDocumentBricks(doc.id, updates, accessToken);
      } catch {
        // ignore
      }
    },
    [doc, canEdit, accessToken, onDocUpdate],
  );

  const handlePatchCell = useCallback(
    async (brickId: string, patch: Record<string, any>) => {
      if (!canEdit) return;
      try {
        await patchBrickCell(doc.id, brickId, patch as any, accessToken);
      } catch {
        // ignore
      }
    },
    [doc.id, canEdit, accessToken],
  );

  if (!BrickListComponent) {
    if (brickListLoadError) {
      return (
        <div style={{ fontSize: 13, color: "#f87171", textAlign: "center", paddingTop: 20 }}>
          {brickListLoadError}
        </div>
      );
    }

    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 20 }}>
        <Loader2 style={{ width: 16, height: 16, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <BrickListComponent
      bricks={doc.bricks}
      activeBricks={doc.bricks}
      canEdit={canEdit}
      documents={documents}
      boards={boards}
      users={users}
      onUpdateBrick={handleBrickUpdate}
      onAddBrick={handleAddBrick}
      onDeleteBrick={handleDeleteBrick}
      onReorderBricks={handleReorderBricks}
      onPatchCell={handlePatchCell}
      onPatchColumn={handlePatchCell}
    />
  );
}
