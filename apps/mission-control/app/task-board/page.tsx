import Link from "next/link";
import { getTaskBoard, TaskBoardTask } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { TaskStatusFilters } from "@/components/task-status-filters";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

function TaskList({
  title,
  tasks,
  empty,
}: {
  title: string;
  tasks: TaskBoardTask[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {title}
          <Badge variant="secondary">{tasks.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          tasks.map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </CardContent>
    </Card>
  );
}

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
  let feedbackId: string | null = null;
  if (task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)) {
    const maybePillar = (task.metadata as Record<string, unknown>).pillar;
    if (typeof maybePillar === "string") pillar = maybePillar;
    const maybeFeedbackId = (task.metadata as Record<string, unknown>).feedback_id;
    if (typeof maybeFeedbackId === "string" && maybeFeedbackId.trim()) {
      feedbackId = maybeFeedbackId.trim();
    }
  }
  const feedbackLabel = feedbackId ? `feedback ${feedbackId.slice(0, 8)}` : null;

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
      {task.description && (
        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {dueLabel && <span>Due {dueLabel}</span>}
        {task.blockedBy.length > 0 && (
          <span>
            Waiting on: {task.blockedBy.map((b) => `${b.title} (${b.status})`).join(", ")}
          </span>
        )}
        {dependencyCount > 0 && <span>{dependencyCount} dependency</span>}
        {feedbackId && feedbackLabel && (
          <Link
            href={`/feedback?id=${encodeURIComponent(feedbackId)}`}
            className="hover:text-foreground hover:underline"
          >
            Source: {feedbackLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function TaskBoardPage() {
  let data: Awaited<ReturnType<typeof getTaskBoard>> | null = null;
  let error: string | null = null;

  try {
    data = await getTaskBoard();
  } catch (err) {
    console.error("Failed to load task board", err);
    error =
      "Task board database not reachable. Point DATABASE_URL at the cortana database or run migrations.";
  }

  if (!data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">Task Board unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{error}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Confirm Postgres is running and DATABASE_URL points to cortana db.</li>
            <li>Run <code className="font-mono">pnpm db:migrate</code> to create adapter tables.</li>
            <li>Seed sample data with <code className="font-mono">pnpm db:seed</code>.</li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  const {
    readyNow,
    blocked,
    dueSoon,
    overdue,
    byPillar,
    recentOutcomes,
    activeTasks,
    completedTasks,
    completedPagination,
    metadata,
  } = data;
  const liveSyncActive = metadata.listener?.connected;

  const pillarEntries = Object.entries(byPillar).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Tasks
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Mission Control Task Board</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live view into the Cortana task queue with ready/blocked slices, pillar rollups, and latest execution logs.
          </p>
        </div>
      </div>

      {liveSyncActive ? (
        <Card className="border-success/40 bg-success/10">
          <CardHeader>
            <CardTitle className="text-base">Live sync active</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              PostgreSQL LISTEN/NOTIFY is connected. Task and epic updates replicate to Mission Control in real time.
            </p>
            {metadata.listener?.lastEventAt && (
              <p className="text-xs">
                Last event: {new Date(metadata.listener.lastEventAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      ) : metadata.warnings.length > 0 ? (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="text-base">Task Board running in fallback mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {metadata.warnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`}>
                <p>{warning.message}</p>
                {warning.cause && <p className="text-xs">Details: {warning.cause}</p>}
              </div>
            ))}
            {metadata.reconciliation?.ranAt && (
              <p className="text-xs">Last reconciliation: {new Date(metadata.reconciliation.ranAt).toLocaleString()}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <TaskStatusFilters
        activeTasks={activeTasks}
        initialCompletedTasks={completedTasks}
        initialCompletedPagination={completedPagination}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <TaskList
          title="Ready now"
          tasks={readyNow}
          empty="No auto-executable tasks are dependency-ready."
        />
        <TaskList
          title="Blocked"
          tasks={blocked}
          empty="No tasks are currently blocked by unmet dependencies."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TaskList
          title="Due soon (48h)"
          tasks={dueSoon}
          empty="Nothing due in the next 48 hours."
        />
        <TaskList
          title="Overdue"
          tasks={overdue}
          empty="No overdue items."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By pillar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {pillarEntries.map(([pillar, pillarTasks]) => (
            <div key={pillar} className="space-y-3 rounded-md border p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{pillar}</Badge>
                  <Badge variant="secondary">{pillarTasks.length}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Auto: {pillarTasks.filter((t) => t.autoExecutable).length}</span>
              </div>
              <div className="space-y-2">
                {pillarTasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))}
          {pillarEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">No tasks with pillar metadata.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent execution outcomes & log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentOutcomes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed tasks recorded yet.</p>
          ) : (
            recentOutcomes.map((task) => {
              const completedLabel = task.completedAt
                ? new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(task.completedAt)
                : new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                  }).format(task.updatedAt);

              return (
                <div
                  key={task.id}
                  className="flex flex-col gap-1 rounded-md border bg-card/50 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{task.title}</p>
                    <StatusBadge value={task.status} variant="task" />
                    {task.epic && <Badge variant="ghost">{task.epic.title}</Badge>}
                    <span className="text-xs text-muted-foreground">{completedLabel}</span>
                  </div>
                  {task.outcome ? (
                    <p className="text-sm text-muted-foreground">{task.outcome}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Updated {completedLabel}</p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
