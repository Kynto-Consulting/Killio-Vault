/**
 * Structured tool input/output renderer — RN port of Killio-Frontend
 * src/components/agent/tool-call-chip.tsx (`InputKV` + `OutputSummary` +
 * `humanizeKey`/`formatScalar`/`SKIP_KEYS`). Replaces Vault's old raw-JSON dump
 * in the expanded tool pill with the same friendly key→value rows the web shows.
 *
 * Vault extra: when a string output contains `<contact>` blocks (contacts_search
 * device tool) we render contact chips instead of the raw tag text.
 */
import { Text, View } from 'react-native';

import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';
import { ContactChips, hasContactBlocks, parseContacts, stripContacts } from './contact-block';

// Keys that are internal IDs — skipped in the human-readable display (web parity).
const SKIP_KEYS = new Set([
  'teamId', 'boardId', 'listId', 'cardId', 'documentId', 'meshId', 'scriptId',
  'userId', 'id', 'assigneeId', 'tagId', 'brickId', 'nodeId', 'connectionId',
]);

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatScalar(value: unknown, maxLen = 80): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const s = value.trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s || '—';
  }
  return String(value);
}

const labelStyle = {
  fontFamily: fonts.medium,
  fontSize: 10,
  color: colors.mutedForeground,
  textTransform: 'capitalize' as const,
};
const valueStyle = (isError?: boolean) => ({
  fontFamily: fonts.mono,
  fontSize: 11,
  color: isError ? colors.destructive : colors.foreground,
});

function KVRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 2 }}>
      <Text style={[labelStyle, { width: 78 }]}>{humanizeKey(k)}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/** Friendly key→value rows for a tool's input (skips ids / empties). */
export function InputKV({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input).filter(([k, v]) => {
    if (SKIP_KEYS.has(k)) return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
      return false;
    return true;
  });
  if (entries.length === 0) return null;
  return (
    <View>
      {entries.map(([key, val]) => (
        <KVRow key={key} k={key}>
          <Text style={valueStyle()}>
            {Array.isArray(val)
              ? (val as unknown[]).map((v) => formatScalar(v)).join(', ') || '—'
              : typeof val === 'object' && val !== null
                ? '…'
                : formatScalar(val)}
          </Text>
        </KVRow>
      ))}
    </View>
  );
}

/** The most useful SECONDARY scalar to show next to an item's label. Prefers a
 *  phone/number/value/email/url/status, falling back to id. Keeps the render
 *  informative (the user complained it "muestra casi nada"). */
function secondaryValue(obj: Record<string, unknown>): string {
  // Contact-shaped item (phone / number / numbers present) → show the number.
  if (obj.phone || obj.number || Array.isArray(obj.numbers)) {
    const num =
      obj.phone ??
      obj.number ??
      (Array.isArray(obj.numbers) ? (obj.numbers as unknown[])[0] : undefined);
    if (num != null && String(num).trim()) return formatScalar(num, 40);
  }
  for (const key of ['value', 'email', 'url', 'status']) {
    if (obj[key] != null && String(obj[key]).trim()) return formatScalar(obj[key], 40);
  }
  // Domain-specific extras (board/list parity) before falling back to id.
  for (const key of ['boardType', 'visibility', 'updatedAt']) {
    if (obj[key] != null && String(obj[key]).trim()) return formatScalar(obj[key], 40);
  }
  if (obj.id != null && String(obj.id).trim()) return formatScalar(obj.id, 40);
  return '';
}

function formatPreviewItem(item: unknown): string {
  if (item === null || item === undefined) return '—';
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
    return formatScalar(item, 80);
  if (Array.isArray(item)) return `${item.length} item${item.length !== 1 ? 's' : ''}`;
  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const primary = formatScalar(obj.title ?? obj.name ?? obj.label ?? obj.id, 80);
    const secondary = secondaryValue(obj);
    // Avoid duplicating when the label already equals the secondary (e.g. id).
    return secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
  }
  return formatScalar(item, 80);
}

function ArrayPreview({ arr, showCount = true }: { arr: unknown[]; showCount?: boolean }) {
  const items = arr.slice(0, 3).map(formatPreviewItem).filter(Boolean);
  return (
    <View style={{ gap: 4 }}>
      {showCount ? (
        <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.mutedForeground }}>
          {arr.length} item{arr.length !== 1 ? 's' : ''}
        </Text>
      ) : null}
      {items.length > 0 ? (
        <View
          style={{
            gap: 2,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.muted,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          {items.map((item, i) => (
            <Text key={i} style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground }}>
              {i + 1}. {item}
            </Text>
          ))}
          {arr.length > 3 ? (
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.mutedForeground }}>
              …
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Structured summary for a tool's output. Mirrors the web OutputSummary. */
export function OutputSummary({ output, isError }: { output: unknown; isError: boolean }) {
  if (output === null || output === undefined) return null;

  // Plain string — but first lift any <contact> blocks into chips (Vault).
  if (typeof output === 'string') {
    const s = output.trim();
    if (!s) return null;
    if (hasContactBlocks(s)) {
      const contacts = parseContacts(s);
      const rest = stripContacts(s);
      return (
        <View style={{ gap: 4 }}>
          <ContactChips contacts={contacts} />
          {rest ? (
            <Text style={valueStyle(isError)}>{rest.length > 400 ? rest.slice(0, 400) + '…' : rest}</Text>
          ) : null}
        </View>
      );
    }
    return <Text style={valueStyle(isError)}>{s.length > 400 ? s.slice(0, 400) + '…' : s}</Text>;
  }

  if (Array.isArray(output)) return <ArrayPreview arr={output as unknown[]} />;

  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (obj.error || (obj.message && isError)) {
      return <Text style={valueStyle(true)}>{formatScalar(obj.error ?? obj.message)}</Text>;
    }
    // Meaningful scalars first — phone/number/value/count are ALWAYS surfaced so
    // a contact/result object never collapses to just a label (the "muestra casi
    // nada" complaint). id is shown last (least useful).
    const importantKeys = [
      'title', 'name', 'label', 'phone', 'number', 'numbers', 'value', 'email',
      'url', 'status', 'count', 'message', 'result', 'output', 'content', 'id',
    ];
    const shown: [string, unknown][] = [];
    for (const k of importantKeys) {
      if (k in obj && obj[k] !== null && obj[k] !== undefined) {
        if (Array.isArray(obj[k])) shown.push([k, { __arr: obj[k] as unknown[] }]);
        else shown.push([k, obj[k]]);
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (shown.length >= 6) break;
      if (importantKeys.includes(k) || SKIP_KEYS.has(k)) continue;
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        shown.push([k, { __arr: v }]);
        continue;
      }
      if (typeof v === 'object') {
        const nested = Object.entries(v as Record<string, unknown>)
          .filter(([, nv]) => nv !== null && nv !== undefined)
          .slice(0, 2)
          .map(([nk, nv]) => `${humanizeKey(nk)}: ${formatScalar(nv, 40)}`)
          .join(' · ');
        if (nested) shown.push([k, nested]);
        continue;
      }
      shown.push([k, v]);
    }
    if (shown.length === 0) {
      return (
        <Text style={valueStyle(isError)}>{JSON.stringify(obj, null, 1).slice(0, 600)}</Text>
      );
    }
    return (
      <View>
        {shown.map(([k, v]) => (
          <KVRow key={k} k={k}>
            {v && typeof v === 'object' && '__arr' in (v as object) ? (
              <ArrayPreview arr={(v as { __arr: unknown[] }).__arr} />
            ) : (
              <Text style={valueStyle(isError)}>{formatScalar(v, 120)}</Text>
            )}
          </KVRow>
        ))}
      </View>
    );
  }

  return <Text style={valueStyle(isError)}>{formatScalar(output)}</Text>;
}
