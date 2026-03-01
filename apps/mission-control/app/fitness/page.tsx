import { headers } from "next/headers";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
};

type FitnessResponse =
  | {
      status: "ok";
      generatedAt: string;
      cached: boolean;
      data: FitnessSummary;
    }
  | {
      status: "error";
      generatedAt: string;
      cached: boolean;
      error: { message: string; detail?: string };
    };

const getBaseUrl = async () => {
  // Always use localhost for server-side fetches to avoid DNS resolution issues
  return `http://localhost:${process.env.PORT || "3000"}`;
};

const formatPercent = (value: number | null) =>
  value == null ? "—" : `${Math.round(value)}%`;

const formatNumber = (value: number | null, suffix = "") =>
  value == null ? "—" : `${Math.round(value)}${suffix}`;

const formatDecimal = (value: number | null, suffix = "") =>
  value == null ? "—" : `${Math.round(value * 10) / 10}${suffix}`;

const formatDuration = (seconds: number | null) => {
  if (seconds == null) return "—";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
};

const formatTimestamp = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const severityVariant = (severity: FitnessAlert["severity"]) => {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return "info";
};

const TrendBars = ({ data, tone }: { data: TrendPoint[]; tone: string }) => {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground">No trend data yet.</p>;
  }

  return (
    <div className="flex h-16 items-end gap-1">
      {data.map((point) => {
        const height = point.value == null ? 12 : Math.max(12, Math.min(100, Math.round(point.value)));
        const label = point.value == null ? "—" : `${Math.round(point.value)}%`;
        return (
          <div
            key={point.date}
            className="flex h-full flex-1 items-end rounded-sm bg-muted/40"
            title={`${point.date}: ${label}`}
          >
            <div className={cn("h-full w-full rounded-sm", tone)} style={{ height: `${height}%` }} />
          </div>
        );
      })}
    </div>
  );
};

async function getFitnessData(): Promise<FitnessResponse> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}/api/fitness`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      status: "error",
      generatedAt: new Date().toISOString(),
      cached: false,
      error: { message: `Request failed (${response.status})` },
    };
  }

  return (await response.json()) as FitnessResponse;
}

export default async function FitnessPage() {
  const response = await getFitnessData();

  if (response.status !== "ok") {
    return (
      <div className="space-y-6">
        <AutoRefresh />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-lg">Fitness data unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{response.error.message}</p>
            <p>
              Ensure the Whoop service is running at{" "}
              <code className="font-mono">http://localhost:3033</code> and that OAuth
              is authorized.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data } = response;
  const recoveryScore = data.recovery.score;
  const recoveryTone =
    data.recovery.status === "green"
      ? "text-emerald-600"
      : data.recovery.status === "yellow"
        ? "text-amber-500"
        : data.recovery.status === "red"
          ? "text-red-500"
          : "text-muted-foreground";

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Fitness
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Recovery Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily recovery, sleep, and workout signals from Whoop.
          </p>
        </div>
        <div className="space-y-2 text-right text-xs text-muted-foreground">
          <p>Updated: {formatTimestamp(response.generatedAt)}</p>
          <p>Source cache: {response.cached ? "warm" : "fresh"}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert indicators</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.alerts.length === 0 ? (
            <Badge variant="success">All clear</Badge>
          ) : (
            data.alerts.map((alert) => (
              <Badge key={alert.id} variant={severityVariant(alert.severity)}>
                {alert.label}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Recovery</CardTitle>
            <p className="text-xs text-muted-foreground">
              Recorded: {formatTimestamp(data.recovery.recordedAt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Today score
                </p>
                <p className={cn("text-4xl font-semibold", recoveryTone)}>
                  {formatNumber(recoveryScore)}
                </p>
              </div>
              <Badge
                variant={
                  data.recovery.status === "green"
                    ? "success"
                    : data.recovery.status === "yellow"
                      ? "warning"
                      : data.recovery.status === "red"
                        ? "destructive"
                        : "outline"
                }
              >
                {data.recovery.status}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">HRV</p>
                <p className="text-lg font-semibold">
                  {formatDecimal(data.recovery.hrv, " ms")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">RHR</p>
                <p className="text-lg font-semibold">
                  {formatNumber(data.recovery.restingHeartRate, " bpm")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SpO₂</p>
                <p className="text-lg font-semibold">{formatPercent(data.recovery.spo2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Sleep</CardTitle>
            <p className="text-xs text-muted-foreground">
              Last night: {formatTimestamp(data.sleep.recordedAt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-lg font-semibold">
                  {formatDuration(data.sleep.durationSeconds)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Performance</p>
                <p className="text-lg font-semibold">
                  {formatPercent(data.sleep.performance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Efficiency</p>
                <p className="text-lg font-semibold">
                  {formatPercent(data.sleep.efficiency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Consistency</p>
                <p className="text-lg font-semibold">
                  {formatPercent(data.sleep.consistency)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-wide text-muted-foreground">REM</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatDuration(data.sleep.stage.remSeconds)}
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-muted-foreground">SWS</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatDuration(data.sleep.stage.swsSeconds)}
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-muted-foreground">Light</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatDuration(data.sleep.stage.lightSeconds)}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Sleep debt
              </p>
              <p className="text-lg font-semibold">
                {formatDuration(data.sleep.sleepDebtSeconds)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Strain & Workouts</CardTitle>
            <p className="text-xs text-muted-foreground">Today</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.workouts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 p-4 text-sm text-muted-foreground">
                No workouts logged yet.
              </div>
            ) : (
              <div className="space-y-3">
                {data.workouts.map((workout) => (
                  <div
                    key={workout.id}
                    className="rounded-lg border border-muted/40 bg-muted/10 p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{workout.sport}</p>
                        <p className="text-xs text-muted-foreground">
                          Start: {formatTimestamp(workout.start)}
                        </p>
                      </div>
                      <Badge variant="outline">
                        Strain {formatDecimal(workout.strain)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p className="uppercase tracking-wide">Duration</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatDuration(workout.durationSeconds)}
                        </p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide">Kilojoules</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(workout.kilojoules, " kJ")}
                        </p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide">Avg HR</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(workout.avgHeartRate, " bpm")}
                        </p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide">Max HR</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(workout.maxHeartRate, " bpm")}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">14-day trends</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <p className="font-medium text-foreground">Recovery</p>
                <p className="text-xs text-muted-foreground">Last 14 days</p>
              </div>
              <TrendBars data={data.trends.recovery} tone="bg-emerald-500/70" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <p className="font-medium text-foreground">Sleep performance</p>
                <p className="text-xs text-muted-foreground">Last 14 days</p>
              </div>
              <TrendBars data={data.trends.sleepPerformance} tone="bg-sky-500/70" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.alertHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent threshold breaches.</p>
            ) : (
              data.alertHistory.slice(0, 10).map((alert) => (
                <div
                  key={alert.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-muted/40 bg-muted/5 p-3 text-sm"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{alert.label}</p>
                    <p className="text-xs text-muted-foreground">{alert.message}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                    <span>{formatTimestamp(alert.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
