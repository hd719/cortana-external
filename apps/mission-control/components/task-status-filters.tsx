"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { TaskBoardTask } from "@/lib/data";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "in_progress" | "auto_ready" | "done";

type CompletedPagination = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
};

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  in_progress: "In progress",
  auto_ready: "Auto-ready",
  done: "Done",
};

const FILTER_EMPTY: Record<Exclude<StatusFilter, "all">, string> = {
  pending: "No pending tasks right now.",
  in_progress: "No tasks currently in progress.",
  auto_ready: "No auto-ready tasks available right now.",
  done: "No completed tasks yet.",
};

function TaskItem({ task }: { task: TaskBoardTask }) {
  const dueLabel = task.dueAt
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(task.dueAt)
    : null;

  const dependencyCount = task.dependsOn?.length ?? 0;
  let pillar: string | null = null;
  if (task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)) {
    const maybePillar = (task.metadata as Record<string, unknown>).pillar;
    if (typeof maybePillar === "string") pillar = maybePillar;
  }

  return (
    <div className="rounded-md border bg-card/60 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">{task.title}</p>
        <StatusBadge value={task.status} variant="task" />
        {task.autoExecutable && <Badge variant="outline">auto</Badge>}
        {task.dependencyReady ? (
          <Badge variant="success">ready</Badge>
        ) : (
          <Badge variant="warning">blocked</Badge>
        )}
        <Badge variant="secondary">P{task.priority}</Badge>
        {task.epic && (
          <Badge variant="ghost" className="truncate">
            Epic: {task.epic.title}
          </Badge>
        )}
        {pillar && <Badge variant="outline">{pillar}</Badge>}
      </div>
      {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {dueLabel && <span>Due {dueLabel}</span>}
        {task.blockedBy.length > 0 && (
          <span>
            Waiting on: {task.blockedBy.map((b) => `${b.title} (${b.status})`).join(", ")}
          </span>
        )}
        {dependencyCount > 0 && <span>{dependencyCount} dependency</span>}
      </div>
    </div>
  );
}

export function TaskStatusFilters({
  activeTasks,
  initialCompletedTasks,
  initialCompletedPagination,
}: {
  activeTasks: TaskBoardTask[];
  initialCompletedTasks: TaskBoardTask[];
  initialCompletedPagination: CompletedPagination;
}) {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>("all");
  const [completedTasks, setCompletedTasks] = useState<TaskBoardTask[]>(initialCompletedTasks);
  const [pagination, setPagination] = useState<CompletedPagination>(initialCompletedPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const allTasks = useMemo(() => [...activeTasks, ...completedTasks], [activeTasks, completedTasks]);

  const counts = useMemo(() => {
    const pending = activeTasks.filter((task) => task.status === "pending").length;
    const inProgress = activeTasks.filter((task) => task.status === "in_progress").length;
    const autoReady = activeTasks.filter(
      (task) => task.status === "pending" && task.autoExecutable && task.dependencyReady
    ).length;

    return {
      all: activeTasks.length + pagination.total,
      pending,
      in_progress: inProgress,
      auto_ready: autoReady,
      done: pagination.total,
    } satisfies Record<StatusFilter, number>;
  }, [activeTasks, pagination.total]);

  const filteredTasks = useMemo(() => {
    if (activeFilter === "pending") return activeTasks.filter((task) => task.status === "pending");
    if (activeFilter === "in_progress") {
      return activeTasks.filter((task) => task.status === "in_progress");
    }
    if (activeFilter === "auto_ready") {
      return activeTasks.filter(
        (task) => task.status === "pending" && task.autoExecutable && task.dependencyReady
      );
    }
    if (activeFilter === "done") {
      return completedTasks;
    }
    return allTasks;
  }, [activeFilter, activeTasks, allTasks, completedTasks]);

  const canLoadMoreCompleted = pagination.hasMore && !loadingMore;

  const loadMoreCompleted = async () => {
    if (!canLoadMoreCompleted) return;
    setLoadingMore(true);
    setLoadError(null);

    try {
      const response = await fetch(
        `/api/task-board?completedLimit=${pagination.limit}&completedOffset=${pagination.nextOffset}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = await response.json();
      const incoming: TaskBoardTask[] = data.completedTasks ?? [];

      setCompletedTasks((current) => {
        const seen = new Set(current.map((task) => task.id));
        const deduped = incoming.filter((task) => !seen.has(task.id));
        return [...current, ...deduped];
      });

      if (data.completedPagination) {
        setPagination(data.completedPagination);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load older completed tasks.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Status filters</CardTitle>
        <div className="flex flex-wrap gap-2">
          {(["pending", "in_progress", "auto_ready", "done"] as const).map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={activeFilter === filter ? "secondary" : "outline"}
              onClick={() => setActiveFilter(filter)}
              className={cn("h-8", activeFilter === filter && "ring-1 ring-border")}
              aria-pressed={activeFilter === filter}
            >
              {FILTER_LABELS[filter]}: {counts[filter]}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={activeFilter === "all" ? "secondary" : "ghost"}
            onClick={() => setActiveFilter("all")}
            aria-pressed={activeFilter === "all"}
            className="h-8"
          >
            {FILTER_LABELS.all}: {counts.all}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filteredTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {activeFilter === "all"
              ? "No tasks found."
              : FILTER_EMPTY[activeFilter as Exclude<StatusFilter, "all">]}
          </p>
        ) : (
          filteredTasks.map((task) => <TaskItem key={task.id} task={task} />)
        )}

        {(activeFilter === "done" || activeFilter === "all") && pagination.total > completedTasks.length && (
          <div className="space-y-2 pt-2">
            <Button type="button" size="sm" variant="outline" onClick={loadMoreCompleted} disabled={!canLoadMoreCompleted}>
              {loadingMore ? "Loading…" : "Show older completed"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Showing {completedTasks.length} of {pagination.total} completed tasks.
            </p>
            {loadError && <p className="text-xs text-destructive">{loadError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
