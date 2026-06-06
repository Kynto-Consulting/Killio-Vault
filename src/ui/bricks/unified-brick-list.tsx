"use client";

import React, { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Type, Table, BarChart2, CheckSquare, ChevronDown, Image as ImageIcon, LayoutGrid, FileText } from "lucide-react";
import { UnifiedBrickRenderer } from "./brick-renderer";
import { SortableBrick } from "./sortable-brick";
import { Button } from "@/components/ui/button";
import { Portal } from "../ui/portal";
import { cn } from "@/lib/utils";
import { getSlashCommands, type SlashCommand } from "./slash-commands";
import { useTranslations } from "@/components/providers/i18n-provider";
import { ReferencePicker, type ReferencePickerSelection } from "@/components/documents/reference-picker";
import { WorkspaceMemberLike } from "@/lib/workspace-members";

type AddableKind = 'text' | 'table' | 'graph' | 'checklist' | 'accordion' | 'tabs' | 'columns' | 'image' | 'video' | 'audio' | 'file' | 'code' | 'bookmark' | 'math' | 'database' | 'form';

type CrossContainerDropOptions = {
  intent?: "move" | "merge-text";
  sourceContainerToken?: string;
  targetContainerToken?: string;
};

interface UnifiedBrickListProps {
  bricks: any[];
  activeBricks?: any[];
  canEdit: boolean;
  onUpdateBrick: (id: string, content: any) => void;
  onDeleteBrick: (id: string) => void;
  onReorderBricks: (ids: string[]) => void;
  onAddBrick: (kind: string, afterBrickId?: string, parentProps?: any, initialContent?: any) => void;
  documents?: any[];
  boards?: any[];
  folders?: any[];
  users?: WorkspaceMemberLike[];
  addableKinds?: AddableKind[];
  onPasteImageInTextBrick?: (payload: { brickId: string; file: File; cursorOffset: number; markdown: string }) => Promise<string | void> | string | void;
  onUploadMediaFiles?: (payload: { brickId: string; files: File[] }) => Promise<void> | void;
  hasExternalDndContext?: boolean;
  onCrossContainerDrop?: (activeId: string, overId: string, options?: CrossContainerDropOptions) => void;
  dropContainerToken?: string;
  emptyPlaceholder?: string;
  onAiAction?: (action: string, contextText: string) => void;
  onPatchCell?: (brickId: string, patch: Record<string, any>) => void;
  onPatchColumn?: (brickId: string, patch: Record<string, any>) => void;
  isCompact?: boolean;
  showDragOverlay?: boolean;
  /** Multi-select: ids currently selected + a toggle (Ctrl/Cmd-click a brick). */
  selectedBrickIds?: Set<string>;
  onBrickSelectToggle?: (id: string) => void;
}

export const UnifiedBrickList: React.FC<UnifiedBrickListProps> = ({
  bricks,
  activeBricks,
  canEdit,
  onUpdateBrick,
  onDeleteBrick,
  onReorderBricks,
  onAddBrick,
  documents = [],
  boards = [],
  folders = [],
  users = [],
  addableKinds,
  onPasteImageInTextBrick,
  onUploadMediaFiles,
  hasExternalDndContext = false,
  onCrossContainerDrop,
  dropContainerToken,
  emptyPlaceholder,
  onAiAction,
  onPatchCell,
  onPatchColumn,
  isCompact = false,
  showDragOverlay = true,
  selectedBrickIds,
  onBrickSelectToggle,
}) => {
  const tDetail = useTranslations("document-detail");
  const tBoardDetail = useTranslations("board-detail");
  const slashCommands = React.useMemo(() => getSlashCommands(tDetail as any), [tDetail]);

  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("killio-sel-style")) return;
    const st = document.createElement("style");
    st.id = "killio-sel-style";
    st.textContent = "@keyframes killioSelPulse{0%,100%{border-color:rgba(34,211,238,.45)}50%{border-color:rgba(34,211,238,.95)}}.killio-sel{border-color:rgba(34,211,238,.6);animation:killioSelPulse 1.4s ease-in-out infinite}";
    document.head.appendChild(st);
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [plusMenuState, setPlusMenuState] = useState<{ brickId: string, top: number, left: number } | null>(null);
  const [plusMenuHoverIndex, setPlusMenuHoverIndex] = useState<number>(0);
  const [pickerState, setPickerState] = useState<{ isOpen: boolean; filter: string[]; triggerBrickId: string } | null>(null);
  const enabledKinds = addableKinds && addableKinds.length > 0
    ? addableKinds
    : ['text', 'table', 'graph', 'checklist', 'accordion', 'form'];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuState) {
        setPlusMenuState(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [plusMenuState]);

  const handleApplyPlusCommand = (command: SlashCommand, afterBrickId: string) => {
    if (command.id === "mention-person" || command.id === "mention-page") {
      setPickerState({
        isOpen: true,
        filter: command.id === "mention-person" ? ["user"] : ["document", "board"],
        triggerBrickId: afterBrickId
      });
      setPlusMenuState(null);
      return;
    }

    const kindToInsert = command.blockKind || "text";
    onAddBrick(kindToInsert, afterBrickId);
    setPlusMenuState(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const allBricks = (activeBricks && activeBricks.length > 0 ? activeBricks : bricks) as any[];
    const activeBrick = allBricks.find((b) => b?.id === active.id);
    const overBrick = allBricks.find((b) => b?.id === over.id);

    const sourceContainerToken = ((active as any)?.data?.current?.containerToken as string | undefined) || dropContainerToken;
    const targetContainerToken = ((over as any)?.data?.current?.containerToken as string | undefined) ||
      (typeof over.id === "string" && over.id.includes(":") ? String(over.id) : undefined);

    const activeRect = ((active as any)?.rect?.current?.translated || (active as any)?.rect?.current?.initial) as
      | { left: number; right: number; top: number; bottom: number; width: number; height: number }
      | undefined;
    const overRect = ((over as any)?.rect) as
      | { left: number; right: number; top: number; bottom: number; width: number; height: number }
      | undefined;

    let overlapRatio = 0;
    if (activeRect && overRect) {
      const overlapWidth = Math.max(0, Math.min(activeRect.right, overRect.right) - Math.max(activeRect.left, overRect.left));
      const overlapHeight = Math.max(0, Math.min(activeRect.bottom, overRect.bottom) - Math.max(activeRect.top, overRect.top));
      const overlapArea = overlapWidth * overlapHeight;
      const activeArea = Math.max(1, activeRect.width * activeRect.height);
      overlapRatio = overlapArea / activeArea;
    }

    const shouldMergeText =
      typeof onCrossContainerDrop === "function" &&
      activeBrick?.kind === "text" &&
      overBrick?.kind === "text" &&
      !activeBrick?.content?.formField &&
      !overBrick?.content?.formField &&
      overlapRatio >= 0.8;

    if (shouldMergeText) {
      onCrossContainerDrop(active.id as string, over.id as string, {
        intent: "merge-text",
        sourceContainerToken,
        targetContainerToken,
      });
      return;
    }

    const oldIndex = bricks.findIndex((b) => b.id === active.id);
    if (oldIndex === -1) {
      if (onCrossContainerDrop) {
        onCrossContainerDrop(active.id as string, String(over.id), {
          intent: "move",
          sourceContainerToken,
          targetContainerToken,
        });
      }
      return;
    }

    const newIndex = bricks.findIndex((b) => b.id === over.id);
    if (newIndex === -1) {
      if (onCrossContainerDrop) {
        onCrossContainerDrop(active.id as string, (over.id as string), {
          intent: "move",
          sourceContainerToken,
          targetContainerToken: targetContainerToken || dropContainerToken,
        });
      }
      return;
    }

    // Multi-select: dragging one selected brick moves the whole selected block.
    if (selectedBrickIds && selectedBrickIds.size > 1 && selectedBrickIds.has(String(active.id))) {
      const selOrdered = bricks.filter((b) => selectedBrickIds.has(b.id)); // preserve relative order
      const rest = bricks.filter((b) => !selectedBrickIds.has(b.id));
      let insertAt = rest.findIndex((b) => b.id === over.id);
      if (insertAt === -1) {
        const overOrig = bricks.findIndex((b) => b.id === over.id);
        insertAt = bricks.slice(0, overOrig).filter((b) => !selectedBrickIds.has(b.id)).length;
      }
      const merged = [...rest.slice(0, insertAt), ...selOrdered, ...rest.slice(insertAt)];
      onReorderBricks(merged.map((b) => b.id));
      return;
    }

    const newOrder = [...bricks];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);

    onReorderBricks(newOrder.map((b) => b.id));
  };

  const sortedBricks = hasExternalDndContext
    ? [...bricks]
    : [...bricks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const renderBrick = (brick: any) => {
    if (!brick) {
      return null;
    }

    // Normalize mapping for Cards (BoardBrick) vs Documents (DocumentBrick)
    const normalized = {
      ...brick,
      content: {
        text: brick.markdown || brick.content?.text || "",
        rows: brick.rows || brick.content?.rows || [],
        items: brick.tasks || brick.items || brick.content?.items || [],
        title: brick.title || brick.content?.title || "",
        body: brick.body || brick.content?.body || "",
        isExpanded: brick.isExpanded !== undefined ? brick.isExpanded : brick.content?.isExpanded,
        ...(brick.content || {}),
        ...brick // Top-level fields on BoardBrick take precedence
      }
    };

    return (
      <UnifiedBrickRenderer 
        brick={normalized}
        canEdit={canEdit}
        onUpdate={(content) => onUpdateBrick(brick.id, content)}
        onAddBrick={onAddBrick}
        onDeleteBrick={onDeleteBrick}
        onUpdateBrick={onUpdateBrick}
        onReorderBricks={onReorderBricks}
        documents={documents}
        boards={boards}
        activeBricks={activeBricks || bricks}
        users={users}
        onPasteImageInTextBrick={onPasteImageInTextBrick}
        onUploadMediaFiles={onUploadMediaFiles}
        onAiAction={onAiAction}
        onPatchCell={onPatchCell}
        onPatchColumn={onPatchColumn}
        isCompact={isCompact}
      />
    );
  };

  const listContent = (
    <SortableContext items={sortedBricks.map(b => b.id)} strategy={verticalListSortingStrategy}>
      {sortedBricks.length > 0 && (
<div className="space-y-2 min-h-[50px]" data-drop-container-token={dropContainerToken ?? undefined}>
        {sortedBricks.map((brick, idx) => {
          const sel = selectedBrickIds?.has(brick.id);
          const prevSel = idx > 0 && selectedBrickIds?.has(sortedBricks[idx - 1].id);
          const nextSel = idx < sortedBricks.length - 1 && selectedBrickIds?.has(sortedBricks[idx + 1].id);
          // Contiguous selected bricks share one continuous, pulsing border.
          const selClass = sel
            ? `killio-sel relative border-l-2 border-r-2 bg-accent/[0.05] ${!prevSel ? "border-t-2 rounded-t-lg " : "-mt-2 "}${!nextSel ? "border-b-2 rounded-b-lg " : ""}`
            : undefined;
          return (
          <div
            key={brick.id}
            className={selClass}
            onClickCapture={(e) => {
              if (!onBrickSelectToggle || !(e.ctrlKey || e.metaKey)) return;
              if ((e.target as HTMLElement).closest('.mention-pill, .user-mention, .deep-pill')) return;
              e.preventDefault(); e.stopPropagation();
              onBrickSelectToggle(brick.id);
            }}
          >
          <SortableBrick
            id={brick.id}
            containerToken={dropContainerToken}
            readonly={!canEdit} 
            isCompact={isCompact}
            onDelete={() => onDeleteBrick(brick.id)} 
            onAddBelow={(rect) => {
              if (rect) {
                let top = rect.bottom + 8;
                let left = rect.left;
                
                const menuHeight = 320;
                const menuWidth = 320;
                if (typeof window !== "undefined") {
                  if (top + menuHeight > window.innerHeight) {
                    top = Math.max(12, rect.top - menuHeight - 8);
                  }
                  if (left + menuWidth > window.innerWidth) {
                    left = window.innerWidth - menuWidth - 12;
                  }
                }
                
                setPlusMenuState({ brickId: brick.id, top, left });
              } else {
                onAddBrick('text', brick.id);
              }
            }}
          >
            {renderBrick(brick)}
          </SortableBrick>
          </div>
          );
        })}
      </div>)}
    </SortableContext>
  );

  return (
    <div className="w-full space-y-4">
      {hasExternalDndContext ? (
        listContent
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => {
            const isOwnedByThisList = bricks.some((b) => b.id === e.active.id);
            setActiveId(isOwnedByThisList ? (e.active.id as string) : null);
          }}
          onDragEnd={handleDragEnd}
        >
          {listContent}
          {showDragOverlay && (
            <DragOverlay>
              {activeId ? (
                 <div className="opacity-80 scale-[1.02] shadow-xl bg-background border border-border rounded-lg p-2">
                    {renderBrick(bricks.find(b => b.id === activeId))}
                 </div>
              ) : null}
            </DragOverlay>
          )}
        </DndContext>
      )}

      {canEdit && bricks.length === 0 && emptyPlaceholder && (
        <div 
          className="flex items-center justify-start text-[15px] text-muted-foreground/50 cursor-text min-h-[40px] hover:bg-muted/10 transition-colors rounded-lg w-full"
          onClick={() => onAddBrick('text')}
        >
          {emptyPlaceholder}
        </div>
      )}

      {canEdit && !emptyPlaceholder && (!hasExternalDndContext || bricks.length === 0) && (
        <div className="pt-6 border-t border-border flex flex-wrap gap-2 items-center justify-center">
          {enabledKinds.includes('text') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('text')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <Type className="w-3.5 h-3.5 text-accent" /> Texto
            </Button>
          )}
          {enabledKinds.includes('table') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('table')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <Table className="w-3.5 h-3.5 text-accent" /> Tabla
            </Button>
          )}
          {enabledKinds.includes('database') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('database')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <LayoutGrid className="w-3.5 h-3.5 text-accent" /> Base de Datos
            </Button>
          )}
          {enabledKinds.includes('graph') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('graph')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <BarChart2 className="w-3.5 h-3.5 text-accent" /> Gráfico
            </Button>
          )}
          {enabledKinds.includes('form') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('form')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <FileText className="w-3.5 h-3.5 text-accent" /> Formulario
            </Button>
          )}
          {enabledKinds.includes('checklist') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('checklist')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <CheckSquare className="w-3.5 h-3.5 text-accent" /> Lista
            </Button>
          )}
          {enabledKinds.includes('accordion') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('accordion')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <ChevronDown className="w-3.5 h-3.5 text-accent" /> Acordeón
            </Button>
          )}
          {enabledKinds.includes('image') && (
            <Button variant="ghost" size="sm" onClick={() => onAddBrick('image')} className="gap-2 text-[11px] font-bold tracking-tight uppercase">
              <ImageIcon className="w-3.5 h-3.5 text-accent" /> Imagen
            </Button>
          )}
        </div>
      )}

      {plusMenuState && canEdit && (
        <Portal>
          <div
            className="fixed z-[150] flex flex-row overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            style={{ 
              top: plusMenuState.top, 
              left: plusMenuState.left,
              maxWidth: slashCommands[plusMenuHoverIndex]?.preview ? '600px' : '320px',
              minWidth: '320px'
            }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent closing immediately
          >
            <div className="flex-1 w-[320px] flex flex-col border-r border-border/50">
              <div className="max-h-72 overflow-y-auto p-1.5 flex-1">
                {slashCommands.map((command, index) => {
                  const showCategoryHeader = index === 0 || command.category !== slashCommands[index - 1].category;
                  const catName = command.category
                    ? (tBoardDetail(`brickCategories.${command.category}` as any) ?? command.category)
                    : tBoardDetail("brickCategories.other");

                  return (
                    <React.Fragment key={command.id}>
                      {showCategoryHeader && (
                        <div className="px-2 pt-3 pb-1">
                          <span className="text-xs font-semibold text-muted-foreground">{catName}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setPlusMenuHoverIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => handleApplyPlusCommand(command, plusMenuState.brickId)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          index === plusMenuHoverIndex ? "bg-accent/80 text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                        )}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background shadow-sm text-foreground">
                          {command.icon}
                        </div>
                        <div className="flex flex-col items-start gap-0.5 overflow-hidden">
                          <span className="text-sm font-medium text-foreground">{command.label}</span>
                          <span className="truncate text-xs text-muted-foreground/80 w-full">{command.description}</span>
                        </div>
                        {command.shortcut && (
                          <div className="ml-auto text-xs text-muted-foreground/60">{command.shortcut}</div>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            {slashCommands[plusMenuHoverIndex]?.preview && (
              <div className="hidden sm:flex w-[280px] bg-muted/10 flex-col">
                <div className="p-4 flex-1">
                   {slashCommands[plusMenuHoverIndex].preview}
                </div>
                <div className="p-4 mt-auto border-t border-border/50 bg-muted/5 text-xs text-muted-foreground">
                   {slashCommands[plusMenuHoverIndex].description}
                </div>
              </div>
            )}
          </div>
        </Portal>
      )}

      {pickerState?.isOpen && (
        <Portal>
          <ReferencePicker
            boards={boards}
            documents={documents}
            folders={folders}
            users={users}
            activeBricks={activeBricks || []}
            onClose={() => setPickerState(null)}
            allowedTypes={pickerState.filter as any}
            onSelect={(item: ReferencePickerSelection) => {
              const targetBrick = bricks.find(b => b.id === pickerState.triggerBrickId);
              if (targetBrick && targetBrick.kind === "text") {
                const currentText = targetBrick.content?.text || targetBrick.markdown || "";
                const newText = currentText ? `${currentText} ${item.token}` : item.token;
                onUpdateBrick(targetBrick.id, { ...targetBrick.content, text: newText, markdown: newText });
              } else {
                  onAddBrick("text", pickerState.triggerBrickId, undefined, { text: item.token, markdown: item.token });
              }
              setPickerState(null);
            }}
          />
        </Portal>
      )}
    </div>
  );
};
