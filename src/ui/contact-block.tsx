/**
 * `<contact>` block rendering. The contacts_search device tool returns its
 * matches as `<contact><name>…</name><number>…</number></contact>` blocks. The
 * web never had a dedicated renderer (these are Vault-only device tools), so we
 * mirror the FRONT's *approach* — a clean structured chip instead of raw tags —
 * with a person icon + name + tappable number. Used in BOTH the tool-output pill
 * (AgentMessage) and inline assistant text (RichText).
 */
import { Linking, Pressable, Text, View } from 'react-native';
import { Phone, User } from 'lucide-react-native';

import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

export interface ParsedContact {
  name: string;
  number: string;
}

const CONTACT_RE = /<contact>([\s\S]*?)<\/contact>/gi;
const FIELD_RE = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');

/** True if the string contains at least one `<contact>…</contact>` block. */
export function hasContactBlocks(s: string): boolean {
  if (!s) return false;
  CONTACT_RE.lastIndex = 0;
  return CONTACT_RE.test(s);
}

/** Extracts every `<contact>` block. Tolerant of extra inner tags / whitespace. */
export function parseContacts(s: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  if (!s) return out;
  CONTACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTACT_RE.exec(s))) {
    const body = m[1];
    const name = body.match(FIELD_RE('name'))?.[1]?.trim() ?? '';
    const number =
      body.match(FIELD_RE('number'))?.[1]?.trim() ??
      body.match(FIELD_RE('phone'))?.[1]?.trim() ??
      '';
    if (name || number) out.push({ name, number });
  }
  return out;
}

/** Removes every `<contact>` block from a string (so surrounding prose can render alone). */
export function stripContacts(s: string): string {
  return s.replace(CONTACT_RE, '').trim();
}

function ContactRow({ contact }: { contact: ParsedContact }) {
  const number = contact.number;
  return (
    <Pressable
      onPress={number ? () => void Linking.openURL(`tel:${number}`) : undefined}
      className="flex-row items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-2.5 py-1.5 active:opacity-80"
    >
      <View className="h-7 w-7 items-center justify-center rounded-full bg-secondary">
        <User size={14} color={colors.cyan} />
      </View>
      <View className="flex-1">
        {contact.name ? (
          <Text
            style={{ fontFamily: fonts.medium }}
            className="text-[13px] text-foreground"
            numberOfLines={1}
          >
            {contact.name}
          </Text>
        ) : null}
        {number ? (
          <View className="flex-row items-center gap-1">
            <Phone size={10} color={colors.mutedForeground} />
            <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
              {number}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Renders a stack of contact chips from already-parsed contacts. */
export function ContactChips({ contacts }: { contacts: ParsedContact[] }) {
  if (!contacts.length) return null;
  return (
    <View className="gap-1">
      {contacts.map((c, i) => (
        <ContactRow key={`${c.name}-${c.number}-${i}`} contact={c} />
      ))}
    </View>
  );
}
