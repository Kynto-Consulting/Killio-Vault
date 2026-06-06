import React, { createContext, useContext, useState } from 'react';
import { Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * React Native port of the web `unified-form-field-brick.web.tsx`.
 * Renders the FIELD BRICK editor (used inside the form brick at edit time)
 * AND the runtime interactive input (used inside the form viewer). Keeps the
 * same exported component names, types, prop shapes, and helper signatures so
 * `unified-form-brick.tsx` can import without conditionals.
 *
 * Web → Native swap notes:
 *   • <div>/<span>/<label>/<p> → View/Text.
 *   • <select> → bottom-sheet Modal + Pressable rows.
 *   • <input type="checkbox"> → <Switch>.
 *   • <input type="radio"> → group of toggleable Pressable pills.
 *   • <textarea> → <TextInput multiline>.
 *   • shadcn <Input> → bare <TextInput> styled with the Vault tokens.
 *   • `translateNativeTagName` (web maps `tag.native.*` keys to a localized
 *     label via i18n) — Vault has no native-tag dictionary; we render the raw
 *     option string (tags that aren't native still show as their literal
 *     label, which is the dominant case).
 */

export type FormFieldType =
  | 'text'
  | 'email'
  | 'textarea'
  | 'number'
  | 'date'
  | 'tel'
  | 'url'
  | 'checkbox'
  | 'radio'
  | 'select';

export type FormFieldConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_true'
  | 'is_false';

export type FormFieldCondition = {
  enabled: boolean;
  sourceFieldId: string;
  operator: FormFieldConditionOperator;
  value?: string;
};

export type FormFieldConfig = {
  fieldId: string;
  label?: string;
  type: FormFieldType;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  condition?: FormFieldCondition;
};

type FormFieldRuntimeContextValue = {
  interactive: boolean;
  values: Record<string, string | boolean>;
  setValue: (brickId: string, value: string | boolean) => void;
};

const FormFieldRuntimeContext = createContext<FormFieldRuntimeContextValue | null>(null);

export function FormFieldRuntimeProvider({
  value,
  children,
}: {
  value: FormFieldRuntimeContextValue;
  children: React.ReactNode;
}) {
  return <FormFieldRuntimeContext.Provider value={value}>{children}</FormFieldRuntimeContext.Provider>;
}

export function useFormFieldRuntime() {
  return useContext(FormFieldRuntimeContext);
}

const slugifyFieldId = (input: string): string => {
  const value = input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return value.length > 0 ? value : 'field';
};

export function createDefaultFormFieldConfig(overrides?: Partial<FormFieldConfig>): FormFieldConfig {
  const seed = Math.random().toString(36).slice(2, 7);
  return {
    fieldId: `field_${seed}`,
    label: '',
    type: 'text',
    placeholder: '',
    required: false,
    options: [],
    ...overrides,
  };
}

export function normalizeFormFieldConfig(raw: unknown): FormFieldConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const input = raw as Record<string, unknown>;
  const rawFieldId =
    typeof input.fieldId === 'string' && input.fieldId.trim().length > 0
      ? input.fieldId
      : typeof input.label === 'string' && input.label.trim().length > 0
        ? input.label
        : 'field';

  const type = (typeof input.type === 'string' ? input.type : 'text') as FormFieldType;
  const allowedTypes: FormFieldType[] = ['text', 'email', 'textarea', 'number', 'date', 'tel', 'url', 'checkbox', 'radio', 'select'];
  const safeType = allowedTypes.includes(type) ? type : 'text';

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const placeholder = typeof input.placeholder === 'string' ? input.placeholder : '';
  const required = Boolean(input.required);
  const options = Array.isArray(input.options)
    ? input.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  const allowedConditionOperators: FormFieldConditionOperator[] = [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty',
    'is_true',
    'is_false',
  ];

  let condition: FormFieldCondition | undefined;
  if (input.condition && typeof input.condition === 'object') {
    const rawCondition = input.condition as Record<string, unknown>;
    const sourceFieldId = typeof rawCondition.sourceFieldId === 'string' ? slugifyFieldId(rawCondition.sourceFieldId) : '';
    const operator =
      typeof rawCondition.operator === 'string' && allowedConditionOperators.includes(rawCondition.operator as FormFieldConditionOperator)
        ? (rawCondition.operator as FormFieldConditionOperator)
        : 'equals';

    if (sourceFieldId.length > 0) {
      condition = {
        enabled: Boolean(rawCondition.enabled),
        sourceFieldId,
        operator,
        value: typeof rawCondition.value === 'string' ? rawCondition.value : '',
      };
    }
  }

  return {
    fieldId: slugifyFieldId(rawFieldId),
    label,
    type: safeType,
    placeholder,
    required,
    options,
    condition,
  };
}

const operatorNeedsValue = (operator: FormFieldConditionOperator): boolean => {
  return (
    operator === 'equals' ||
    operator === 'not_equals' ||
    operator === 'contains' ||
    operator === 'not_contains'
  );
};

const fieldInputStyle = {
  fontFamily: fonts.regular,
  color: colors.foreground,
  fontSize: 13,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.background,
} as const;

interface UnifiedFormFieldBrickProps {
  id: string;
  config: FormFieldConfig;
  readonly: boolean;
  onUpdate: (config: FormFieldConfig) => void;
  runtimeValue?: string | boolean;
  onRuntimeValueChange?: (value: string | boolean) => void;
  interactive?: boolean;
}

const TYPE_OPTIONS: { value: FormFieldType; group: string; label: string }[] = [
  { value: 'text', group: 'Texto', label: 'Texto corto' },
  { value: 'textarea', group: 'Texto', label: 'Area de texto' },
  { value: 'email', group: 'Texto', label: 'Email' },
  { value: 'url', group: 'Texto', label: 'URL / Enlace' },
  { value: 'tel', group: 'Texto', label: 'Telefono' },
  { value: 'number', group: 'Numeros y fecha', label: 'Numero' },
  { value: 'date', group: 'Numeros y fecha', label: 'Fecha' },
  { value: 'select', group: 'Opciones', label: 'Desplegable' },
  { value: 'radio', group: 'Opciones', label: 'Seleccion unica' },
  { value: 'checkbox', group: 'Opciones', label: 'Casilla' },
];

const OPERATOR_OPTIONS: { value: FormFieldConditionOperator; label: string }[] = [
  { value: 'equals', label: 'igual a' },
  { value: 'not_equals', label: 'distinto de' },
  { value: 'contains', label: 'contiene' },
  { value: 'not_contains', label: 'no contiene' },
  { value: 'is_empty', label: 'esta vacio' },
  { value: 'is_not_empty', label: 'no esta vacio' },
  { value: 'is_true', label: 'es verdadero' },
  { value: 'is_false', label: 'es falso' },
];

export function UnifiedFormFieldBrick({
  id,
  config,
  readonly,
  onUpdate,
  runtimeValue,
  onRuntimeValueChange,
  interactive = false,
}: UnifiedFormFieldBrickProps) {
  // Editor mode ─────────────────────────────────────────────────────────────
  if (!readonly) {
    return (
      <FieldEditor id={id} config={config} onUpdate={onUpdate} />
    );
  }

  // Read-only stub when no runtime is wired up (preview).
  const value = runtimeValue;
  if (!interactive || !onRuntimeValueChange) {
    return (
      <View className="rounded-md border border-dashed border-border/70 bg-secondary/40 p-3 gap-1">
        <Text className="text-xs text-muted-foreground">Field Brick ({config.type})</Text>
      </View>
    );
  }

  // Runtime (interactive) ───────────────────────────────────────────────────
  if (config.type === 'textarea') {
    return (
      <TextInput
        // RN doesn't support form `required` natively — guarded by the parent.
        multiline
        numberOfLines={4}
        placeholder={config.placeholder || ''}
        placeholderTextColor={colors.mutedForeground}
        value={(value as string) || ''}
        onChangeText={(v) => onRuntimeValueChange(v)}
        style={[fieldInputStyle, { minHeight: 96, textAlignVertical: 'top' }]}
      />
    );
  }

  if (config.type === 'select') {
    return (
      <FieldSelectInput
        value={(value as string) || ''}
        placeholder={config.placeholder || 'Selecciona una opcion'}
        options={config.options || []}
        onChange={(v) => onRuntimeValueChange(v)}
      />
    );
  }

  if (config.type === 'radio') {
    return (
      <View className="gap-1.5">
        {(config.options || []).map((option, index) => {
          const selected = value === option;
          return (
            <Pressable
              key={index}
              onPress={() => onRuntimeValueChange(option)}
              className="flex-row items-center gap-2"
            >
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.cyan : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected ? (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyan }}
                  />
                ) : null}
              </View>
              <Text className="text-sm text-foreground">{option}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (config.type === 'checkbox') {
    return (
      <Switch
        value={!!value}
        onValueChange={(v) => onRuntimeValueChange(v)}
        trackColor={{ false: '#2a2a2a', true: colors.cyan }}
      />
    );
  }

  // text / email / number / tel / url / date — all map to TextInput.
  return (
    <TextInput
      placeholder={config.placeholder || ''}
      placeholderTextColor={colors.mutedForeground}
      value={(value as string) || ''}
      onChangeText={(v) => onRuntimeValueChange(v)}
      autoCapitalize={config.type === 'email' || config.type === 'url' ? 'none' : 'sentences'}
      autoCorrect={config.type !== 'email' && config.type !== 'url'}
      keyboardType={
        config.type === 'number'
          ? 'numeric'
          : config.type === 'email'
            ? 'email-address'
            : config.type === 'tel'
              ? 'phone-pad'
              : config.type === 'url'
                ? 'url'
                : 'default'
      }
      style={fieldInputStyle}
      // Mobile: native `<input type="date">` not available in RN. We render a
      // plain text input — a real date picker can be wired in later via
      // @react-native-community/datetimepicker.
    />
  );
}

// ── Editor (config UI shown to the form builder) ────────────────────────────

function FieldEditor({
  id,
  config,
  onUpdate,
}: {
  id: string;
  config: FormFieldConfig;
  onUpdate: (config: FormFieldConfig) => void;
}) {
  // `id` is kept in the signature for parity with the web export (used as
  // <input id={…}> there); RN inputs have no global id.
  void id;
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [operatorPickerOpen, setOperatorPickerOpen] = useState(false);

  const currentTypeLabel = TYPE_OPTIONS.find((o) => o.value === config.type)?.label || config.type;
  const operator = config.condition?.operator || 'equals';
  const currentOperatorLabel = OPERATOR_OPTIONS.find((o) => o.value === operator)?.label || operator;

  return (
    <View className="rounded-lg border border-border/70 bg-secondary/40 p-3 gap-3">
      <View className="flex-row items-center justify-between">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Field Brick
        </Text>
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {config.type}
        </Text>
      </View>

      <View className="gap-2">
        <TextInput
          value={config.label || ''}
          onChangeText={(v) => onUpdate({ ...config, label: v })}
          placeholder="Etiqueta del campo"
          placeholderTextColor={colors.mutedForeground}
          style={fieldInputStyle}
        />

        <Pressable
          onPress={() => setTypePickerOpen(true)}
          className="rounded-md border border-border bg-background px-3 py-2"
        >
          <Text className="text-xs text-foreground">{currentTypeLabel}</Text>
        </Pressable>

        <TextInput
          value={config.placeholder || ''}
          onChangeText={(v) => onUpdate({ ...config, placeholder: v })}
          placeholder="Placeholder"
          placeholderTextColor={colors.mutedForeground}
          editable={config.type !== 'checkbox' && config.type !== 'radio'}
          style={[
            fieldInputStyle,
            config.type === 'checkbox' || config.type === 'radio' ? { opacity: 0.5 } : null,
          ]}
        />
      </View>

      <View className="flex-row items-center gap-3 flex-wrap">
        <Pressable
          onPress={() => onUpdate({ ...config, required: !config.required })}
          className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
        >
          <Switch
            value={!!config.required}
            onValueChange={(v) => onUpdate({ ...config, required: v })}
            trackColor={{ false: '#2a2a2a', true: colors.cyan }}
          />
          <Text className="text-sm text-muted-foreground">Obligatorio</Text>
        </Pressable>
        <View className="flex-row items-center gap-1.5">
          <Text
            style={{ fontFamily: fonts.mono }}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
          >
            {config.fieldId}
          </Text>
          <Text className="text-xs text-muted-foreground">clave del campo</Text>
        </View>
      </View>

      {(config.type === 'select' || config.type === 'radio') && (
        <View className="gap-1.5">
          <TextInput
            value={config.options?.join(', ') || ''}
            onChangeText={(v) =>
              onUpdate({
                ...config,
                options: v
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Opciones separadas por coma"
            placeholderTextColor={colors.mutedForeground}
            style={fieldInputStyle}
          />
          {config.options?.some((o) => o.startsWith('tag.native.')) && (
            <Text className="text-[10px] text-muted-foreground">
              Nota: Las etiquetas nativas se traduciran automaticamente para los usuarios que llenen el formulario.
            </Text>
          )}
        </View>
      )}

      {/* Conditional visibility editor */}
      <View className="rounded-md border border-border/70 bg-background p-3 gap-2">
        <Pressable
          onPress={() =>
            onUpdate({
              ...config,
              condition: {
                enabled: !config.condition?.enabled,
                sourceFieldId: config.condition?.sourceFieldId || '',
                operator: config.condition?.operator || 'equals',
                value: config.condition?.value || '',
              },
            })
          }
          className="flex-row items-center gap-2"
        >
          <Switch
            value={Boolean(config.condition?.enabled)}
            onValueChange={(v) =>
              onUpdate({
                ...config,
                condition: {
                  enabled: v,
                  sourceFieldId: config.condition?.sourceFieldId || '',
                  operator: config.condition?.operator || 'equals',
                  value: config.condition?.value || '',
                },
              })
            }
            trackColor={{ false: '#2a2a2a', true: colors.cyan }}
          />
          <Text className="flex-1 text-sm text-muted-foreground">
            Mostrar este campo solo si se cumple una condicion
          </Text>
        </Pressable>

        {config.condition?.enabled ? (
          <View className="gap-2">
            <TextInput
              value={config.condition?.sourceFieldId || ''}
              onChangeText={(v) =>
                onUpdate({
                  ...config,
                  condition: {
                    enabled: true,
                    sourceFieldId: slugifyFieldId(v),
                    operator: config.condition?.operator || 'equals',
                    value: config.condition?.value || '',
                  },
                })
              }
              placeholder="field_id origen"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={[fieldInputStyle, { fontFamily: fonts.mono }]}
            />

            <Pressable
              onPress={() => setOperatorPickerOpen(true)}
              className="rounded-md border border-border bg-background px-3 py-2"
            >
              <Text className="text-xs text-foreground">{currentOperatorLabel}</Text>
            </Pressable>

            {operatorNeedsValue(operator) ? (
              <TextInput
                value={config.condition?.value || ''}
                onChangeText={(v) =>
                  onUpdate({
                    ...config,
                    condition: {
                      enabled: true,
                      sourceFieldId: config.condition?.sourceFieldId || '',
                      operator: config.condition?.operator || 'equals',
                      value: v,
                    },
                  })
                }
                placeholder="Valor esperado"
                placeholderTextColor={colors.mutedForeground}
                style={fieldInputStyle}
              />
            ) : (
              <View className="rounded-md border border-dashed border-border/60 px-3 py-2">
                <Text className="text-xs text-muted-foreground">Este operador no requiere valor</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* Type picker modal (replaces the web <select><optgroup>) */}
      <Modal
        visible={typePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTypePickerOpen(false)}
      >
        <Pressable
          onPress={() => setTypePickerOpen(false)}
          className="flex-1 items-center justify-end bg-background/80"
        >
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2">
            <Text style={{ fontFamily: fonts.bold }} className="text-base text-foreground">
              Tipo de campo
            </Text>
            {TYPE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onUpdate({ ...config, type: opt.value });
                  setTypePickerOpen(false);
                }}
                className={`rounded-md border border-border bg-background px-3 py-2 ${
                  opt.value === config.type ? 'border-cyan' : ''
                }`}
              >
                <Text className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {opt.group}
                </Text>
                <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Operator picker modal */}
      <Modal
        visible={operatorPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOperatorPickerOpen(false)}
      >
        <Pressable
          onPress={() => setOperatorPickerOpen(false)}
          className="flex-1 items-center justify-end bg-background/80"
        >
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2">
            <Text style={{ fontFamily: fonts.bold }} className="text-base text-foreground">
              Operador
            </Text>
            {OPERATOR_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onUpdate({
                    ...config,
                    condition: {
                      enabled: true,
                      sourceFieldId: config.condition?.sourceFieldId || '',
                      operator: opt.value,
                      value: config.condition?.value || '',
                    },
                  });
                  setOperatorPickerOpen(false);
                }}
                className={`rounded-md border border-border bg-background px-3 py-2 ${
                  opt.value === operator ? 'border-cyan' : ''
                }`}
              >
                <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Bottom-sheet <select> for runtime select inputs ─────────────────────────
function FieldSelectInput({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="rounded-md border border-border bg-background px-3 py-2"
      >
        <Text className="text-sm text-foreground">{value || placeholder}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center justify-end bg-background/80"
        >
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2">
            <Text style={{ fontFamily: fonts.bold }} className="text-base text-foreground">
              {placeholder}
            </Text>
            {options.map((option, index) => (
              <Pressable
                key={index}
                onPress={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`rounded-md border border-border bg-background px-3 py-2 ${
                  option === value ? 'border-cyan' : ''
                }`}
              >
                <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
