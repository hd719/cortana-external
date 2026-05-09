import { Activity, Dumbbell, Moon, TrendingUp, Weight } from "lucide-react";
import { Animate } from "@/components/animate";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPercent, formatNumber, formatDuration, formatTimestamp } from "@/lib/format-utils";
import { StrengthProfile } from "@/components/mjolnir/strength-profile";
import { RecoveryRingAnimated } from "@/components/mjolnir/recovery-ring";
import { AnimatedValue } from "@/components/mjolnir/animated-value";
import { TrendChartRecharts, RecoverySleepOverlay, VolumeProgressionChart } from "@/components/mjolnir/trend-chart";
import { WhoopLiveEventsPanel } from "@/components/mjolnir/whoop-live-events-panel";
import type { WhoopLiveEventsResponse } from "@/lib/whoop-live-events";

export const dynamic = "force-dynamic";

/* ── types ── */

type TrendPoint = { date: string; value: number | null };

type FitnessAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  label: string;
  message: string;
  timestamp: string;
};

type WorkoutSummary = {
  id: string;
  sport: string;
  start: string | null;
  strain: number | null;
  durationSeconds: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  kilojoules: number | null;
};

export const getWorkoutRenderKey = (
  workout: Pick<WorkoutSummary, "id" | "start">,
  index: number,
) => `${workout.id}-${workout.start ?? "na"}-${index}`;

type FitnessSummary = {
  recovery: {
    score: number | null;
    status: "green" | "yellow" | "red" | "unknown";
    hrv: number | null;
    restingHeartRate: number | null;
    spo2: number | null;
    recordedAt: string | null;
  };
  sleep: {
    durationSeconds: number | null;
    efficiency: number | null;
    performance: number | null;
    consistency: number | null;
    sleepDebtSeconds: number | null;
    stage: {
      remSeconds: number | null;
      swsSeconds: number | null;
      lightSeconds: number | null;
    };
    recordedAt: string | null;
  };
  workouts: WorkoutSummary[];
  trends: {
    recovery: TrendPoint[];
    sleepPerformance: TrendPoint[];
  };
  alerts: FitnessAlert[];
  alertHistory: FitnessAlert[];
  body: {
    heightM: number | null;
    weightKg: number | null;
    maxHeartRate: number | null;
  };
  tonal: {
    available: boolean;
    workoutCount: number;
    lastUpdated: string | null;
    strengthScores: Array<{ label: string; value: number }>;
    recentWorkouts: Array<{
      id: string;
      startTime: string | null;
      duration: number | null;
      movementCount: number;
      totalVolume: number;
      topMovements: Array<{ name: string; reps: number; weight: number }>;
    }>;
  };
};

type FitnessResponse =
  | { status: "ok"; generatedAt: string; cached: boolean; data: FitnessSummary }
  | { status: "error"; generatedAt: string; cached: boolean; error: { message: string; detail?: string } };

type PPLMovement = {
  slot: string;
  title: string;
  movementId: string;
  canonicalKey: string;
  muscleGroup: string;
  pattern: string;
  validationSources: string[];
  publicUrls: string[];
  recentHistory: {
    setCount: number;
    workoutCount: number;
    avgLoad: number | null;
    avgReps: number | null;
    avgVolume: number | null;
  } | null;
  programming: {
    sets: string;
    reps: string;
    rir: string;
    note: string;
  };
  alternates: string[];
  selectionReason: string;
};

type PPLDay = {
  theme: string;
  whyThisFits: string;
  movements: PPLMovement[];
};

type ProgramData = {
  ppl: {
    schema: string;
    generatedAt: string;
    summary: {
      workoutsSeen: number;
      mappedMovementsSeen: number;
      latestWorkoutAt: string | null;
      publicMovementCount: number;
      metricReadyPublicMovementCount: number;
      observedPublicMovementCount: number;
    };
    notes: string[];
    days: {
      push: PPLDay;
      pull: PPLDay;
      legs: PPLDay;
    };
  };
  coverage: {
    publicMovementCount: number;
    metricReadyCount: number;
    mappedInPpl: number;
    workoutsSeen: number;
    lastRefreshed: string;
  };
  block: {
    raw: string;
    status: "planned" | "active" | "completed";
  };
};

type ProgramResponse =
  | { status: "ok"; generatedAt: string; data: ProgramData }
  | { status: "error"; error: { message: string } };

/* ── formatters ── */

const formatShortDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const severityVariant = (severity: FitnessAlert["severity"]) => {
  if (severity === "critical") return "destructive" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
};

const recoveryStatusColor = (status: string) => {
  if (status === "green") return "text-emerald-600 dark:text-emerald-400";
  if (status === "yellow") return "text-amber-500 dark:text-amber-400";
  if (status === "red") return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
};

const recoveryBadgeVariant = (status: string) => {
  if (status === "green") return "success" as const;
  if (status === "yellow") return "warning" as const;
  if (status === "red") return "destructive" as const;
  return "outline" as const;
};

/* ── data fetch ── */

async function getFitnessData(): Promise<FitnessResponse> {
  const baseUrl = `http://localhost:${process.env.PORT || "3000"}`;
  const response = await fetch(`${baseUrl}/api/mjolnir`, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    return { status: "error", generatedAt: new Date().toISOString(), cached: false, error: { message: `Request failed (${response.status})` } };
  }
  return (await response.json()) as FitnessResponse;
}

async function getProgramData(): Promise<ProgramResponse> {
  try {
    const baseUrl = `http://localhost:${process.env.PORT || "3000"}`;
    const response = await fetch(`${baseUrl}/api/mjolnir/program`, { method: "GET", cache: "no-store" });
    if (!response.ok) {
      return { status: "error", error: { message: `Request failed (${response.status})` } };
    }
    return (await response.json()) as ProgramResponse;
  } catch {
    return { status: "error", error: { message: "Program data unavailable" } };
  }
}

async function getWhoopLiveEvents(): Promise<WhoopLiveEventsResponse> {
  try {
    const baseUrl = `http://localhost:${process.env.PORT || "3000"}`;
    const response = await fetch(`${baseUrl}/api/mjolnir/whoop-events?limit=20`, { method: "GET", cache: "no-store" });
    if (!response.ok) {
      return { events: [], warning: `WHOOP Live Events unavailable (${response.status})` };
    }
    return (await response.json()) as WhoopLiveEventsResponse;
  } catch {
    return { events: [], warning: "WHOOP Live Events unavailable" };
  }
}

/* ── page ── */

export default async function FitnessPage() {
  const [response, programResponse, whoopLiveEvents] = await Promise.all([
    getFitnessData(),
    getProgramData(),
    getWhoopLiveEvents(),
  ]);

  if (response.status !== "ok") {
    return (
      <div className="space-y-6">
        <AutoRefresh />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-lg">Mjolnir data unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{response.error.message}</p>
            <p>
              Ensure the Whoop service is running at{" "}
              <code className="font-mono">http://localhost:3033</code> and that OAuth is authorized.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data } = response;

  /* Compute PPL max load for bar scaling */
  const allPplMovements: PPLMovement[] = programResponse.status === "ok"
    ? [
        ...programResponse.data.ppl.days.push.movements,
        ...programResponse.data.ppl.days.pull.movements,
        ...programResponse.data.ppl.days.legs.movements,
      ]
    : [];
  const pplMaxLoad = allPplMovements.reduce(
    (max, m) => Math.max(max, m.recentHistory?.avgLoad ?? 0),
    0,
  );

  /* Tonal recent workouts max volume */
  const tonalMaxVolume = data.tonal?.available
    ? data.tonal.recentWorkouts.reduce((max, w) => Math.max(max, w.totalVolume), 0)
    : 0;


  /* Trend current values */
  const currentRecovery = data.trends.recovery.length > 0
    ? data.trends.recovery[data.trends.recovery.length - 1]?.value ?? null
    : null;
  const currentSleep = data.trends.sleepPerformance.length > 0
    ? data.trends.sleepPerformance[data.trends.sleepPerformance.length - 1]?.value ?? null
    : null;

  return (
    <div className="space-y-4">
      <AutoRefresh />

      {/* ── Header ── */}
      <Animate delay={0.04}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Mjolnir</p>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Training Command Center</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={response.cached ? "outline" : "success"} className="text-[10px]">
            {response.cached ? "cached" : "live"}
          </Badge>
          <span className="font-mono text-[10px]">{formatTimestamp(response.generatedAt)}</span>
        </div>
      </div>
      </Animate>

      {/* ═══ VITALS ROW ═══ */}
      <Animate delay={0.10}>
      <section className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {/* Left: Recovery + Sleep Combined */}
        <VitalsCard recovery={data.recovery} sleep={data.sleep} />

        {/* Right: Today's Activity */}
        <ActivityCard workouts={data.workouts} />
      </section>
      </Animate>

      <Animate delay={0.16}>
      <WhoopLiveEventsPanel events={whoopLiveEvents.events} warning={whoopLiveEvents.warning} />
      </Animate>

      {/* ═══ 3. TRAINING BLOCK ═══ */}
      {programResponse.status === "ok" && (() => {
        const program = programResponse.data;
        const blockDays = [
          { label: "Day 1", activity: "Push A", type: "lift", dayKey: "push" as const },
          { label: "Day 2", activity: "Run+Rec", type: "run", dayKey: null },
          { label: "Day 3", activity: "Pull A", type: "lift", dayKey: "pull" as const },
          { label: "Day 4", activity: "Run+Rec", type: "run", dayKey: null },
          { label: "Day 5", activity: "Legs A", type: "lift", dayKey: "legs" as const },
          { label: "Day 6", activity: "Push B", type: "lift", dayKey: "push" as const },
          { label: "Day 7", activity: "Recovery", type: "recovery", dayKey: null },
        ] as const;

        return (
          <>
            <section>
              <Card className={cn(
                "gap-2 py-4 transition-colors hover:border-sky-300/50 dark:hover:border-sky-600/40 cursor-pointer",
                "bg-gradient-to-br from-sky-500/[0.03] to-transparent",
                program.block.status === "planned" && "border-dashed border-sky-200/50 dark:border-sky-900/30",
              )}>
                <CardHeader className="gap-1 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Dumbbell className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                      <CardTitle className="text-sm font-semibold uppercase tracking-wide">Training Block</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {program.block.status === "active" && (
                        <span className="text-[10px] text-muted-foreground">Week 1</span>
                      )}
                      <Badge
                        variant={program.block.status === "active" ? "success" : "outline"}
                        className="text-[10px]"
                      >
                        {program.block.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5">
                  <div className="flex gap-1.5 overflow-x-auto">
                    {blockDays.map((day) => {
                      const pplAnchor = day.dayKey ? `#ppl-${day.dayKey}` : null;
                      const movementCount = day.dayKey ? program.ppl.days[day.dayKey].movements.length : 0;

                      const sharedClassName = cn(
                        "flex min-w-[72px] flex-1 flex-col items-center rounded-lg border px-2 py-3 text-center relative",
                        day.type === "lift" && "border-sky-300/40 bg-sky-50/40 dark:border-sky-800/40 dark:bg-sky-950/30",
                        day.type === "run" && "border-emerald-300/40 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/30",
                        day.type === "recovery" && "border-border/30 bg-muted/10",
                        program.block.status === "planned" && "border-dashed",
                        pplAnchor ? "hover:scale-[1.05] hover:shadow-md transition-all cursor-pointer" : "cursor-default",
                      );

                      const inner = (
                        <>
                          <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground">{day.label}</p>
                          <p className={cn(
                            "mt-1 text-xs font-bold",
                            day.type === "lift" && "text-sky-600 dark:text-sky-400",
                            day.type === "run" && "text-emerald-600 dark:text-emerald-400",
                            day.type === "recovery" && "text-muted-foreground",
                          )}>
                            {day.activity}
                          </p>
                          {day.type === "lift" && movementCount > 0 && (
                            <span className="mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/10 text-[9px] font-bold text-sky-600 dark:text-sky-400">
                              {movementCount}
                            </span>
                          )}
                        </>
                      );

                      return pplAnchor ? (
                        <a key={day.label} href={pplAnchor} className={sharedClassName}>
                          {inner}
                        </a>
                      ) : (
                        <div key={day.label} className={sharedClassName}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ═══ 4. STRENGTH + BODY + COVERAGE ═══ */}
            <section>
              <Card className="gap-2 py-4 transition-colors hover:border-sky-300/50 dark:hover:border-sky-600/40 cursor-pointer">
                <CardHeader className="gap-1 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Weight className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                      <CardTitle className="text-sm font-semibold uppercase tracking-wide">Strength Profile</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {data.tonal?.available ? (
                        <Badge variant="success" className="text-[10px]">connected</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">offline</Badge>
                      )}
                    </div>
                  </div>
                  {data.tonal?.available && (
                    <p className="text-[10px] text-muted-foreground">
                      {data.tonal.workoutCount} workouts{data.tonal.lastUpdated ? ` · ${formatShortDate(data.tonal.lastUpdated)}` : ""}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-5 px-5">
                  {/* Body metrics row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-center">
                      <p className="health-metric-label">Weight</p>
                      <p className="font-mono text-sm font-bold">
                        {data.body?.weightKg != null ? `${Math.round(data.body.weightKg * 2.205)} lbs` : "\u2014"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-center">
                      <p className="health-metric-label">Height</p>
                      <p className="font-mono text-sm font-bold">
                        {data.body?.heightM != null ? `${Math.round(data.body.heightM * 39.37)}"` : "\u2014"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-center">
                      <p className="health-metric-label">Max HR</p>
                      <p className="font-mono text-sm font-bold">
                        {formatNumber(data.body?.maxHeartRate ?? null, " bpm")}
                      </p>
                    </div>
                  </div>

                  {/* Strength charts */}
                  {data.tonal?.available && data.tonal.strengthScores.length > 0 ? (
                    <StrengthProfile scores={data.tonal.strengthScores} />
                  ) : data.tonal?.available ? (
                    <p className="py-4 text-xs text-muted-foreground">No strength score data available yet.</p>
                  ) : (
                    <p className="py-4 text-xs text-muted-foreground">Configure Tonal credentials to see strength metrics.</p>
                  )}

                  {/* Movement Coverage */}
                  <div className="space-y-2 border-t border-border/30 pt-4">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Movement Coverage</p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full bg-sky-500 dark:bg-sky-400 transition-all"
                        style={{ width: `${program.coverage.publicMovementCount > 0 ? (program.coverage.metricReadyCount / program.coverage.publicMovementCount) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">{program.coverage.metricReadyCount}/{program.coverage.publicMovementCount}</span>
                      {" metric-ready "}
                      <span className="text-muted-foreground/60">·</span>
                      {" "}<span className="font-mono font-semibold text-foreground">{program.coverage.mappedInPpl}</span> in PPL
                      {" "}<span className="text-muted-foreground/60">·</span>
                      {" "}<span className="font-mono font-semibold text-foreground">{program.coverage.workoutsSeen}</span> workouts
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ═══ 5. PPL PROGRAM ═══ */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Weight className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">PPL Program</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {program.ppl.summary.workoutsSeen} seen
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{formatTimestamp(program.ppl.generatedAt)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {(["push", "pull", "legs"] as const).map((dayKey) => {
                  const day = program.ppl.days[dayKey];
                  return (
                    <Card
                      key={dayKey}
                      className="gap-0 py-0 overflow-hidden transition-colors hover:border-sky-300/50 dark:hover:border-sky-600/40 cursor-pointer"
                    >
                      {/* Day header */}
                      <div
                        id={`ppl-${dayKey}`}
                        className="scroll-mt-4 border-b border-sky-200/30 bg-sky-500/[0.04] px-4 py-3 dark:border-sky-900/30 dark:bg-sky-950/20"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold capitalize text-sky-600 dark:text-sky-400">
                            {dayKey}
                          </h3>
                          <Badge variant="outline" className="text-[10px] font-mono bg-sky-500/5 border-sky-300/30 dark:border-sky-700/30">
                            {day.movements.length} moves
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{day.theme}</p>
                      </div>

                      {/* Movements */}
                      <CardContent className="space-y-1 px-3 py-2">
                        {day.movements.map((movement) => (
                          <MovementRow key={movement.movementId} movement={movement} maxLoad={pplMaxLoad} />
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Notes */}
              {program.ppl.notes.length > 0 && (
                <div className="mt-3 rounded-lg border border-border/30 bg-muted/5 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-1.5">Programming Notes</p>
                  <ul className="space-y-0.5">
                    {program.ppl.notes.map((note, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground">
                        <span className="text-muted-foreground/40 mr-1">-</span>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </>
        );
      })()}

      {/* ═══ 6. RECENT TONAL SESSIONS ═══ */}
      {data.tonal?.available && data.tonal.recentWorkouts.length > 0 && (
        <Animate delay={0.34}>
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Weight className="h-4 w-4 text-sky-500 dark:text-sky-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Tonal Sessions</h2>
            <Badge variant="outline" className="text-[10px] font-mono">{Math.min(data.tonal.recentWorkouts.length, 5)}</Badge>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {data.tonal.recentWorkouts.slice(0, 5).map((w) => (
              <Card
                key={w.id}
                className="min-w-[200px] max-w-[240px] flex-shrink-0 gap-1 py-3 transition-colors hover:border-sky-300/50 dark:hover:border-sky-600/40 cursor-pointer"
              >
                <CardHeader className="gap-0 px-4">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {w.startTime
                      ? new Date(w.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                      : "Workout"
                    }
                  </p>
                  <p className="font-mono text-xl font-bold text-sky-600 dark:text-sky-400">
                    {w.totalVolume > 0 ? `${(w.totalVolume / 1000).toFixed(1)}k` : "—"}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">lbs</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {w.duration ? `${Math.round(w.duration / 60)} min` : "—"}
                    {w.movementCount > 0 ? ` · ${w.movementCount} moves` : ""}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 px-4">
                  {/* Top movements */}
                  {w.topMovements.slice(0, 3).map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px]">
                      <span className="truncate text-muted-foreground">{m.name}</span>
                      <span className="ml-2 flex-shrink-0 font-mono font-semibold">{m.weight} lbs</span>
                    </div>
                  ))}
                  {/* Mini volume bar */}
                  <VolumeBar value={w.totalVolume} max={tonalMaxVolume} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        </Animate>
      )}

      {/* ═══ 7. COMBINED RECOVERY + SLEEP LINE CHART ═══ */}
      <RecoverySleepOverlay
        recovery={data.trends.recovery}
        sleep={data.trends.sleepPerformance}
      />

      {/* ═══ 8. VOLUME PROGRESSION ═══ */}
      {data.tonal?.available && data.tonal.recentWorkouts.length > 0 && (
        <VolumeProgressionChart workouts={data.tonal.recentWorkouts} />
      )}

      {/* ═══ 9. TREND BARS ═══ */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrendChartRecharts
          data={data.trends.recovery}
          colorMode="recovery"
          threshold={67}
          label="Recovery"
          currentValue={currentRecovery}
        />
        <TrendChartRecharts
          data={data.trends.sleepPerformance}
          defaultColor="#a78bfa"
          threshold={70}
          label="Sleep Performance"
          currentValue={currentSleep}
        />
      </section>

      {/* ═══ 10. ALERT TIMELINE ═══ */}
      <AlertTimeline alerts={data.alerts} history={data.alertHistory} />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   HELPER COMPONENTS
   ══════════════════════════════════════════════════ */

/* ── VitalsCard (Recovery + Sleep Combined) ── */
function VitalsCard({
  recovery,
  sleep,
}: {
  recovery: FitnessSummary["recovery"];
  sleep: FitnessSummary["sleep"];
}) {
  return (
    <Card className="gap-0 py-0 overflow-hidden transition-colors hover:border-emerald-200/50 dark:hover:border-emerald-700/30 cursor-pointer">
      {/* Top half: Recovery */}
      <div className="flex flex-col gap-4 border-b border-border/30 px-5 py-4 sm:flex-row sm:items-center">
        <RecoveryRingAnimated score={recovery.score} status={recovery.status} />
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1">
              <AnimatedValue value={recovery.hrv} formatPreset="decimal" className="font-mono text-sm font-bold" duration={1000} />
              <span className="text-[10px] text-muted-foreground">HRV</span>
            </div>
            <div className="flex items-baseline gap-1">
              <AnimatedValue value={recovery.restingHeartRate} className="font-mono text-sm font-bold" duration={1000} />
              <span className="text-[10px] text-muted-foreground">RHR</span>
            </div>
            <div className="flex items-baseline gap-1">
              <AnimatedValue value={recovery.spo2 != null ? recovery.spo2 * 100 : null} formatPreset="percent" className="font-mono text-sm font-bold" duration={1000} />
              <span className="text-[10px] text-muted-foreground">SpO&#8322;</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">{formatTimestamp(recovery.recordedAt)}</p>
        </div>
      </div>

      {/* Bottom half: Sleep */}
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <Moon className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Sleep</span>
        </div>
        <SleepStagesBar
          rem={sleep.stage.remSeconds}
          deep={sleep.stage.swsSeconds}
          light={sleep.stage.lightSeconds}
        />
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xs font-semibold">{formatDuration(sleep.durationSeconds)}</span>
            <span className="text-[10px] text-muted-foreground">dur</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xs font-semibold">{formatPercent(sleep.performance)}</span>
            <span className="text-[10px] text-muted-foreground">perf</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xs font-semibold">{formatPercent(sleep.efficiency)}</span>
            <span className="text-[10px] text-muted-foreground">eff</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xs font-semibold">{formatDuration(sleep.sleepDebtSeconds)}</span>
            <span className="text-[10px] text-muted-foreground">debt</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{formatTimestamp(sleep.recordedAt)}</p>
      </div>
    </Card>
  );
}

/* ── ActivityCard ── */
function ActivityCard({ workouts }: { workouts: WorkoutSummary[] }) {
  if (workouts.length === 0) {
    return (
      <Card className="flex items-center justify-center gap-2 py-4 transition-colors hover:border-orange-200/50 dark:hover:border-orange-700/30 cursor-pointer">
        <CardContent className="flex flex-col items-center gap-3 px-5 py-6">
          <div className="animate-pulse">
            <Dumbbell className="h-8 w-8 text-muted-foreground/30" />
          </div>
          <p className="text-sm text-muted-foreground">No activity logged yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0 overflow-hidden transition-colors hover:border-orange-200/50 dark:hover:border-orange-700/30 cursor-pointer">
      <div className="border-b border-border/30 px-5 py-3">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Today&apos;s Activity</span>
          <Badge variant="outline" className="text-[10px] font-mono">{workouts.length}</Badge>
        </div>
      </div>
      <CardContent className="space-y-0 px-0 py-0">
        {workouts.map((workout, index) => (
          <div
            key={getWorkoutRenderKey(workout, index)}
            className={cn(
              "flex items-center gap-3 px-5 py-3",
              index < workouts.length - 1 && "border-b border-border/20",
            )}
          >
            {/* Strain gauge */}
            <StrainGauge strain={workout.strain} />

            {/* Workout info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">{workout.sport}</p>
                <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatDuration(workout.durationSeconds)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono">{formatNumber(workout.kilojoules, " kJ")}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono">
                  {formatNumber(workout.avgHeartRate, "")}
                  {workout.maxHeartRate != null ? `–${workout.maxHeartRate}` : ""}
                  {" bpm"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ── StrainGauge (mini semi-circle SVG) ── */
function StrainGauge({ strain }: { strain: number | null }) {
  const pct = strain != null ? Math.min(1, strain / 21) : 0;
  /* Simple horizontal bar gauge — clean and reliable */
  return (
    <div className="flex flex-col items-center gap-0.5" style={{ width: 56 }}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30 dark:bg-muted/20">
        <div
          className="h-full rounded-full bg-orange-500 dark:bg-orange-400 transition-all"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <span className="font-mono text-xs font-bold">
        {strain != null ? strain.toFixed(1) : "—"}
      </span>
    </div>
  );
}

/* ── StrengthBars ── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _StrengthBars({ scores }: { scores: Array<{ label: string; value: number }> }) {
  const maxScore = scores.reduce((max, s) => Math.max(max, s.value), 0);

  return (
    <div className="space-y-1.5">
      {scores.map((s) => {
        const pct = maxScore > 0 ? (s.value / maxScore) * 100 : 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-20 text-right text-[10px] font-medium uppercase tracking-widest text-muted-foreground truncate">
              {s.label}
            </span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-sky-500/10 dark:bg-sky-900/20">
              <div
                className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-sky-600 to-sky-400 dark:from-sky-500 dark:to-sky-300 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
              {s.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── MovementRow ── */
function MovementRow({ movement, maxLoad }: { movement: PPLMovement; maxLoad: number }) {
  const url = movement.publicUrls?.[0] ?? null;
  const content = (
    <div className="rounded-lg border border-sky-200/30 bg-sky-50/10 px-3 py-2 dark:border-sky-900/20 dark:bg-sky-950/10 transition-all hover:scale-[1.02]">
      {/* Title + prescription */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold leading-tight">{movement.title}</span>
        <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">
          {movement.programming.sets}&times;{movement.programming.reps}
          {" "}R{movement.programming.rir}
        </span>
      </div>

      {/* Load bar */}
      <div className="mt-1.5">
        <LoadBar value={movement.recentHistory?.avgLoad ?? null} max={maxLoad} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {movement.recentHistory?.avgLoad != null ? (
          <span className="font-mono font-semibold text-foreground">{Math.round(movement.recentHistory.avgLoad)} lbs avg</span>
        ) : (
          <span>—</span>
        )}
        {movement.recentHistory?.setCount != null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono">{movement.recentHistory.setCount} sets</span>
          </>
        )}
      </div>

      {/* Badges */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {movement.validationSources.map((src) => (
          <span
            key={src}
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              src === "public_library" ? "bg-emerald-500" : "bg-blue-400",
            )}
            title={src === "public_library" ? "public" : src === "observed_history" ? "observed" : src}
          />
        ))}
        {movement.alternates.length > 0 && (
          <span className="text-[9px] text-muted-foreground/60 ml-1">
            +{movement.alternates.length} alt
          </span>
        )}
      </div>
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

/* ── LoadBar ── */
function LoadBar({ value, max }: { value: number | null; max: number }) {
  const pct = value != null && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-500/10 dark:bg-sky-900/20">
      <div
        className="h-full rounded-full bg-sky-500 dark:bg-sky-400 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── VolumeBar ── */
function VolumeBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-sky-500/10 dark:bg-sky-900/20">
      <div
        className="h-full rounded-full bg-sky-500/60 dark:bg-sky-400/60 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── RecoveryRing (smaller, inline style for size) ── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _RecoveryRing({ score, status }: { score: number | null; status: string }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  const ringClass = `recovery-ring-${status}`;

  return (
    <div className="recovery-ring" style={{ "--ring-size": "7rem" } as React.CSSProperties}>
      <svg viewBox="0 0 100 100">
        <circle className="recovery-ring-track" cx="50" cy="50" r={r} />
        <circle
          className={`recovery-ring-fill ${ringClass}`}
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={score != null ? offset : circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold font-mono", recoveryStatusColor(status))}>
          {score != null ? Math.round(score) : "—"}
        </span>
        <Badge variant={recoveryBadgeVariant(status)} className="mt-0.5 text-[9px]">
          {status}
        </Badge>
      </div>
    </div>
  );
}

/* ── SleepStagesBar ── */
function SleepStagesBar({ rem, deep, light }: { rem: number | null; deep: number | null; light: number | null }) {
  const total = (rem ?? 0) + (deep ?? 0) + (light ?? 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No sleep stage data.</p>;

  const remPct = ((rem ?? 0) / total) * 100;
  const deepPct = ((deep ?? 0) / total) * 100;
  const lightPct = ((light ?? 0) / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 overflow-hidden rounded-full">
        <div className="sleep-bar-rem transition-all" style={{ width: `${remPct}%` }} title={`REM: ${formatDuration(rem)}`} />
        <div className="sleep-bar-deep transition-all" style={{ width: `${deepPct}%` }} title={`Deep: ${formatDuration(deep)}`} />
        <div className="sleep-bar-light transition-all" style={{ width: `${lightPct}%` }} title={`Light: ${formatDuration(light)}`} />
      </div>
      <div className="flex flex-wrap gap-3 text-[10px]">
        <SleepLegendItem color="bg-violet-500 dark:bg-violet-400" label="REM" value={formatDuration(rem)} />
        <SleepLegendItem color="bg-blue-500 dark:bg-blue-400" label="Deep" value={formatDuration(deep)} />
        <SleepLegendItem color="bg-sky-400 dark:bg-sky-300" label="Light" value={formatDuration(light)} />
      </div>
    </div>
  );
}

function SleepLegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </div>
  );
}

/* ── TrendChart ── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _TrendChart({
  data,
  tone,
  colorByValue,
  threshold,
  label,
  currentValue,
}: {
  data: TrendPoint[];
  tone: string;
  colorByValue?: (value: number) => string;
  threshold?: number;
  label: string;
  currentValue: number | null;
}) {
  if (!data.length) {
    return (
      <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
        <CardHeader className="px-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">{label}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5">
          <p className="text-xs text-muted-foreground">No trend data yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
      <CardHeader className="gap-1 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">{label}</CardTitle>
          </div>
          {currentValue != null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {Math.round(currentValue)}%
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Last 14 days</p>
      </CardHeader>
      <CardContent className="px-5">
        <div className="relative flex h-28 items-end gap-0.5">
          {/* Threshold line */}
          {threshold != null && (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/20"
              style={{ bottom: `${threshold}%` }}
            >
              <span className="absolute -top-3 right-0 text-[9px] text-muted-foreground/40 font-mono">{threshold}%</span>
            </div>
          )}
          {data.map((point, i) => {
            const height = point.value == null ? 8 : Math.max(8, Math.min(100, Math.round(point.value)));
            const tooltipLabel = point.value == null ? "—" : `${Math.round(point.value)}%`;
            const showDate = i % 3 === 0;
            return (
              <div
                key={point.date}
                className="group relative flex h-full flex-1 flex-col items-center justify-end"
                title={`${point.date}: ${tooltipLabel}`}
              >
                <div className="relative flex h-full w-full items-end">
                  <div className="absolute inset-0 rounded-sm bg-muted/15" />
                  <div
                    className={cn("relative w-full rounded-sm transition-all", colorByValue && point.value != null ? colorByValue(point.value) : tone)}
                    style={{ height: `${height}%` }}
                  />
                </div>
                {showDate && (
                  <span className="mt-1 text-[8px] text-muted-foreground/50 font-mono">
                    {formatShortDate(point.date).replace(/\s/g, "")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── AlertTimeline ── */
function AlertTimeline({ alerts, history }: { alerts: FitnessAlert[]; history: FitnessAlert[] }) {
  const allAlerts = [...alerts, ...history];

  return (
    <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
      <CardHeader className="gap-1 px-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Alert Timeline</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-5">
        {allAlerts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity className="h-3 w-3" />
            </span>
            <span className="text-muted-foreground">All clear — no threshold breaches in 14 days</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Dot timeline */}
            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {allAlerts.slice(0, 20).map((alert) => (
                <span
                  key={alert.id}
                  className={cn(
                    "inline-block h-2.5 w-2.5 rounded-full flex-shrink-0",
                    alert.severity === "critical" && "bg-red-500",
                    alert.severity === "warning" && "bg-amber-500",
                    alert.severity === "info" && "bg-blue-400",
                  )}
                  title={`${alert.label}: ${alert.message} (${formatShortDate(alert.timestamp)})`}
                />
              ))}
            </div>

            {/* Recent 3 with detail */}
            <div className="space-y-1.5">
              {allAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/20 transition-colors"
                >
                  <span className={cn(
                    "mt-1 inline-block h-1.5 w-1.5 rounded-full flex-shrink-0",
                    alert.severity === "critical" && "bg-red-500",
                    alert.severity === "warning" && "bg-amber-500",
                    alert.severity === "info" && "bg-blue-400",
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{alert.label}</span>
                      <Badge variant={severityVariant(alert.severity)} className="text-[9px]">{alert.severity}</Badge>
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono">{formatShortDate(alert.timestamp)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{alert.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
