"use client";

import { useTranslations } from "@/components/providers/i18n-provider";
import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { BarChart2, LineChart as LineChartIcon, PieChart as PieChartIcon, AreaChart as AreaChartIcon, Settings2 } from "lucide-react";
import { sheetEngine } from "@/lib/sheetEngine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

      return dataRows.map((row, rowIndex) => {
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

  const renderChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
          No hay datos para renderizar.
        </div>
      );
    }

    switch (safeConfig.type) {
      case "bar":
        return (
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground))" opacity={0.15} />
            <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
            <YAxis fontSize={11} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Legend />
            {dataKeys.map((key, idx) => (
              <Bar key={key} dataKey={key} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        );
      case "area":
        return (
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground))" opacity={0.15} />
            <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
            <YAxis fontSize={11} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Legend />
            {dataKeys.map((key, idx) => (
              <Area key={key} type="monotone" dataKey={key} stroke={COLORS[idx % COLORS.length]} fill={COLORS[idx % COLORS.length]} fillOpacity={0.2} />
            ))}
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart>
            <Pie data={chartData} dataKey={dataKeys[0]} nameKey="name" cx="50%" cy="50%" outerRadius={95} label>
              {chartData.map((_, idx) => (
                <Cell key={`slice-${idx}`} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Legend />
          </PieChart>
        );
      case "line":
      default:
        return (
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground))" opacity={0.15} />
            <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
            <YAxis fontSize={11} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Legend />
            {dataKeys.map((key, idx) => (
              <Line key={key} type="monotone" dataKey={key} stroke={COLORS[idx % COLORS.length]} strokeWidth={2.25} dot={{ r: 3, fill: "hsl(var(--card))", strokeWidth: 2 }} />
            ))}
          </LineChart>
        );
    }
  };

  return (
    <div className="w-full rounded-xl border border-border bg-card/60 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <BarChart2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{safeConfig.title || t("graph.defaultTitle")}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {safeConfig.tableSource ? "Fuente: tabla" : "Fuente: manual"}
            </p>
          </div>
        </div>
        {!readonly && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setIsConfiguring((prev) => !prev)}>
            <Settings2 className="h-3.5 w-3.5" /> Configurar
          </Button>
        )}
      </div>

      {!readonly && isConfiguring && (
        <div className="rounded-lg border border-border/70 bg-background/70 p-3 space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">{t("graph.titleLabel")}</label>
          <input
            className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
            value={safeConfig.title || ""}
            onChange={(e) => updateConfig({ title: e.target.value })}
            placeholder={t("graph.titlePlaceholder")}
          />

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted-foreground">{t("graph.chartType")}</label>
            <div className="flex flex-wrap gap-2">
              <Button variant={safeConfig.type === "line" ? "default" : "ghost"} size="sm" className="h-8 px-2" onClick={() => updateConfig({ type: "line" })}>
                <LineChartIcon className="h-3.5 w-3.5" />
              </Button>
              <Button variant={safeConfig.type === "bar" ? "default" : "ghost"} size="sm" className="h-8 px-2" onClick={() => updateConfig({ type: "bar" })}>
                <BarChart2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant={safeConfig.type === "area" ? "default" : "ghost"} size="sm" className="h-8 px-2" onClick={() => updateConfig({ type: "area" })}>
                <AreaChartIcon className="h-3.5 w-3.5" />
              </Button>
              <Button variant={safeConfig.type === "pie" ? "default" : "ghost"} size="sm" className="h-8 px-2" onClick={() => updateConfig({ type: "pie" })}>
                <PieChartIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant={!safeConfig.tableSource ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => updateConfig({ tableSource: undefined })}>
              Datos manuales
            </Button>
            <Button
              variant={safeConfig.tableSource ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (!availableTables.length) return;
                const target = safeConfig.tableSource?.brickId || availableTables[0].id;
                updateConfig({
                  tableSource: {
                    brickId: target,
                    xAxisColumn: 0,
                    dataColumns: [1],
                  },
                });
              }}
              disabled={!availableTables.length}
            >
              Datos desde tabla
            </Button>
          </div>

          {safeConfig.tableSource ? (
            <div className="rounded-md border border-border p-2 space-y-2">
              {availableTables.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay bricks de tabla en este contexto.</p>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-muted-foreground">Tabla fuente</label>
                  <select
                    className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
                    value={safeConfig.tableSource.brickId}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const table = availableTables.find((item) => item.id === selectedId);
                      const cols = table?.rows?.[0]?.length || 1;
                      updateConfig({
                        tableSource: {
                          brickId: selectedId,
                          xAxisColumn: 0,
                          dataColumns: cols > 1 ? [1] : [0],
                        },
                      });
                    }}
                  >
                    {availableTables.map((table) => (
                      <option key={table.id} value={table.id}>{table.title}</option>
                    ))}
                  </select>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Eje X</label>
                      <select
                        className="mt-1 w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
                        value={safeConfig.tableSource.xAxisColumn}
                        onChange={(e) => {
                          const xAxisColumn = Number(e.target.value);
                          const filtered = (safeConfig.tableSource?.dataColumns || []).filter((idx) => idx !== xAxisColumn);
                          updateConfig({
                            tableSource: {
                              ...safeConfig.tableSource!,
                              xAxisColumn,
                              dataColumns: filtered.length ? filtered : [0].filter((idx) => idx !== xAxisColumn),
                            },
                          });
                        }}
                      >
                        {tableHeaders.map((header, idx) => (
                          <option key={`x-${idx}`} value={idx}>{header || `Col ${idx + 1}`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Series</label>
                      <div className="mt-1 max-h-24 overflow-y-auto rounded-md border border-input bg-card p-1.5 space-y-1">
                        {tableHeaders.map((header, idx) => {
                          const disabled = idx === safeConfig.tableSource?.xAxisColumn;
                          const checked = safeConfig.tableSource?.dataColumns?.includes(idx);
                          return (
                            <label key={`series-${idx}`} className={cn("flex items-center gap-2 text-xs", disabled && "opacity-50") }>
                              <input
                                type="checkbox"
                                checked={!!checked}
                                disabled={disabled}
                                onChange={() => {
                                  const base = safeConfig.tableSource?.dataColumns || [];
                                  const next = checked ? base.filter((i) => i !== idx) : [...base, idx];
                                  updateConfig({
                                    tableSource: {
                                      ...safeConfig.tableSource!,
                                      dataColumns: next.length ? next : base,
                                    },
                                  });
                                }}
                              />
                              <span>{header || `Col ${idx + 1}`}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm" className="h-8 text-xs" onClick={saveTableSource}>{t("graph.applyTableConfig")}</Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-border p-2 space-y-2">
              <label className="block text-xs font-semibold text-muted-foreground">JSON de datos</label>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-card px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <div className="flex justify-end">
                <Button size="sm" className="h-8 text-xs" onClick={applyManualJson}>Aplicar datos manuales</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="h-72 w-full rounded-lg border border-border/50 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
