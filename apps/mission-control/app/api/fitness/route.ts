import { NextResponse } from "next/server";
import { FitnessClient } from "@cortana/fitness-client";
import type { WhoopData } from "@cortana/fitness-types";

export const revalidate = 300;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

type TrendPoint = { date: string; value: number | null };

type FitnessAlertSeverity = "critical" | "warning" | "info";

type FitnessAlert = {
  id: string;
  severity: FitnessAlertSeverity;
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

const fitnessClient = new FitnessClient({ baseUrl: "http://localhost:3033" });

let cachedResponse: { payload: FitnessResponse; fetchedAt: number } | null = null;

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parsePercent = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  if (parsed <= 1 && parsed >= 0) return Math.round(parsed * 100);
  return parsed;
};

const normalizeDurationSeconds = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed == null || parsed <= 0) return null;
  if (parsed > 50_000) return Math.round(parsed / 1000);
  return Math.round(parsed);
};

const getPath = (record: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, record);
};

const pickNumber = (record: Record<string, unknown> | null | undefined, paths: string[]) => {
  if (!record) return null;
  for (const path of paths) {
    const value = getPath(record, path);
    const parsed = parseNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
};

const pickString = (record: Record<string, unknown> | null | undefined, paths: string[]) => {
  if (!record) return null;
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
};

const parseDateValue = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const getRecordDate = (record: Record<string, unknown>): Date | null => {
  const candidates = [
    "end",
    "start",
    "timestamp",
    "created_at",
    "updated_at",
    "start_time",
    "end_time",
  ];
  for (const key of candidates) {
    const value = getPath(record, key);
    const parsed = parseDateValue(value);
    if (parsed) return parsed;
  }
  return null;
};

const toDayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isSameDay = (left: Date, right: Date) => toDayKey(left) === toDayKey(right);

const orderRecords = (records: Record<string, unknown>[]) => {
  return records
    .map((record: any) => ({ record, date: getRecordDate(record) }))
    .filter((item): item is { record: Record<string, unknown>; date: Date } =>
      Boolean(item.date)
    )
    .sort((a, b) => b.date.getTime() - a.date.getTime());
};

const buildDailyMetricMap = (
  records: Record<string, unknown>[],
  valueExtractor: (record: Record<string, unknown>) => number | null
) => {
  const byDay = new Map<string, { value: number; date: Date }>();
  for (const { record, date } of orderRecords(records)) {
    const value = valueExtractor(record);
    if (value == null) continue;
    const dayKey = toDayKey(date);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { value, date });
    }
  }
  return byDay;
};

const buildTrend = (
  records: Record<string, unknown>[],
  valueExtractor: (record: Record<string, unknown>) => number | null,
  today: Date
): TrendPoint[] => {
  const byDay = buildDailyMetricMap(records, valueExtractor);
  const points: TrendPoint[] = [];
  const start = new Date(today);
  start.setDate(start.getDate() - 13);
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = toDayKey(day);
    points.push({ date: key, value: byDay.get(key)?.value ?? null });
  }
  return points;
};

const getRecoveryStatus = (score: number | null): FitnessSummary["recovery"]["status"] => {
  if (score == null) return "unknown";
  if (score < 34) return "red";
  if (score < 67) return "yellow";
  return "green";
};

const toAlert = (
  id: string,
  severity: FitnessAlertSeverity,
  label: string,
  message: string,
  timestamp: Date
): FitnessAlert => ({
  id,
  severity,
  label,
  message,
  timestamp: timestamp.toISOString(),
});

const buildFitnessSummary = (data: WhoopData): FitnessSummary => {
  const now = new Date();
  const recoveryRecords = (data.recovery as Record<string, unknown>[]) ?? [];
  const sleepRecords = (data.sleep as Record<string, unknown>[]) ?? [];
  const workoutRecords = (data.workouts as Record<string, unknown>[]) ?? [];
  const cycleRecords = (data.cycles as Record<string, unknown>[]) ?? [];

  const orderedRecovery = orderRecords(recoveryRecords);
  const orderedSleep = orderRecords(sleepRecords);
  const orderedCycles = orderRecords(cycleRecords);

  const latestRecovery = orderedRecovery[0]?.record ?? null;
  const latestSleep = orderedSleep[0]?.record ?? null;
  const latestCycle = orderedCycles[0]?.record ?? null;

  const recoveryScore = parsePercent(
    pickNumber(latestRecovery, [
      "score.recovery_score",
      "recovery_score",
      "score.recovery_score_percent",
      "score.recovery_score_percentage",
      "recovery_score_percent",
      "recovery_score_percentage",
      "score",
    ])
  );
  const hrv = pickNumber(latestRecovery, [
    "score.hrv_rmssd_milli",
    "hrv_rmssd_milli",
    "score.hrv_rmssd",
    "hrv_rmssd",
    "score.hrv",
    "hrv",
    "heart_rate_variability_rmssd",
  ]);
  const restingHeartRate = pickNumber(latestRecovery, [
    "score.resting_heart_rate",
    "resting_heart_rate",
    "score.rhr",
    "rhr",
  ]);
  const spo2Raw = pickNumber(latestRecovery, [
    "score.spo2_percentage",
    "spo2_percentage",
    "score.spo2",
    "spo2",
  ]);
  const spo2 = spo2Raw == null ? null : parsePercent(spo2Raw);

  const sleepDurationSeconds =
    normalizeDurationSeconds(
      pickNumber(latestSleep, [
        "quality_duration",
        "score.stage_summary.total_sleep_time_milli",
        "score.total_sleep_time_milli",
        "total_sleep_time_milli",
        "score.total_sleep_time",
        "total_sleep_time",
        "duration",
      ])
    ) ??
    (() => {
      const start = parseDateValue(getPath(latestSleep, "start"));
      const end = parseDateValue(getPath(latestSleep, "end"));
      if (!start || !end) return null;
      const diff = (end.getTime() - start.getTime()) / 1000;
      return diff > 0 ? Math.round(diff) : null;
    })();

  const sleepPerformance = parsePercent(
    pickNumber(latestSleep, [
      "score.sleep_performance_percentage",
      "sleep_performance_percentage",
      "sleep_performance",
      "score.sleep_score",
      "sleep_score",
    ])
  );
  const sleepEfficiency = parsePercent(
    pickNumber(latestSleep, [
      "score.sleep_efficiency_percentage",
      "sleep_efficiency_percentage",
      "sleep_efficiency",
    ])
  );
  const sleepConsistency = parsePercent(
    pickNumber(latestSleep, [
      "score.sleep_consistency_percentage",
      "sleep_consistency_percentage",
      "sleep_consistency",
    ])
  );

  const remSeconds = normalizeDurationSeconds(
    pickNumber(latestSleep, [
      "score.stage_summary.total_rem_sleep_time_milli",
      "score.stage_summary.rem_sleep_time_milli",
      "stage_summary.total_rem_sleep_time_milli",
      "stage_summary.rem_sleep_time_milli",
      "rem_sleep_time_milli",
      "rem_sleep_time",
    ])
  );
  const swsSeconds = normalizeDurationSeconds(
    pickNumber(latestSleep, [
      "score.stage_summary.total_slow_wave_sleep_time_milli",
      "score.stage_summary.slow_wave_sleep_time_milli",
      "score.stage_summary.sws_sleep_time_milli",
      "stage_summary.total_slow_wave_sleep_time_milli",
      "slow_wave_sleep_time_milli",
      "sws_sleep_time_milli",
      "slow_wave_sleep_time",
    ])
  );
  const lightSeconds = normalizeDurationSeconds(
    pickNumber(latestSleep, [
      "score.stage_summary.total_light_sleep_time_milli",
      "score.stage_summary.light_sleep_time_milli",
      "stage_summary.total_light_sleep_time_milli",
      "light_sleep_time_milli",
      "light_sleep_time",
    ])
  );

  const sleepDebtSeconds =
    normalizeDurationSeconds(
      pickNumber(latestSleep, [
        "score.sleep_debt_milli",
        "sleep_debt_milli",
        "sleep_debt",
        "score.sleep_debt",
      ])
    ) ??
    normalizeDurationSeconds(
      pickNumber(latestCycle, [
        "score.sleep_debt_milli",
        "sleep_debt_milli",
        "sleep_debt",
        "score.sleep_debt",
      ])
    );

  const workoutsWithDates = orderRecords(workoutRecords);
  const todayWorkouts = workoutsWithDates.filter(({ date }) => isSameDay(date, now));

  const workouts: WorkoutSummary[] = todayWorkouts.map(({ record, date }, index) => {
    const id = pickString(record, ["id"]) ?? `${date.getTime()}-${index}`;
    const sport =
      pickString(record, ["sport_name", "sport", "sport.name"]) ??
      (() => {
        const sportId = pickNumber(record, ["sport_id", "sport.id"]);
        return sportId != null ? `Sport ${Math.round(sportId)}` : "Workout";
      })();
    const strain = pickNumber(record, ["score.strain", "strain"]);
    const avgHeartRate = pickNumber(record, [
      "score.average_heart_rate",
      "average_heart_rate",
      "score.avg_heart_rate",
      "avg_heart_rate",
    ]);
    const maxHeartRate = pickNumber(record, ["score.max_heart_rate", "max_heart_rate"]);
    const kilojoules = pickNumber(record, [
      "score.kilojoule",
      "score.kilojoules",
      "kilojoules",
      "kilojoule",
    ]);
    const durationSeconds =
      normalizeDurationSeconds(pickNumber(record, ["duration", "score.duration"])) ??
      (() => {
        const start = parseDateValue(getPath(record, "start"));
        const end = parseDateValue(getPath(record, "end"));
        if (!start || !end) return null;
        const diff = (end.getTime() - start.getTime()) / 1000;
        return diff > 0 ? Math.round(diff) : null;
      })();

    return {
      id,
      sport,
      start: date.toISOString(),
      strain,
      durationSeconds,
      avgHeartRate,
      maxHeartRate,
      kilojoules,
    };
  });

  const recoveryTrend = buildTrend(
    recoveryRecords,
    (record) =>
      parsePercent(
        pickNumber(record, [
          "score.recovery_score",
          "recovery_score",
          "score.recovery_score_percent",
          "recovery_score_percent",
          "score",
        ])
      ),
    now
  );

  const sleepPerformanceTrend = buildTrend(
    sleepRecords,
    (record) =>
      parsePercent(
        pickNumber(record, [
          "score.sleep_performance_percentage",
          "sleep_performance_percentage",
          "sleep_performance",
          "score.sleep_score",
          "sleep_score",
        ])
      ),
    now
  );

  const recoveryByDay = buildDailyMetricMap(recoveryRecords, (record) =>
    parsePercent(
      pickNumber(record, [
        "score.recovery_score",
        "recovery_score",
        "score.recovery_score_percent",
        "recovery_score_percent",
        "score",
      ])
    )
  );
  const sleepPerformanceByDay = buildDailyMetricMap(sleepRecords, (record) =>
    parsePercent(
      pickNumber(record, [
        "score.sleep_performance_percentage",
        "sleep_performance_percentage",
        "sleep_performance",
        "score.sleep_score",
        "sleep_score",
      ])
    )
  );
  const sleepEfficiencyByDay = buildDailyMetricMap(sleepRecords, (record) =>
    parsePercent(
      pickNumber(record, [
        "score.sleep_efficiency_percentage",
        "sleep_efficiency_percentage",
        "sleep_efficiency",
      ])
    )
  );
  const sleepDebtByDay = buildDailyMetricMap(sleepRecords, (record) => {
    const debt =
      normalizeDurationSeconds(
        pickNumber(record, [
          "score.sleep_debt_milli",
          "sleep_debt_milli",
          "sleep_debt",
          "score.sleep_debt",
        ])
      ) ?? null;
    return debt == null ? null : Math.round(debt);
  });

  const alerts: FitnessAlert[] = [];
  if (recoveryScore != null && recoveryScore < 34) {
    alerts.push(
      toAlert(
        "recovery-critical",
        "critical",
        "Recovery critical",
        `Recovery score ${Math.round(recoveryScore)} is below 34.`,
        now
      )
    );
  } else if (recoveryScore != null && recoveryScore < 50) {
    alerts.push(
      toAlert(
        "recovery-warning",
        "warning",
        "Recovery low",
        `Recovery score ${Math.round(recoveryScore)} is below 50.`,
        now
      )
    );
  }

  if (sleepPerformance != null && sleepPerformance < 70) {
    alerts.push(
      toAlert(
        "sleep-performance-warning",
        "warning",
        "Sleep performance low",
        `Sleep performance ${Math.round(sleepPerformance)}% is below 70%.`,
        now
      )
    );
  }

  if (sleepEfficiency != null && sleepEfficiency < 85) {
    alerts.push(
      toAlert(
        "sleep-efficiency-warning",
        "warning",
        "Sleep efficiency low",
        `Sleep efficiency ${Math.round(sleepEfficiency)}% is below 85%.`,
        now
      )
    );
  }

  if (sleepDebtSeconds != null && sleepDebtSeconds > 2 * 3600) {
    const hours = Math.round((sleepDebtSeconds / 3600) * 10) / 10;
    alerts.push(
      toAlert(
        "sleep-debt-warning",
        "warning",
        "Sleep debt elevated",
        `Sleep debt is ${hours}h above target.`,
        now
      )
    );
  }

  if (now.getHours() >= 12 && workouts.length === 0) {
    alerts.push(
      toAlert(
        "workout-nudge",
        "info",
        "No workout yet",
        "No workout detected by noon.",
        now
      )
    );
  }

  const alertHistory: FitnessAlert[] = [];
  const start = new Date(now);
  start.setDate(start.getDate() - 13);
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = toDayKey(day);

    const recoveryDay = recoveryByDay.get(key);
    if (recoveryDay?.value != null) {
      if (recoveryDay.value < 34) {
        alertHistory.push(
          toAlert(
            `recovery-critical-${key}`,
            "critical",
            "Recovery critical",
            `Recovery score ${Math.round(recoveryDay.value)} was below 34.`,
            recoveryDay.date
          )
        );
      } else if (recoveryDay.value < 50) {
        alertHistory.push(
          toAlert(
            `recovery-warning-${key}`,
            "warning",
            "Recovery low",
            `Recovery score ${Math.round(recoveryDay.value)} was below 50.`,
            recoveryDay.date
          )
        );
      }
    }

    const sleepPerfDay = sleepPerformanceByDay.get(key);
    if (sleepPerfDay?.value != null && sleepPerfDay.value < 70) {
      alertHistory.push(
        toAlert(
          `sleep-performance-warning-${key}`,
          "warning",
          "Sleep performance low",
          `Sleep performance ${Math.round(sleepPerfDay.value)}% was below 70%.`,
          sleepPerfDay.date
        )
      );
    }

    const sleepEffDay = sleepEfficiencyByDay.get(key);
    if (sleepEffDay?.value != null && sleepEffDay.value < 85) {
      alertHistory.push(
        toAlert(
          `sleep-efficiency-warning-${key}`,
          "warning",
          "Sleep efficiency low",
          `Sleep efficiency ${Math.round(sleepEffDay.value)}% was below 85%.`,
          sleepEffDay.date
        )
      );
    }

    const sleepDebtDay = sleepDebtByDay.get(key);
    if (sleepDebtDay?.value != null && sleepDebtDay.value > 2 * 3600) {
      const hours = Math.round((sleepDebtDay.value / 3600) * 10) / 10;
      alertHistory.push(
        toAlert(
          `sleep-debt-warning-${key}`,
          "warning",
          "Sleep debt elevated",
          `Sleep debt reached ${hours}h.`,
          sleepDebtDay.date
        )
      );
    }
  }

  alertHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    recovery: {
      score: recoveryScore,
      status: getRecoveryStatus(recoveryScore),
      hrv,
      restingHeartRate,
      spo2,
      recordedAt: orderedRecovery[0]?.date?.toISOString() ?? null,
    },
    sleep: {
      durationSeconds: sleepDurationSeconds,
      efficiency: sleepEfficiency,
      performance: sleepPerformance,
      consistency: sleepConsistency,
      sleepDebtSeconds,
      stage: {
        remSeconds,
        swsSeconds,
        lightSeconds,
      },
      recordedAt: orderedSleep[0]?.date?.toISOString() ?? null,
    },
    workouts,
    trends: {
      recovery: recoveryTrend,
      sleepPerformance: sleepPerformanceTrend,
    },
    alerts,
    alertHistory,
  };
};

export async function GET() {
  const now = Date.now();
  if (cachedResponse && now - cachedResponse.fetchedAt < FIVE_MINUTES_MS) {
    return NextResponse.json({ ...cachedResponse.payload, cached: true });
  }

  try {
    const raw = await fitnessClient.getWhoopData();
    const summary = buildFitnessSummary(raw);
    const payload: FitnessResponse = {
      status: "ok",
      generatedAt: new Date().toISOString(),
      cached: false,
      data: summary,
    };
    cachedResponse = { payload, fetchedAt: now };
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load fitness data.";
    const detail = error instanceof Error ? error.stack : undefined;
    const payload: FitnessResponse = {
      status: "error",
      generatedAt: new Date().toISOString(),
      cached: false,
      error: { message, detail },
    };
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "no-store",
      },
    });
  }
}
