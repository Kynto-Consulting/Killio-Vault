import React, { useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import { RichText } from '../RichText';
import { InlineFormatToolbar } from '../InlineFormatToolbar';
import { useTranslations } from '../../i18n';
import { colors } from '../../theme/theme';
import { fonts } from '../../theme/fonts';

/**
 * React Native port of the web UnifiedTextBrick (Killio-Frontend
 * src/components/bricks/unified-text-brick.tsx — 2.5k lines of contenteditable
 * DOM, KaTeX, shadcn popovers, dnd-kit, slash commands, document.Selection,
 * etc).
 *
 * Mobile: all of that DOM machinery has no analogue on RN, so we delegate to
 * the existing Vault rich-text primitives:
 *
 *   - Display path  → `RichText` (1:1 port of the web rich-text renderer:
 *     headings #..######, blockquote `> `, [color:], [bg:], [size:], [link:],
 *     [lu:], bold/italic/underline/strike/code, fenced ```code```, $$math$$,
 *     references @[doc:…] / $[…] / #[…], <asset .../>).
 *   - Edit path     → `TextInput` (markdown) + `InlineFormatToolbar` (taps
 *     produce **bold**, *italic*, __underline__, ~~strike~~, `code`,
 *     [link:URL], [color:#hex], [bg:#hex], [size:XX], heading/quote prefixes,
 *     [lu:icon] tokens — the same wire format the web brick saves).
 *
 * Tap the brick → it enters inline edit mode. There is NO separate edit/view
 * toggle (the doc detail screen has dropped that toggle — see task #26).
 *
 * Heading / quote / callout / code / checklist are routed at the
 * `BrickRenderer` level in `../BrickRenderer.tsx` — that dispatcher already
 * has sub-renderers for each flavor, so this file only owns the leaf `text`
 * brick. Sibling files `unified-quote-brick.tsx`, `unified-callout-brick.tsx`,
 * `unified-checklist-brick.tsx`, `unified-accordion-brick.tsx` and
 * `unified-bountiful-table.tsx` continue to import `UnifiedTextBrick` as a
 * passthrough — they remain in the web pipeline until each is ported.
 *
 * Mobile: hardware-key shortcuts (Cmd/Ctrl+B/I/U/K) dropped — toolbar is the
 * formatting path.
 * Mobile: drag-and-drop reordering / split-on-drag dropped — brick list
 * handles reorder via long-press in `BrickRenderer.BrickList`.
 * Mobile: floating positioning (getBoundingClientRect / Range / Portal)
 * dropped — the toolbar docks under the input.
 * Mobile: slash-command popover dropped — the "+" affordance between bricks
 * in `BrickList` covers insertion, and the toolbar covers in-line formatting.
 * Mobile: KaTeX rich math display dropped from the inline editor — `RichText`
 * still renders `$$math$$` blocks via `MathRenderer` (WebView KaTeX).
 * Mobile: createRoot / react-dom dropped — diagrams render via
 * `RichText`'s fenced-code path.
 */

/**
 * Web props are preserved here so sibling bricks (quote, callout, checklist,
 * accordion) keep type-compatibility while they finish their own RN port.
 *
 * The mobile renderer only consumes `id`, `text`, `onUpdate`, `readonly`,
 * `onAiAction`, `onComment` and `disabledStyles`. The remaining props
 * (`documents`, `boards`, `folders`, `activeBricks`, `users`, `onAddBrick`,
 * `onPasteImage`) are kept on the type so callers don't have to fork their
 * prop shape but are inert on mobile — the desktop-only flows they unlock
 * (slash-command picker, reference autocompletion, paste-image upload) all
 * need DOM affordances that RN doesn't have.
 */
export interface TextBrickProps {
  id: string;
  text: string;
  onUpdate: (text: string) => void;
  onAddBrick?: (
    kind: string,
    afterBrickId?: string,
    parentProps?: any,
    initialContent?: any,
  ) => void;
  readonly?: boolean;
  /** Web-only autocomplete sources — ignored on mobile. */
  documents?: unknown[];
  /** Web-only autocomplete sources — ignored on mobile. */
  boards?: unknown[];
  /** Web-only autocomplete sources — ignored on mobile. */
  folders?: unknown[];
  /** Web-only autocomplete sources — ignored on mobile. */
  activeBricks?: unknown[];
  /** Web-only autocomplete sources — ignored on mobile. */
  users?: unknown[];
  /** Web-only — RN has no paste-image event. */
  onPasteImage?: (payload: {
    file: unknown;
    cursorOffset: number;
    markdown: string;
  }) => Promise<string | void> | string | void;
  onAiAction?: (action: string, contextText: string) => void;
  /** Opens the brick-comment composer. Hidden when absent. */
  onComment?: () => void;
  /** Toolbar buttons to hide (same keys as the web toolbar). */
  disabledStyles?: string[];
}

export const UnifiedTextBrick: React.FC<TextBrickProps> = ({
  text,
  onUpdate,
  readonly,
  onAiAction,
  onComment,
  disabledStyles = [],
}) => {
  const t = useTranslations('unifiedText');
  // Enter edit mode as soon as the brick mounts editable. The BrickList only
  // renders this component (with onUpdate) once the row is FOCUSED via a tap —
  // so "focused" already means "the user tapped to edit". Starting in `editing`
  // lets a single tap land the caret in the TextInput instead of requiring a
  // second tap, which previously fought the BrickList's focus-toggle Pressable
  // (the 2nd tap toggled the row back to unfocused, so editing never engaged).
  const [editing, setEditing] = useState(true);
  // Local draft so the parent only sees committed updates (parity with the
  // web brick, which also fires onUpdate on blur — see callsites that rely on
  // this in unified-bountiful-table.tsx).
  const [draft, setDraft] = useState(text);
  // Live TextInput selection. The web brick pops a floating format toolbar for
  // the active selection; RN's TextInput exposes the range via
  // onSelectionChange, so we mirror that and feed it to InlineFormatToolbar.
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  // When a toolbar action splices markers in, we briefly drive the TextInput's
  // `selection` prop to re-highlight the wrapped substring, then release
  // control back to the native cursor (controlledSel = null).
  const [controlledSel, setControlledSel] = useState<
    { start: number; end: number } | null
  >(null);

  const hasSelection = selection.end > selection.start;

  const onSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const { start, end } = e.nativeEvent.selection;
    setSelection({ start, end });
    // The user moved the caret manually → stop forcing a controlled selection.
    if (controlledSel && (controlledSel.start !== start || controlledSel.end !== end)) {
      setControlledSel(null);
    }
  };

  // Keep local draft in sync when the brick text changes from outside (e.g.
  // realtime patches from the server) while we're not actively editing.
  React.useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  // Read-only / display path. RichText already handles headings, [color:],
  // [bg:], [size:], [link:], [lu:], bold/italic, fenced code, math blocks,
  // references — full parity with the web display surface.
  if (readonly) {
    return (
      <View>
        <RichText content={text} disabledStyles={disabledStyles} />
      </View>
    );
  }

  // Edit path. Tap to focus; blur commits the draft.
  // Mobile: hardware-key shortcuts dropped — toolbar is the formatting path.
  return (
    <Pressable
      onPress={() => setEditing(true)}
      accessibilityRole="button"
      accessibilityLabel={t('tapToEdit')}
    >
      {editing ? (
        <View>
          {/* Contextual toolbar — anchored ABOVE the input while a non-empty
              selection exists, mirroring the web's floating selection toolbar. */}
          {hasSelection ? (
            <View style={{ marginBottom: 8 }}>
              <InlineFormatToolbar
                visible
                value={draft}
                onChange={setDraft}
                selection={selection}
                onSelectionAfterWrap={setControlledSel}
                disabledStyles={disabledStyles}
                onAiAction={
                  onAiAction ? (action) => onAiAction(action, draft) : undefined
                }
                onComment={onComment}
                onClose={() => setEditing(false)}
              />
            </View>
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSelectionChange={onSelectionChange}
            selection={controlledSel ?? undefined}
            onBlur={() => {
              setEditing(false);
              if (draft !== text) onUpdate(draft);
            }}
            multiline
            autoFocus
            placeholder={t('placeholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{
              fontFamily: fonts.regular,
              color: colors.foreground,
              fontSize: 15,
              lineHeight: 22,
              padding: 0,
              minHeight: 24,
            }}
          />
          {/* Persistent toolbar below — shown when nothing is selected so the
              user always has a formatting path (block prefixes, lucide, etc.).
              When a selection exists the contextual toolbar above takes over. */}
          {!hasSelection ? (
            <View style={{ marginTop: 8 }}>
              <InlineFormatToolbar
                visible
                value={draft}
                onChange={setDraft}
                selection={selection}
                onSelectionAfterWrap={setControlledSel}
                disabledStyles={disabledStyles}
                onAiAction={
                  onAiAction ? (action) => onAiAction(action, draft) : undefined
                }
                onComment={onComment}
                onClose={() => setEditing(false)}
              />
            </View>
          ) : null}
        </View>
      ) : text.length > 0 ? (
        <RichText content={text} disabledStyles={disabledStyles} />
      ) : (
        // Empty state — tap target keeps a finite hit area so the user can
        // actually enter the brick when there is no rendered content.
        <View
          style={{
            minHeight: 22,
            justifyContent: 'center',
            // Mobile: no hover state — the placeholder color itself signals "tap me".
          }}
        >
          <RichText content={t('placeholder')} color={colors.mutedForeground} />
        </View>
      )}
    </Pressable>
  );
};
