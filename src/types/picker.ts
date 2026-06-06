/**
 * Reference picker — shared types between RichText, ReferencePicker and any
 * brick that wants to wire its own picker trigger.
 *
 * Mirrors `Killio-Frontend/src/components/documents/reference-picker.tsx`
 * (`ReferencePickerSelection`) so the same `@[type:id|Name]` tokens emitted
 * by web round-trip through Vault unchanged. Only the categories Vault
 * currently exposes are listed here (no integration/extension surfaces yet).
 */

export type MentionType =
  | 'doc'
  | 'board'
  | 'mesh'
  | 'card'
  | 'user'
  | 'folder'
  | 'room'
  | 'thread'
  | 'transcript'
  | 'event';

export interface ReferencePickerSelection {
  /** Insertable token, e.g. `@[doc:abc123:Roadmap 2026]`. */
  token: string;
  /** Display label for the resolved entity. */
  label: string;
  /** Underlying entity id (the part the consumer uses to navigate). */
  id: string;
  /** Which kind of reference this is. */
  mentionType: MentionType;
  /** UI category — Vault only emits "mention" for now. */
  category?: 'mention';
}

export interface PickerDocument {
  id: string;
  title: string;
  folderPath?: string;
}

export interface PickerBoard {
  id: string;
  name: string;
  /** Optional kanban vs mesh discriminator — only mesh boards get the mesh pill. */
  boardType?: 'kanban' | 'mesh';
}

export interface PickerCard {
  id: string;
  title: string;
  boardName?: string;
  listName?: string;
}

export interface PickerUser {
  id: string;
  name?: string;
  alias?: string | null;
  email?: string;
  avatarUrl?: string | null;
}

export interface PickerFolder {
  id: string;
  name: string;
  icon?: string;
}

export interface PickerActiveBrick {
  id: string;
  label?: string;
  kind?: string;
}
