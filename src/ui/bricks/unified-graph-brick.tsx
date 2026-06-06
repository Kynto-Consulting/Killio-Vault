import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line as SvgLine,
  Path,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  BarChart2,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  AreaChart as AreaChartIcon,
  Settings2,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslations } from "@/i18n";
import { sheetEngine } from "../sheet-engine";
import { colors } from "@/theme/theme";
import { fonts } from "@/theme/fonts";

// Mobile: recharts is not available in React Native. The four chart types
// (bar / line / area / pie) are re-implemented below with minimal react-native-svg
// renderers. The data shape (chartData: Array<{ name, [series]: number }>) and the
// table/manual data-binding are preserved 1:1 with the web brick.

type GraphType = "line" | "bar" | "pie" | "area";

type TableSourceConfig = {
  brickId: string;
  xAxisColumn: number;
  dataColumns: number[];
};

type GraphConfig = {
  type: GraphType;
  title?: string;
  data?: Array<Record<string, any>>;
  tableSource?: TableSourceConfig;
};

interface GraphBrickProps {
  id: string;
  config: GraphConfig | undefined;
  onUpdate: (newConfig: GraphConfig) => void;
  readonly?: boolean;
  activeBricks?: Array<any>;
}

const COLORS = ["#0f172a", "#2563eb", "#0d9488", "#f97316", "#dc2626", "#7c3aed"];

const DEFAULT_MANUAL_DATA = [
  { name: "A", value: 10 },
  { name: "B", value: 20 },
  { name: "C", value: 15 },
];

// Fixed drawing surface; the SVG scales responsively via viewBox on the parent.
const CHART_W = 320;
const CHART_H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;

const niceMax = (max: number): number => {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
};

export const UnifiedGraphBrick: React.FC<GraphBrickProps> = ({ id, config, onUpdate, readonly, activeBricks = [] }) => {
  const t = useTranslations("document-detail");
  const safeConfig: GraphConfig = {
    type: config?.type || "line",
    title: config?.title || t("graph.defaultTitle"),
    data: Array.isArray(config?.data) && config?.data.length > 0 ? config?.data : DEFAULT_MANUAL_DATA,
    tableSource: config?.tableSource,
  };

  const [isConfiguring, setIsConfiguring] = useState<boolean>(!readonly && !safeConfig.tableSource && !config);
  const [manualJson, setManualJson] = useState<string>(JSON.stringify(safeConfig.data, null, 2));
  const [jsonError, setJsonError] = useState<string>("");

  const resolveTableRows = (brick: any): string[][] => {
    const directRows = Array.isArray(brick?.rows) ? brick.rows : null;
    if (directRows && directRows.length > 0) return directRows as string[][];

    const contentRows = Array.isArray(brick?.content?.rows) ? brick.content.rows : null;
    if (contentRows && contentRows.length > 0) return contentRows as string[][];

    return [];
  };

  const resolveTableTitle = (brick: any): string => {
    const raw = brick?.title || brick?.content?.title;
    const normalized = String(raw || "").trim();
    if (normalized) return normalized;
    return `Tabla ${String(brick?.id || "").slice(0, 8)}`;
  };

  const availableTables = useMemo(() => {
    return activeBricks
      .filter((brick) => brick?.kind === "table")
      .map((brick) => ({
        id: String(brick.id),
        title: resolveTableTitle(brick),
        rows: resolveTableRows(brick),
      }))
      .filter((table) => table.rows.length > 0);
  }, [activeBricks]);

  const selectedTable = useMemo(() => {
    const selectedId = safeConfig.tableSource?.brickId;
    if (!selectedId) return null;
    return availableTables.find((table) => table.id === selectedId) || null;
  }, [availableTables, safeConfig.tableSource?.brickId]);

  const tableHeaders = selectedTable?.rows?.[0] || [];

  const chartData = useMemo(() => {
    if (selectedTable && safeConfig.tableSource) {
      const rows = selectedTable.rows;
      if (!rows || rows.length < 2 || rows[0].length === 0) return [];

      const sheetId = `graph:${id}:${selectedTable.id}`;
      sheetEngine.updateSheet(sheetId, rows);
      const computed = sheetEngine.getComputedData(sheetId, rows.length, rows[0].length);
      const headers = computed[0] || [];
      const dataRows = computed.slice(1);

      const xIndex = safeConfig.tableSource.xAxisColumn ?? 0;
      const selectedColumns = safeConfig.tableSource.dataColumns?.length ? safeConfig.tableSource.dataColumns : [1];

      return dataRows.map((row: string[], rowIndex: number) => {
        const item: Record<string, any> = {
          name: row[xIndex] || `Fila ${rowIndex + 1}`,
        };

        selectedColumns.forEach((columnIndex) => {
          const key = headers[columnIndex] || `Col ${columnIndex + 1}`;
          const raw = String(row[columnIndex] ?? "").replace(/[$,%\s]/g, "");
          const parsed = Number.parseFloat(raw);
          item[key] = Number.isFinite(parsed) ? parsed : 0;
        });

        return item;
      });
    }

    return Array.isArray(safeConfig.data) ? safeConfig.data : [];
  }, [id, selectedTable, safeConfig.data, safeConfig.tableSource]);

  const dataKeys = useMemo(() => {
    if (chartData.length === 0) return ["value"];
    const keys = Object.keys(chartData[0]).filter((k) => k !== "name");
    return keys.length > 0 ? keys : ["value"];
  }, [chartData]);

  const updateConfig = (patch: Partial<GraphConfig>) => {
    onUpdate({ ...safeConfig, ...patch });
  };

  const applyManualJson = () => {
    try {
      const parsed = JSON.parse(manualJson);
      if (!Array.isArray(parsed)) {
        setJsonError("El JSON debe ser un array de objetos.");
        return;
      }
      setJsonError("");
      updateConfig({ data: parsed, tableSource: undefined });
      setIsConfiguring(false);
    } catch {
      setJsonError(t("graph.invalidJson"));
    }
  };

  const saveTableSource = () => {
    if (!availableTables.length) return;

    const tableId = safeConfig.tableSource?.brickId || availableTables[0].id;
    const selected = availableTables.find((table) => table.id === tableId) || availableTables[0];
    const headers = selected.rows[0] || [];

    const xAxisColumn = Math.min(safeConfig.tableSource?.xAxisColumn ?? 0, Math.max(0, headers.length - 1));
    const fallbackSeries = headers.map((_, idx) => idx).filter((idx) => idx !== xAxisColumn).slice(0, 2);
    const dataColumns = safeConfig.tableSource?.dataColumns?.filter((idx) => idx !== xAxisColumn) || fallbackSeries;

    updateConfig({
      tableSource: {
        brickId: selected.id,
        xAxisColumn,
        dataColumns: dataColumns.length ? dataColumns : fallbackSeries,
      },
    });
    setIsConfiguring(false);
  };

  // Numeric series matrix [seriesIndex][pointIndex] used by every renderer.
  const series = useMemo(
    () =>
      dataKeys.map((key) =>
        chartData.map((d) => {
          const v = Number(d[key]);
          return Number.isFinite(v) ? v : 0;
        }),
      ),
    [dataKeys, chartData],
  );

  const labels = chartData.map((d, i) => String(d.name ?? i + 1));
  const yMax = niceMax(Math.max(1, ...series.flat()));

  const renderEmpty = () => (
    <View style={{ height: CHART_H, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.regular }}>
        No hay datos para renderizar.
      </Text>
    </View>
  );

  const renderAxes = () => (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = PAD.top + PLOT_H * (1 - f);
        return (
          <G key={`grid-${f}`}>
            <SvgLine
              x1={PAD.left}
              y1={y}
              x2={PAD.left + PLOT_W}
              y2={y}
              stroke={colors.mutedForeground}
              strokeOpacity={0.15}
              strokeWidth={1}
            />
            <SvgText
              x={PAD.left - 4}
              y={y + 3}
              fontSize={9}
              fill={colors.mutedForeground}
              textAnchor="end"
            >
              {Math.round(yMax * f)}
            </SvgText>
          </G>
        );
      })}
    </>
  );

  const renderXLabels = () => {
    const n = labels.length || 1;
    const step = PLOT_W / n;
    return labels.map((lbl, i) => (
      <SvgText
        key={`xl-${i}`}
        x={PAD.left + step * (i + 0.5)}
        y={CHART_H - 8}
        fontSize={9}
        fill={colors.mutedForeground}
        textAnchor="middle"
      >
        {lbl.length > 6 ? `${lbl.slice(0, 6)}…` : lbl}
      </SvgText>
    ));
  };

  const renderBars = () => {
    const n = labels.length || 1;
    const groupW = PLOT_W / n;
    const sCount = series.length || 1;
    const barW = (groupW * 0.7) / sCount;
    return (
      <>
        {renderAxes()}
        {series.map((s, si) =>
          s.map((val, pi) => {
            const h = (val / yMax) * PLOT_H;
            const x = PAD.left + groupW * pi + groupW * 0.15 + barW * si;
            return (
              <Rect
                key={`bar-${si}-${pi}`}
                x={x}
                y={PAD.top + PLOT_H - h}
                width={Math.max(1, barW - 1)}
                height={Math.max(0, h)}
                rx={2}
                fill={COLORS[si % COLORS.length]}
              />
            );
          }),
        )}
        {renderXLabels()}
      </>
    );
  };

  const pointsFor = (s: number[]): string => {
    const n = s.length || 1;
    const step = PLOT_W / n;
    return s
      .map((val, i) => {
        const x = PAD.left + step * (i + 0.5);
        const y = PAD.top + PLOT_H - (val / yMax) * PLOT_H;
        return `${x},${y}`;
      })
      .join(" ");
  };

  const renderLine = (filled: boolean) => (
    <>
      {renderAxes()}
      {series.map((s, si) => {
        const pts = pointsFor(s);
        const color = COLORS[si % COLORS.length];
        const n = s.length || 1;
        const step = PLOT_W / n;
        const areaPath =
          filled && s.length > 0
            ? `M ${PAD.left + step * 0.5},${PAD.top + PLOT_H} ${s
                .map((val, i) => {
                  const x = PAD.left + step * (i + 0.5);
                  const y = PAD.top + PLOT_H - (val / yMax) * PLOT_H;
                  return `L ${x},${y}`;
                })
                .join(" ")} L ${PAD.left + step * (s.length - 0.5)},${PAD.top + PLOT_H} Z`
            : "";
        return (
          <G key={`line-${si}`}>
            {filled && areaPath ? <Path d={areaPath} fill={color} fillOpacity={0.2} /> : null}
            <Polyline points={pts} fill="none" stroke={color} strokeWidth={2.25} />
            {s.map((val, i) => {
              const x = PAD.left + step * (i + 0.5);
              const y = PAD.top + PLOT_H - (val / yMax) * PLOT_H;
              return <Circle key={`dot-${si}-${i}`} cx={x} cy={y} r={3} fill={color} />;
            })}
          </G>
        );
      })}
      {renderXLabels()}
    </>
  );

  const renderPie = () => {
    const key = dataKeys[0];
    const values = chartData.map((d) => {
      const v = Number(d[key]);
      return Number.isFinite(v) ? Math.max(0, v) : 0;
    });
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = CHART_W / 2;
    const cy = CHART_H / 2;
    const r = Math.min(PLOT_H, PLOT_W) / 2;
    let angle = -Math.PI / 2;
    return (
      <>
        {values.map((val, i) => {
          const slice = (val / total) * Math.PI * 2;
          const x1 = cx + r * Math.cos(angle);
          const y1 = cy + r * Math.sin(angle);
          angle += slice;
          const x2 = cx + r * Math.cos(angle);
          const y2 = cy + r * Math.sin(angle);
          const large = slice > Math.PI ? 1 : 0;
          const d = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
          return <Path key={`slice-${i}`} d={d} fill={COLORS[i % COLORS.length]} />;
        })}
      </>
    );
  };

  const renderChart = () => {
    if (chartData.length === 0) return renderEmpty();

    let body: React.ReactNode;
    switch (safeConfig.type) {
      case "bar":
        body = renderBars();
        break;
      case "area":
        body = renderLine(true);
        break;
      case "pie":
        body = renderPie();
        break;
      case "line":
      default:
        body = renderLine(false);
        break;
    }

    return (
      <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        {body}
      </Svg>
    );
  };

  // Legend mirrors recharts' <Legend />: a chip per series key.
  const renderLegend = () => {
    if (chartData.length === 0) return null;
    const keys = safeConfig.type === "pie" ? labels : dataKeys;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6, justifyContent: "center" }}>
        {keys.map((k, i) => (
          <View key={`leg-${k}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length] }} />
            <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.regular }}>{k}</Text>
          </View>
        ))}
      </View>
    );
  };

  const typeButton = (type: GraphType, Icon: LucideIcon) => {
    const active = safeConfig.type === type;
    return (
      <Pressable
        onPress={() => updateConfig({ type })}
        style={{
          height: 34,
          paddingHorizontal: 10,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? colors.primary : "transparent",
          borderWidth: 1,
          borderColor: active ? colors.primary : colors.border,
        }}
      >
        <Icon size={15} color={active ? colors.primaryForeground : colors.foreground} />
      </Pressable>
    );
  };

  const sourceButton = (label: string, active: boolean, onPress: () => void, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        height: 34,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        backgroundColor: active ? colors.primary : "transparent",
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontFamily: fonts.medium,
          color: active ? colors.primaryForeground : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={{
        width: "100%",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: 16,
        gap: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View style={{ borderRadius: 6, backgroundColor: colors.indigo + "1a", padding: 6 }}>
            <BarChart2 size={16} color={colors.indigo} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.foreground }} numberOfLines={1}>
              {safeConfig.title || t("graph.defaultTitle")}
            </Text>
            <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.regular, letterSpacing: 0.5 }}>
              {safeConfig.tableSource ? "Fuente: tabla" : "Fuente: manual"}
            </Text>
          </View>
        </View>
        {!readonly && (
          <Pressable
            onPress={() => setIsConfiguring((prev) => !prev)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 8 }}
          >
            <Settings2 size={14} color={colors.foreground} />
            <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: fonts.medium }}>Configurar</Text>
          </Pressable>
        )}
      </View>

      {!readonly && isConfiguring && (
        <View
          style={{
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            padding: 12,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground }}>
            {t("graph.titleLabel")}
          </Text>
          <TextInput
            style={{
              width: "100%",
              borderRadius: 6,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              paddingHorizontal: 8,
              paddingVertical: 8,
              fontSize: 14,
              color: colors.foreground,
              fontFamily: fonts.regular,
            }}
            value={safeConfig.title || ""}
            onChangeText={(text) => updateConfig({ title: text })}
            placeholder={t("graph.titlePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
          />

          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground }}>
              {t("graph.chartType")}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {typeButton("line", LineChartIcon)}
              {typeButton("bar", BarChart2)}
              {typeButton("area", AreaChartIcon)}
              {typeButton("pie", PieChartIcon)}
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
            {sourceButton("Datos manuales", !safeConfig.tableSource, () => updateConfig({ tableSource: undefined }))}
            {sourceButton(
              "Datos desde tabla",
              !!safeConfig.tableSource,
              () => {
                if (!availableTables.length) return;
                const target = safeConfig.tableSource?.brickId || availableTables[0].id;
                updateConfig({
                  tableSource: { brickId: target, xAxisColumn: 0, dataColumns: [1] },
                });
              },
              !availableTables.length,
            )}
          </View>

          {safeConfig.tableSource ? (
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: colors.border, padding: 8, gap: 8 }}>
              {availableTables.length === 0 ? (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.regular }}>
                  No hay bricks de tabla en este contexto.
                </Text>
              ) : (
                <>
                  <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground }}>
                    Tabla fuente
                  </Text>
                  {/* Mobile: <select> replaced by a horizontal chip picker. */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {availableTables.map((table) =>
                      sourceButton(table.title, safeConfig.tableSource?.brickId === table.id, () => {
                        const cols = table.rows?.[0]?.length || 1;
                        updateConfig({
                          tableSource: { brickId: table.id, xAxisColumn: 0, dataColumns: cols > 1 ? [1] : [0] },
                        });
                      }),
                    )}
                  </ScrollView>

                  <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground, marginTop: 4 }}>
                    Eje X
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {tableHeaders.map((header, idx) =>
                      sourceButton(header || `Col ${idx + 1}`, safeConfig.tableSource?.xAxisColumn === idx, () => {
                        const filtered = (safeConfig.tableSource?.dataColumns || []).filter((i) => i !== idx);
                        updateConfig({
                          tableSource: {
                            ...safeConfig.tableSource!,
                            xAxisColumn: idx,
                            dataColumns: filtered.length ? filtered : [0].filter((i) => i !== idx),
                          },
                        });
                      }),
                    )}
                  </ScrollView>

                  <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground, marginTop: 4 }}>
                    Series
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {tableHeaders.map((header, idx) => {
                      const disabled = idx === safeConfig.tableSource?.xAxisColumn;
                      const checked = safeConfig.tableSource?.dataColumns?.includes(idx);
                      if (disabled) return null;
                      return sourceButton(header || `Col ${idx + 1}`, !!checked, () => {
                        const base = safeConfig.tableSource?.dataColumns || [];
                        const next = checked ? base.filter((i) => i !== idx) : [...base, idx];
                        updateConfig({
                          tableSource: { ...safeConfig.tableSource!, dataColumns: next.length ? next : base },
                        });
                      });
                    })}
                  </View>

                  <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                    {sourceButton(t("graph.applyTableConfig"), true, saveTableSource)}
                  </View>
                </>
              )}
            </View>
          ) : (
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: colors.border, padding: 8, gap: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.mutedForeground }}>
                JSON de datos
              </Text>
              <TextInput
                multiline
                style={{
                  minHeight: 120,
                  width: "100%",
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                  fontSize: 12,
                  color: colors.foreground,
                  fontFamily: fonts.mono,
                  textAlignVertical: "top",
                }}
                value={manualJson}
                onChangeText={setManualJson}
              />
              {jsonError ? (
                <Text style={{ fontSize: 12, color: colors.destructive, fontFamily: fonts.regular }}>{jsonError}</Text>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                {sourceButton("Aplicar datos manuales", true, applyManualJson)}
              </View>
            </View>
          )}
        </View>
      )}

      <View
        style={{
          width: "100%",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          padding: 8,
        }}
      >
        {renderChart()}
        {renderLegend()}
      </View>
    </View>
  );
};
