"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, GripVertical, Loader2, Sparkles, Zap } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskBoardTask } from "@/lib/data";
import { cn } from "@/lib/utils";

type CompletedPagination = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
};

type ColumnDef = {
  key: string;
  label: string;
  icon: React.ReactNode;
  empty: string;
  filter: (task: TaskBoardTask) => boolean;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "backlog",
    label: "Backlog",
    icon: <Clock className="h-3.5 w-3.5" />,
    empty: "No backlog tasks.",
    filter: (t) => t.status === "backlog",
  },
  {
    key: "ready",
    label: "Ready",
    icon: <Zap className="h-3.5 w-3.5" />,
    empty: "No ready tasks.",
    filter: (t) => t.status === "ready",
  },
  {
    key: "in_progress",
    label: "In Progress",
    icon: <Loader2 className="h-3.5 w-3.5" />,
    empty: "Nothing in progress.",
    filter: (t) => t.status === "in_progress",
  },
  {
    key: "done",
    label: "Done",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    empty: "No completed tasks.",
    filter: () => false, // handled separately
  },
];

const priorityClass = (p: number) => {
  if (p <= 1) return "kanban-priority-1";
  if (p <= 2) return "kanban-priority-2";
  if (p <= 3) return "kanban-priority-3";
  return "kanban-priority-4";
};

const formatDue = (date: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);

/* ── Droppable column wrapper ── */

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "kanban-column min-h-[12rem] transition-shadow",
        isOver && "ring-2 ring-primary/30 shadow-md",
      )}
    >
      {children}
    </div>
  );
}

export function TaskStatusFilters({
  activeTasks,
  initialCompletedTasks,
  initialCompletedPagination,
  overdueTasks,
  dueSoonTasks,
}: {
  activeTasks: TaskBoardTask[];
  initialCompletedTasks: TaskBoardTask[];
  initialCompletedPagination: CompletedPagination;
  overdueTasks?: TaskBoardTask[];
  dueSoonTasks?: TaskBoardTask[];
}) {
  const [completedTasks, setCompletedTasks] = useState<TaskBoardTask[]>(initialCompletedTasks);
  const [pagination, setPagination] = useState<CompletedPagination>(initialCompletedPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  /* mobile: track which column is expanded */
  const [mobileExpanded, setMobileExpanded] = useState<string>("ready");

  /* ── Drag-and-drop state ── */
  const [localActiveTasks, setLocalActiveTasks] = useState<TaskBoardTask[]>(activeTasks);
  const [localCompletedTasks, setLocalCompletedTasks] = useState<TaskBoardTask[]>(initialCompletedTasks);
  const [activeTask, setActiveTask] = useState<TaskBoardTask | null>(null);
  const [, setActiveColumn] = useState<string | null>(null);

  // Keep local state in sync when props change (server revalidation)
  const prevActiveRef = useRef(activeTasks);
  const prevCompletedRef = useRef(initialCompletedTasks);
  if (prevActiveRef.current !== activeTasks) {
    prevActiveRef.current = activeTasks;
    setLocalActiveTasks(activeTasks);
  }
  if (prevCompletedRef.current !== initialCompletedTasks) {
    prevCompletedRef.current = initialCompletedTasks;
    setLocalCompletedTasks(initialCompletedTasks);
    setCompletedTasks(initialCompletedTasks);
  }

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskBoardTask | undefined;
    const column = event.active.data.current?.column as string | undefined;
    setActiveTask(task ?? null);
    setActiveColumn(column ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      setActiveColumn(null);

      if (!over) return;

      const task = active.data.current?.task as TaskBoardTask;
      const fromColumn = active.data.current?.column as string;
      const toColumn = over.id as string;

      if (fromColumn === toColumn || !task) return;

      // ── Optimistic update ──
      const dbStatus = toColumn === "done" ? "completed" : toColumn;
      const updatedTask: TaskBoardTask = {
        ...task,
        status: dbStatus,
        completedAt: toColumn === "done" ? new Date() : null,
      };

      // Remove from source
      if (fromColumn === "done") {
        setLocalCompletedTasks((prev) => prev.filter((t) => t.id !== task.id));
        setCompletedTasks((prev) => prev.filter((t) => t.id !== task.id));
        setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      } else {
        setLocalActiveTasks((prev) => prev.filter((t) => t.id !== task.id));
      }

      // Add to destination
      if (toColumn === "done") {
        setLocalCompletedTasks((prev) => [updatedTask, ...prev]);
        setCompletedTasks((prev) => [updatedTask, ...prev]);
        setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
      } else {
        setLocalActiveTasks((prev) => [...prev, updatedTask]);
      }

      // ── API call ──
      try {
        const res = await fetch("/api/task-board", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, status: toColumn }),
        });
        if (!res.ok) {
          throw new Error(`PATCH failed: ${res.status}`);
        }
      } catch (error) {
        console.error("Failed to update task status:", error);

        // ── Revert optimistic update ──
        if (toColumn === "done") {
          setLocalCompletedTasks((prev) => prev.filter((t) => t.id !== task.id));
          setCompletedTasks((prev) => prev.filter((t) => t.id !== task.id));
          setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
        } else {
          setLocalActiveTasks((prev) => prev.filter((t) => t.id !== task.id));
        }

        if (fromColumn === "done") {
          setLocalCompletedTasks((prev) => [task, ...prev]);
          setCompletedTasks((prev) => [task, ...prev]);
          setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
        } else {
          setLocalActiveTasks((prev) => [...prev, task]);
        }
      }
    },
    [],
  );

  const columnData = useMemo(() => {
    return COLUMNS.map((col) => {
      const tasks = col.key === "done" ? localCompletedTasks : localActiveTasks.filter(col.filter);
      return { ...col, tasks, count: col.key === "done" ? pagination.total : tasks.length };
    });
  }, [localActiveTasks, localCompletedTasks, pagination.total]);

  const canLoadMore = pagination.hasMore && !loadingMore;

  const loadMoreCompleted = async () => {
    if (!canLoadMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `/api/task-board?completedLimit=${pagination.limit}&completedOffset=${pagination.nextOffset}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const data = (await response.json()) as {
        completedTasks?: TaskBoardTask[];
        completedPagination?: CompletedPagination;
      };
      const incoming: TaskBoardTask[] = data.completedTasks ?? [];
      setCompletedTasks((current) => {
        const seen = new Set(current.map((t) => t.id));
        return [...current, ...incoming.filter((t) => !seen.has(t.id))];
      });
      if (data.completedPagination) setPagination(data.completedPagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      setLoadingMore(false);
    }
  };

  const overdueCount = overdueTasks?.length ?? 0;
  const dueSoonCount = dueSoonTasks?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Alerts strip */}
      {(overdueCount > 0 || dueSoonCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {overdueCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs font-medium text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              {overdueCount} overdue
            </div>
          )}
          {dueSoonCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <Clock className="h-3.5 w-3.5" />
              {dueSoonCount} due within 48h
            </div>
          )}
        </div>
      )}

      {/* Desktop: horizontal kanban columns with drag-and-drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="hidden md:grid md:grid-cols-4 md:gap-3">
          {columnData.map((col) => (
            <DroppableColumn key={col.key} id={col.key}>
              <div className="kanban-column-header">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{col.icon}</span>
                  <span className="text-sm font-semibold">{col.label}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">{col.count}</Badge>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {col.key === "done" ? (
                  <>
                    {doneCollapsed ? (
                      <>
                        {completedTasks.slice(0, 3).map((task) => (
                          <KanbanCard key={task.id} task={task} compact columnKey={col.key} />
                        ))}
                        {pagination.total > 3 && (
                          <button
                            type="button"
                            onClick={() => setDoneCollapsed(false)}
                            className="w-full rounded-md border border-dashed border-border/50 py-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Show {pagination.total - 3} more
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {completedTasks.map((task) => (
                          <KanbanCard key={task.id} task={task} compact columnKey={col.key} />
                        ))}
                        {canLoadMore && (
                          <Button type="button" size="sm" variant="outline" onClick={loadMoreCompleted} disabled={loadingMore} className="w-full text-xs">
                            {loadingMore ? "Loading..." : `Load more (${completedTasks.length}/${pagination.total})`}
                          </Button>
                        )}
                        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
                        <button
                          type="button"
                          onClick={() => setDoneCollapsed(true)}
                          className="w-full rounded-md border border-dashed border-border/50 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Collapse
                        </button>
                      </>
                    )}
                  </>
                ) : col.tasks.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">{col.empty}</p>
                ) : (
                  col.tasks.map((task) => <KanbanCard key={task.id} task={task} columnKey={col.key} />)
                )}
              </div>
            </DroppableColumn>
          ))}
        </div>

        {/* Drag overlay: floating card following cursor */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="kanban-card w-[280px] rotate-2 shadow-xl opacity-90">
              <p className="truncate text-sm font-medium">{activeTask.title}</p>
              {activeTask.description && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activeTask.description}</p>
              )}
              <div className="mt-2 flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">P{activeTask.priority}</Badge>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Mobile: collapsible column sections */}
      <div className="space-y-2 md:hidden">
        {columnData.map((col) => {
          const isExpanded = mobileExpanded === col.key;
          return (
            <div key={col.key} className="kanban-column">
              <button
                type="button"
                onClick={() => setMobileExpanded(isExpanded ? "" : col.key)}
                className="kanban-column-header w-full"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{col.icon}</span>
                  <span className="text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px]">{col.count}</Badge>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
              </button>
              {isExpanded && (
                <div className="space-y-2 p-2">
                  {col.key === "done" ? (
                    <>
                      {completedTasks.slice(0, 5).map((task) => (
                        <KanbanCard key={task.id} task={task} compact />
                      ))}
                      {canLoadMore && (
                        <Button type="button" size="sm" variant="outline" onClick={loadMoreCompleted} disabled={loadingMore} className="w-full text-xs">
                          {loadingMore ? "Loading..." : `Load more (${completedTasks.length}/${pagination.total})`}
                        </Button>
                      )}
                    </>
                  ) : col.tasks.length === 0 ? (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">{col.empty}</p>
                  ) : (
                    col.tasks.map((task) => <KanbanCard key={task.id} task={task} />)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Kanban card ── */

function KanbanCard({ task, compact, columnKey }: { task: TaskBoardTask; compact?: boolean; columnKey?: string }) {
  const draggableId = `task-${task.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { task, column: columnKey },
  });

  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const isOverdue = task.dueAt && task.dueAt < new Date();

  let pillar: string | null = null;
  if (task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)) {
    const meta = task.metadata as Record<string, unknown>;
    if (typeof meta.pillar === "string") pillar = meta.pillar;
  }

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "kanban-card group relative",
          priorityClass(task.priority),
          isDragging && "opacity-40",
        )}
        {...attributes}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              className="shrink-0 cursor-grab touch-none text-muted-foreground/50 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
              aria-label="Drag to move"
              {...listeners}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <p className="min-w-0 truncate text-sm font-medium">{task.title}</p>
          </div>
          {task.outcome && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        </div>
        {task.outcome && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{task.outcome}</p>
        )}
        {task.completedAt && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(task.completedAt)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "kanban-card group relative",
        priorityClass(task.priority),
        isDragging && "opacity-40",
      )}
      {...attributes}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
            aria-label="Drag to move"
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <p className="min-w-0 text-sm font-medium leading-tight">{task.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.autoExecutable && (
            <span title="Auto-executable"><Sparkles className="h-3.5 w-3.5 text-amber-500" /></span>
          )}
          {task.dependencyReady ? (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Dependencies ready" />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" title="Blocked" />
          )}
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      )}

      {/* Tags */}
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-[10px]">P{task.priority}</Badge>
        {task.epic && (
          <Badge variant="outline" className="max-w-[10rem] truncate text-[10px]">{task.epic.title}</Badge>
        )}
        {pillar && (
          <Badge variant="outline" className="text-[10px]">{pillar}</Badge>
        )}
        {!task.dependencyReady && (
          <Badge variant="warning" className="text-[10px]">blocked</Badge>
        )}
      </div>

      {/* Footer: due date and dependencies */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {task.dueAt && (
          <span className={cn("flex items-center gap-1", isOverdue && "font-medium text-red-600 dark:text-red-400")}>
            <Clock className="h-3 w-3" />
            {isOverdue ? "Overdue" : "Due"} {formatDue(task.dueAt)}
          </span>
        )}
        {task.blockedBy.length > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {task.blockedBy.length} blocker{task.blockedBy.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
