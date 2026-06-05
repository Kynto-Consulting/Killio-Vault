import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createDocument as apiCreateDocument,
  createFolder as apiCreateFolder,
  deleteDocument as apiDeleteDocument,
  deleteFolder as apiDeleteFolder,
  updateDocument as apiUpdateDocument,
  updateFolder as apiUpdateFolder,
  type DocSummary,
  type FolderSummary,
} from '@/core/api/documents.client';
import { useAuth } from '@/core/auth/AuthContext';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Centralizes the document/folder CRUD modals so any screen (workspace home,
 * documents browser, document detail) can trigger "create folder", "rename
 * doc", "delete doc", etc. without re-implementing the UI. Modeled after the
 * web frontend's CreateDocumentModal / EditDocumentModal / FolderModal /
 * ConfirmDialog trio.
 *
 * The provider holds no document list of its own — callers refresh after a
 * mutation succeeds via the `onDone` callback they pass to each opener.
 */
interface DocumentsApi {
  openCreateDocument(opts: {
    folderId?: string | null;
    onCreated?: (doc: { id: string; title: string }) => void;
  }): void;
  openEditDocument(doc: DocSummary, opts?: {
    onSaved?: (doc: DocSummary) => void;
  }): void;
  openDeleteDocument(doc: DocSummary, opts?: {
    onDeleted?: (id: string) => void;
  }): void;
  openCreateFolder(opts: {
    parentFolderId?: string | null;
    onCreated?: (folder: FolderSummary) => void;
  }): void;
  openEditFolder(folder: FolderSummary, opts?: {
    onSaved?: (folder: FolderSummary) => void;
  }): void;
  openDeleteFolder(folder: FolderSummary, opts?: {
    onDeleted?: (id: string) => void;
  }): void;
}

const DocumentsContext = createContext<DocumentsApi | null>(null);

type ModalState =
  | { kind: 'create_doc'; folderId: string | null; onCreated?: (d: { id: string; title: string }) => void }
  | { kind: 'edit_doc'; doc: DocSummary; onSaved?: (d: DocSummary) => void }
  | { kind: 'delete_doc'; doc: DocSummary; onDeleted?: (id: string) => void }
  | { kind: 'create_folder'; parentFolderId: string | null; onCreated?: (f: FolderSummary) => void }
  | { kind: 'edit_folder'; folder: FolderSummary; onSaved?: (f: FolderSummary) => void }
  | { kind: 'delete_folder'; folder: FolderSummary; onDeleted?: (id: string) => void }
  | null;

const FOLDER_ICONS = ['📁', '📚', '📝', '🎙️', '🧠', '⚙️', '🚀', '🎯', '🗂️'];
const FOLDER_COLORS = ['#64748b', '#22d3ee', '#a5b4fc', '#fcd34d', '#d8ff72', '#fca5a5'];

export function DocumentsProvider({ children }: { children: React.ReactNode }) {
  const { activeTeam } = useAuth();
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    if (!busy) setModal(null);
  }, [busy]);

  const api = useMemo<DocumentsApi>(
    () => ({
      openCreateDocument: ({ folderId = null, onCreated }) =>
        setModal({ kind: 'create_doc', folderId, onCreated }),
      openEditDocument: (doc, { onSaved } = {}) =>
        setModal({ kind: 'edit_doc', doc, onSaved }),
      openDeleteDocument: (doc, { onDeleted } = {}) =>
        setModal({ kind: 'delete_doc', doc, onDeleted }),
      openCreateFolder: ({ parentFolderId = null, onCreated }) =>
        setModal({ kind: 'create_folder', parentFolderId, onCreated }),
      openEditFolder: (folder, { onSaved } = {}) =>
        setModal({ kind: 'edit_folder', folder, onSaved }),
      openDeleteFolder: (folder, { onDeleted } = {}) =>
        setModal({ kind: 'delete_folder', folder, onDeleted }),
    }),
    [],
  );

  return (
    <DocumentsContext.Provider value={api}>
      {children}
      <ModalHost
        modal={modal}
        close={close}
        busy={busy}
        setBusy={setBusy}
        teamId={activeTeam?.id ?? null}
      />
    </DocumentsContext.Provider>
  );
}

export function useDocuments(): DocumentsApi {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments must be used within DocumentsProvider');
  return ctx;
}

// ─── Modal host ──────────────────────────────────────────────────────────────

function ModalHost({
  modal,
  close,
  busy,
  setBusy,
  teamId,
}: {
  modal: ModalState;
  close: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  teamId: string | null;
}) {
  if (!modal) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-background/80 p-6">
        <View className="w-full max-w-md rounded-2xl border border-border bg-card p-5 gap-3">
          {modal.kind === 'create_doc' && (
            <CreateDocForm
              folderId={modal.folderId}
              teamId={teamId}
              onCancel={close}
              onSubmit={async (title) => {
                if (!teamId) return;
                setBusy(true);
                try {
                  const doc = await apiCreateDocument({
                    teamId,
                    title,
                    folderId: modal.folderId,
                  });
                  modal.onCreated?.({ id: doc.id, title: doc.title });
                  close();
                } finally {
                  setBusy(false);
                }
              }}
              busy={busy}
            />
          )}

          {modal.kind === 'edit_doc' && (
            <EditDocForm
              doc={modal.doc}
              onCancel={close}
              busy={busy}
              onSubmit={async (title) => {
                setBusy(true);
                try {
                  await apiUpdateDocument(modal.doc.id, { title });
                  modal.onSaved?.({ ...modal.doc, title });
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          {modal.kind === 'delete_doc' && (
            <ConfirmDelete
              title="Eliminar documento"
              description={`Esta acción no se puede deshacer. "${modal.doc.title}" se perderá.`}
              confirmLabel="Eliminar"
              busy={busy}
              onCancel={close}
              onConfirm={async () => {
                setBusy(true);
                try {
                  await apiDeleteDocument(modal.doc.id);
                  modal.onDeleted?.(modal.doc.id);
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          {modal.kind === 'create_folder' && (
            <FolderForm
              title="Nueva carpeta"
              onCancel={close}
              busy={busy}
              onSubmit={async ({ name, icon, color }) => {
                if (!teamId) return;
                setBusy(true);
                try {
                  const f = await apiCreateFolder({
                    teamId,
                    name,
                    parentFolderId: modal.parentFolderId,
                    icon,
                    color,
                  });
                  modal.onCreated?.(f);
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          {modal.kind === 'edit_folder' && (
            <FolderForm
              title="Editar carpeta"
              initial={modal.folder}
              onCancel={close}
              busy={busy}
              onSubmit={async ({ name, icon, color }) => {
                setBusy(true);
                try {
                  await apiUpdateFolder(modal.folder.id, { name, icon, color });
                  modal.onSaved?.({ ...modal.folder, name, icon, color });
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          {modal.kind === 'delete_folder' && (
            <ConfirmDelete
              title="Eliminar carpeta"
              description={`"${modal.folder.name}" y su contenido serán eliminados.`}
              confirmLabel="Eliminar"
              busy={busy}
              onCancel={close}
              onConfirm={async () => {
                setBusy(true);
                try {
                  await apiDeleteFolder(modal.folder.id);
                  modal.onDeleted?.(modal.folder.id);
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Forms ───────────────────────────────────────────────────────────────────

function CreateDocForm({
  folderId,
  teamId,
  onCancel,
  onSubmit,
  busy,
}: {
  folderId: string | null;
  teamId: string | null;
  onCancel: () => void;
  onSubmit: (title: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState('');
  const disabled = busy || !title.trim() || !teamId;
  return (
    <>
      <Text style={{ fontFamily: fonts.bold }} className="text-lg text-foreground">
        Nuevo documento
      </Text>
      <Text className="text-xs text-muted-foreground">
        {folderId ? 'Se creará dentro de la carpeta actual.' : 'Se creará en la raíz.'}
      </Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Título del documento"
        placeholderTextColor="#6f6f78"
        autoFocus
        style={{ fontFamily: fonts.regular }}
        className="h-12 rounded-xl border border-border bg-background px-3 text-foreground"
      />
      <ActionRow
        onCancel={onCancel}
        onSubmit={() => !disabled && onSubmit(title.trim())}
        submitLabel={busy ? 'Creando…' : 'Crear'}
        disabled={disabled}
      />
    </>
  );
}

function EditDocForm({
  doc,
  onCancel,
  onSubmit,
  busy,
}: {
  doc: DocSummary;
  onCancel: () => void;
  onSubmit: (title: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const disabled = busy || !title.trim() || title.trim() === doc.title;
  return (
    <>
      <Text style={{ fontFamily: fonts.bold }} className="text-lg text-foreground">
        Editar documento
      </Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        autoFocus
        style={{ fontFamily: fonts.regular }}
        className="h-12 rounded-xl border border-border bg-background px-3 text-foreground"
      />
      <ActionRow
        onCancel={onCancel}
        onSubmit={() => !disabled && onSubmit(title.trim())}
        submitLabel={busy ? 'Guardando…' : 'Guardar'}
        disabled={disabled}
      />
    </>
  );
}

function FolderForm({
  title: header,
  initial,
  onCancel,
  onSubmit,
  busy,
}: {
  title: string;
  initial?: { name: string; icon?: string | null; color?: string | null };
  onCancel: () => void;
  onSubmit: (data: { name: string; icon?: string; color?: string }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<string>(initial?.icon ?? FOLDER_ICONS[0]);
  const [color, setColor] = useState<string>(initial?.color ?? FOLDER_COLORS[0]);
  const disabled = busy || !name.trim();
  return (
    <>
      <Text style={{ fontFamily: fonts.bold }} className="text-lg text-foreground">
        {header}
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Nombre"
        placeholderTextColor="#6f6f78"
        autoFocus
        style={{ fontFamily: fonts.regular }}
        className="h-12 rounded-xl border border-border bg-background px-3 text-foreground"
      />
      <Text className="text-xs text-muted-foreground mt-1">Ícono</Text>
      <View className="flex-row flex-wrap gap-2">
        {FOLDER_ICONS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => setIcon(emoji)}
            className={`h-9 w-9 items-center justify-center rounded-md border ${icon === emoji ? 'border-cyan bg-cyan/10' : 'border-border bg-background'}`}
          >
            <Text style={{ fontSize: 18 }}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-xs text-muted-foreground mt-1">Color</Text>
      <View className="flex-row flex-wrap gap-2">
        {FOLDER_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            className={`h-7 w-7 rounded-full border ${color === c ? 'border-foreground' : 'border-border'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </View>
      <ActionRow
        onCancel={onCancel}
        onSubmit={() => !disabled && onSubmit({ name: name.trim(), icon, color })}
        submitLabel={busy ? 'Guardando…' : 'Guardar'}
        disabled={disabled}
      />
    </>
  );
}

function ConfirmDelete({
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <Text style={{ fontFamily: fonts.bold }} className="text-lg text-destructive">
        {title}
      </Text>
      <Text className="text-sm text-foreground/80">{description}</Text>
      <ActionRow
        onCancel={onCancel}
        onSubmit={onConfirm}
        submitLabel={busy ? 'Eliminando…' : confirmLabel}
        submitVariant="destructive"
        disabled={busy}
      />
    </>
  );
}

function ActionRow({
  onCancel,
  onSubmit,
  submitLabel,
  submitVariant = 'primary',
  disabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitVariant?: 'primary' | 'destructive';
  disabled?: boolean;
}) {
  return (
    <View className="flex-row justify-end gap-2 mt-2">
      <Pressable
        onPress={onCancel}
        className="rounded-md border border-border bg-secondary px-4 py-2"
      >
        <Text style={{ fontFamily: fonts.medium, color: colors.foreground }} className="text-sm">
          Cancelar
        </Text>
      </Pressable>
      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-2 ${
          submitVariant === 'destructive' ? 'bg-destructive' : 'bg-primary'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <Text
          style={{
            fontFamily: fonts.semibold,
            color: submitVariant === 'destructive' ? '#fff' : '#171717',
          }}
          className="text-sm"
        >
          {submitLabel}
        </Text>
      </Pressable>
    </View>
  );
}
