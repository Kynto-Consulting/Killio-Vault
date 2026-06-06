import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  FileText,
  ExternalLink,
  X,
  ChevronRight,
  Pencil,
  Folder as FolderIcon,
} from 'lucide-react-native';

import {
  createDocument,
  getDocument,
  listDocuments,
  appendDocumentBlock,
  updateBrickContent,
  removeBrick,
  reorderBricks,
  patchBrickCell,
  type DocFull,
  type DocBrick,
  type DocSummary,
} from '@/core/api/documents.client';
import { listTeamBoards } from '@/core/api/boards.client';
import { listTeamMembers, type TeamMember } from '@/core/api/teams.client';
import type { BoardSummary } from '@/types';
import { useAuth } from '@/core/auth/AuthContext';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { UnifiedBrickList } from './unified-brick-list';

/**
 * React Native port of the web `unified-popup-document-brick.tsx`.
 *
 * The brick API and content schema match the web file 1:1 — same prop names
 * (`UnifiedPopupDocumentBrick`), same content keys — so a brick authored on web
 * round-trips through Vault and back unchanged.
 *
 * Web → Native swap notes (key deltas from the source file):
 *   • Mobile: floating slide-over popover → bottom-sheet `Modal`. The web brick
 *     renders a fixed, resizable right-side panel; RN uses a bottom sheet with a
 *     backdrop. The drag-to-resize handle, `window.innerWidth` math, the
 *     `localStorage` width persistence, and the `matchMedia` mobile probe are
 *     all dropped (// Mobile: drop window/document/localStorage).
 *   • Mobile: external-source files (Drive / OneDrive) can't be shown in an
 *     <iframe>; we render an "Open in browser" button that defers to
 *     `Linking.openURL(viewerUrl)`.
 *   • The inline document body is wired to the Vault sibling
 *     `./unified-brick-list` (statically imported — RN bundles eagerly, so the
 *     web's `import()` lazy-loader is dropped).
 *   • `useParams()` (next) → `useLocalSearchParams()` (expo-router).
 *   • `useSession()` → `useAuth()`; `lucide-react` → `lucide-react-native`.
 *   • `<a href>` standalone links → `Linking.openURL`.
 *   • Vault types: `DocumentView` → `DocFull`, `DocumentBrick` → `DocBrick`,
 *     `DocumentSummary` → `DocSummary`. Brick CRUD maps to the Vault
 *     documents.client (`createDocumentBrick` → `appendDocumentBlock`,
 *     `updateDocumentBrick` → `updateBrickContent`, `deleteDocumentBrick` →
 *     `removeBrick`, `reorderDocumentBricks` → `reorderBricks`).
 *   • Backend gap: Vault `createDocument` doesn't accept `isInlinePopup` /
 *     `parentDocumentId` yet, so auto-provisioning creates a plain document.
 */

export interface PopupDocumentContent {
  title?: string;
  inlineDocumentId?: string | null;
  externalSource?: {
    provider: 'google_drive' | 'onedrive';
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

/** Minimal stand-in for the web `sanitizeChildrenByContainer` helper: strips
 *  child references that point to bricks no longer present in the document. */
function sanitizeChildrenByContainer(
  content: Record<string, any>,
  ids: Set<string>,
): Record<string, any> {
  const cbc = content?.childrenByContainer;
  if (!cbc || typeof cbc !== 'object') return content;
  const cleaned: Record<string, string[]> = {};
  for (const [container, childIds] of Object.entries(cbc)) {
    if (Array.isArray(childIds)) {
      cleaned[container] = childIds.filter((cid) => typeof cid === 'string' && ids.has(cid));
    }
  }
  return { ...content, childrenByContainer: cleaned };
}

function sanitizeBricks(bricks: DocBrick[]): DocBrick[] {
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

export function UnifiedPopupDocumentBrick({
  id,
  content,
  canEdit,
  onUpdate,
}: UnifiedPopupDocumentBrickProps) {
  const t = useTranslations('document-detail');
  const { activeTeam } = useAuth();
  const activeTeamId = activeTeam?.id ?? null;
  // accessToken is injected by the axios interceptor (token-store); kept as a
  // truthy stub so the web `if (accessToken)` guards keep working.
  const accessToken = activeTeamId ? 'managed-by-axios' : null;
  const [isOpen, setIsOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(content.title ?? '');

  const title = content.title || t('popupDocument.untitled') || 'Untitled document';

  const handleTitleSave = () => {
    const trimmed = tempTitle.trim();
    if (trimmed && trimmed !== content.title) {
      onUpdate({ ...content, title: trimmed });
    }
    setIsEditingTitle(false);
  };

  return (
    <>
      {/* Brick card */}
      <View
        className="flex-row items-center rounded-lg border border-border bg-card px-3.5 py-2.5"
        style={{ gap: 10 }}
      >
        <FileText size={16} color={colors.mutedForeground} />

        {isEditingTitle && canEdit ? (
          <TextInput
            autoFocus
            value={tempTitle}
            onChangeText={setTempTitle}
            onBlur={handleTitleSave}
            onSubmitEditing={handleTitleSave}
            style={{ fontFamily: fonts.regular, flex: 1 }}
            className="border-b border-border px-0.5 text-[13px] text-foreground"
          />
        ) : (
          <Text
            style={{ flex: 1 }}
            numberOfLines={1}
            className="text-[13px] text-foreground"
            onPress={
              canEdit
                ? () => {
                    setTempTitle(content.title ?? '');
                    setIsEditingTitle(true);
                  }
                : undefined
            }
          >
            {title}
          </Text>
        )}

        {canEdit && !isEditingTitle && (
          <Pressable
            onPress={() => {
              setTempTitle(content.title ?? '');
              setIsEditingTitle(true);
            }}
            hitSlop={6}
            className="p-1"
          >
            <Pencil size={12} color={colors.mutedForeground} />
          </Pressable>
        )}

        {content.inlineDocumentId ? (
          // Mobile: <a href="/d/:id"> → open the standalone document deep link.
          <Pressable
            onPress={() => Linking.openURL(`/d/${content.inlineDocumentId}`)}
            hitSlop={6}
            className="p-1"
          >
            <ExternalLink size={12} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => setIsOpen(true)}
          className="flex-row items-center rounded-md border border-border px-2.5 py-1"
          style={{ gap: 4 }}
        >
          <ChevronRight size={12} color={colors.mutedForeground} />
          <Text className="text-xs text-muted-foreground">{t('popupDocument.open') || 'Open'}</Text>
        </Pressable>
      </View>

      {/* Bottom-sheet panel */}
      {isOpen && (
        <PopupDocumentPanel
          content={content}
          canEdit={canEdit}
          teamId={activeTeamId}
          accessToken={accessToken ?? ''}
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

function PopupDocumentPanel({
  content,
  canEdit,
  teamId,
  accessToken,
  onClose,
  onUpdate,
}: PopupDocumentPanelProps) {
  const t = useTranslations('document-detail');
  const params = useLocalSearchParams<{ docId?: string | string[] }>();
  const routeDocId = params?.docId;
  const parentDocumentId = Array.isArray(routeDocId) ? routeDocId[0] : routeDocId;
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingInlineDoc, setIsCreatingInlineDoc] = useState(false);
  const creatingInlineDocRef = useRef(false);
  const [parentDocumentTitle, setParentDocumentTitle] = useState<string | null>(null);
  const [teamDocuments, setTeamDocuments] = useState<DocSummary[]>([]);
  const [teamBoards, setTeamBoards] = useState<BoardSummary[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const { inlineDocumentId } = content;

  const loadInlineDocument = useCallback(
    async (documentId: string, titleFallback?: string): Promise<DocFull> => {
      const safeTitle =
        (titleFallback || content.title || '').trim() ||
        t('popupDocument.untitled') ||
        'Untitled document';

      const full = await withTimeout(
        getDocument(documentId),
        7000,
        t('popupDocument.loadTimeout') || 'Document load timeout',
      );
      return {
        ...full,
        title: full.title || safeTitle,
        bricks: sanitizeBricks(full.bricks ?? []),
      };
    },
    [content.title, t],
  );

  const fetchDoc = useCallback(async () => {
    if (!inlineDocumentId || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadInlineDocument(inlineDocumentId, content.title);
      setDoc(result);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load document');
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

    getDocument(parentDocumentId)
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
    if (!teamId || !accessToken) {
      setTeamDocuments([]);
      setTeamBoards([]);
      setTeamMembers([]);
      return;
    }

    let cancelled = false;

    Promise.all([
      listDocuments(teamId).catch(() => [] as DocSummary[]),
      listTeamBoards(teamId).catch(() => [] as BoardSummary[]),
      listTeamMembers(teamId).catch(() => [] as TeamMember[]),
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
        const baseTitle =
          (content.title || '').trim() || t('popupDocument.untitled') || 'Untitled document';
        // Backend gap: Vault createDocument doesn't accept isInlinePopup /
        // parentDocumentId yet — provisions a plain document instead.
        const created = await createDocument({ teamId, title: baseTitle });
        await appendDocumentBlock(created.id, 'text', { text: '' });

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
          setError(
            err?.message ??
              t('popupDocument.createFailed') ??
              'Failed to create popup document',
          );
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
  }, [
    inlineDocumentId,
    content.externalSource,
    content.title,
    canEdit,
    teamId,
    accessToken,
    onUpdate,
    t,
    loadInlineDocument,
    parentDocumentId,
  ]);

  // External source (Drive/OneDrive file) — show "open in browser" CTA.
  const externalSource = content.externalSource;
  const viewerUrl = externalSource
    ? externalSource.provider === 'google_drive' && externalSource.webViewLink
      ? `https://drive.google.com/file/d/${externalSource.fileId}/preview`
      : externalSource.webUrl ?? null
    : null;

  const currentTitle =
    doc?.title ??
    externalSource?.fileName ??
    content.title ??
    t('popupDocument.untitled') ??
    'Untitled';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop */}
      <Pressable onPress={onClose} className="flex-1 justify-end bg-background/70">
        {/* Sheet */}
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-2xl border-t border-border bg-card"
          style={{ height: '88%' }}
        >
          {/* Header */}
          <View
            className="flex-row items-center border-b border-border px-4 py-3"
            style={{ gap: 8 }}
          >
            <View className="flex-row items-center" style={{ gap: 8, minWidth: 0, flex: 1 }}>
              <FolderIcon size={14} color={colors.mutedForeground} />
              <Text className="text-xs text-muted-foreground">{t('allDocuments') || 'Documents'}</Text>
              <Text className="text-xs text-muted-foreground">/</Text>

              {parentDocumentTitle ? (
                <>
                  <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ maxWidth: 120 }}>
                    {parentDocumentTitle}
                  </Text>
                  <Text className="text-xs text-muted-foreground">/</Text>
                </>
              ) : null}

              <View
                className="flex-row items-center rounded-md border border-border bg-background px-2 py-1"
                style={{ gap: 6, minWidth: 0 }}
              >
                <FileText size={14} color={colors.mutedForeground} />
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: fonts.semibold, flexShrink: 1 }}
                  className="text-xs text-foreground"
                >
                  {currentTitle}
                </Text>
              </View>
            </View>

            {inlineDocumentId ? (
              <Pressable
                onPress={() => Linking.openURL(`/d/${inlineDocumentId}`)}
                className="flex-row items-center rounded-md border border-border px-2.5 py-1.5"
                style={{ gap: 6 }}
              >
                <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
                  {t('popupDocument.openFull') || 'Open full'}
                </Text>
                <ExternalLink size={14} color={colors.foreground} />
              </Pressable>
            ) : null}

            <Pressable onPress={onClose} hitSlop={6} className="rounded-md p-1.5">
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Body */}
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View className="items-center pt-10">
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : null}

            {error ? (
              <Text className="pt-10 text-center text-sm text-destructive">{error}</Text>
            ) : null}

            {/* External source: open-in-browser CTA (RN can't embed iframes). */}
            {!loading && !error && externalSource && viewerUrl ? (
              <View className="items-center pt-10" style={{ gap: 12 }}>
                <FileText size={32} color={colors.mutedForeground} />
                <Text className="text-sm text-foreground">{externalSource.fileName}</Text>
                <Pressable
                  onPress={() => Linking.openURL(viewerUrl)}
                  className="flex-row items-center rounded-lg bg-primary px-4 py-2.5"
                  style={{ gap: 8 }}
                >
                  <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-primary-foreground">
                    {t('popupDocument.openExternal') || 'Open in browser'}
                  </Text>
                  <ExternalLink size={16} color={colors.primaryForeground} />
                </Pressable>
              </View>
            ) : null}

            {/* Inline document: brick list */}
            {!loading && !error && doc && !externalSource ? (
              <InlineDocumentBody
                doc={doc}
                canEdit={canEdit}
                accessToken={accessToken}
                documents={teamDocuments}
                boards={teamBoards}
                users={teamMembers}
                onDocUpdate={setDoc}
              />
            ) : null}

            {/* No linked document yet */}
            {!loading && !error && !inlineDocumentId && !externalSource && !isCreatingInlineDoc ? (
              <Text className="pt-10 text-center text-sm text-muted-foreground">
                {t('popupDocument.noContent') || 'No content linked yet.'}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── InlineDocumentBody ───────────────────────────────────────────────────────

interface InlineDocumentBodyProps {
  doc: DocFull;
  canEdit: boolean;
  accessToken: string;
  documents: DocSummary[];
  boards: BoardSummary[];
  users: TeamMember[];
  onDocUpdate: (doc: DocFull) => void;
}

function InlineDocumentBody({
  doc,
  canEdit,
  accessToken,
  documents,
  boards,
  users,
  onDocUpdate,
}: InlineDocumentBodyProps) {
  const handleBrickUpdate = useCallback(
    async (brickId: string, newContent: any) => {
      if (!canEdit) return;
      try {
        await updateBrickContent(doc.id, brickId, newContent);
        onDocUpdate({
          ...doc,
          bricks: doc.bricks.map((b: DocBrick) =>
            b.id === brickId ? { ...b, content: newContent } : b,
          ),
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
        const created = await appendDocumentBlock(doc.id, kind, initialContent ?? {});
        const newBrick: DocBrick = { id: created.id, kind, content: initialContent ?? {} };
        const updatedBricks = [...doc.bricks];
        if (afterBrickId) {
          const idx = updatedBricks.findIndex((b: DocBrick) => b.id === afterBrickId);
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
        await removeBrick(doc.id, brickId);
        onDocUpdate({ ...doc, bricks: doc.bricks.filter((b: DocBrick) => b.id !== brickId) });
      } catch {
        // ignore
      }
    },
    [doc, canEdit, accessToken, onDocUpdate],
  );

  const handleReorderBricks = useCallback(
    async (ids: string[]) => {
      if (!canEdit) return;
      const reordered = ids
        .map((bid: string) => doc.bricks.find((b: DocBrick) => b.id === bid))
        .filter(Boolean) as DocBrick[];
      onDocUpdate({ ...doc, bricks: reordered });
      try {
        await reorderBricks(doc.id, ids);
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
        await patchBrickCell(doc.id, brickId, patch as any);
      } catch {
        // ignore
      }
    },
    [doc.id, canEdit, accessToken],
  );

  return (
    <UnifiedBrickList
      bricks={doc.bricks}
      activeBricks={doc.bricks}
      canEdit={canEdit}
      documents={documents}
      boards={boards}
      users={users as any}
      onUpdateBrick={handleBrickUpdate}
      onAddBrick={handleAddBrick}
      onDeleteBrick={handleDeleteBrick}
      onReorderBricks={handleReorderBricks}
      onPatchCell={handlePatchCell}
      onPatchColumn={handlePatchCell}
    />
  );
}
