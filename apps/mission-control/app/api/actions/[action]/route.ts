import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

type ActionKey = "chaos-test" | "reflection-sweep" | "check-budget" | "force-heartbeat";

type HealthCheckResult = {
  name: string;
  passed: boolean;
  details: string;
};

type ReflectionItem = {
  id: number;
  title: string;
  status: string;
  completed_at: Date | string | null;
  outcome: string | null;
};

type BudgetSummary = {
  used: number | null;
  remaining: number | null;
  burnRate: number | null;
  source: "quota-tracker" | "telegram-usage";
  raw?: unknown;
};

const VALID_ACTIONS: ActionKey[] = [
  "chaos-test",
  "reflection-sweep",
  "check-budget",
  "force-heartbeat",
];

const getTaskClient = () => getTaskPrisma() ?? prisma;

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseBudgetFromTracker = (raw: Record<string, unknown>): Omit<BudgetSummary, "source"> => {
  const used = normalizeNumber(raw.used) ?? normalizeNumber(raw.spendToDate) ?? normalizeNumber(raw.budget_used);
  const remaining = normalizeNumber(raw.remaining) ?? normalizeNumber(raw.left) ?? normalizeNumber(raw.budget_remaining);
  const burnRate = normalizeNumber(raw.burnRate) ?? normalizeNumber(raw.burn_rate) ?? normalizeNumber(raw.dailyBurnRate);

  return {
    used,
    remaining,
    burnRate,
    raw,
  };
};

const runChaosTest = async () => {
  const checks: HealthCheckResult[] = [];
  const client = getTaskClient();

  try {
    await client.$queryRawUnsafe("SELECT 1");
    checks.push({
      name: "PostgreSQL",
      passed: true,
      details: "SELECT 1 succeeded",
    });
  } catch (error) {
    checks.push({
      name: "PostgreSQL",
      passed: false,
      details: error instanceof Error ? error.message : "Failed to query PostgreSQL",
    });
  }

  try {
    const output = execSync("curl -s http://localhost:3033/health", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    checks.push({
      name: "Fitness service",
      passed: output.length > 0,
      details: output || "No output returned",
    });
  } catch (error) {
    checks.push({
      name: "Fitness service",
      passed: false,
      details: error instanceof Error ? error.message : "Failed to check fitness service",
    });
  }

  try {
    const output = execSync("openclaw gateway status", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const normalized = output.toLowerCase();
    const isRunning =
      normalized.includes("running") || normalized.includes("active") || normalized.includes("started");

    checks.push({
      name: "OpenClaw gateway",
      passed: isRunning,
      details: output || "No output returned",
    });
  } catch (error) {
    checks.push({
      name: "OpenClaw gateway",
      passed: false,
      details: error instanceof Error ? error.message : "Failed to check OpenClaw gateway",
    });
  }

  return {
    ok: checks.every((check) => check.passed),
    action: "chaos-test" as const,
    checks,
    ranAt: new Date().toISOString(),
  };
};

const runReflectionSweep = async () => {
  const client = getTaskClient();

  const items = (await client.$queryRawUnsafe(
    "SELECT id, title, status, completed_at, outcome FROM cortana_tasks WHERE status = 'done' AND completed_at > NOW() - INTERVAL '24 hours' ORDER BY completed_at DESC LIMIT 10"
  )) as ReflectionItem[];

  return {
    ok: true,
    action: "reflection-sweep" as const,
    reflections: items,
    count: items.length,
    ranAt: new Date().toISOString(),
  };
};

const runBudgetCheck = () => {
  const quotaFilePath = path.join(os.homedir(), ".openclaw", "quota-tracker.json");

  if (existsSync(quotaFilePath)) {
    const fileRaw = readFileSync(quotaFilePath, "utf8");
    const parsed = JSON.parse(fileRaw) as Record<string, unknown>;
    const summary: BudgetSummary = {
      ...parseBudgetFromTracker(parsed),
      source: "quota-tracker",
    };

    return {
      ok: true,
      action: "check-budget" as const,
      budget: summary,
      checkedAt: new Date().toISOString(),
    };
  }

  const output = execSync("node /Users/hd/clawd/skills/telegram-usage/handler.js json", {
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  const parsed = JSON.parse(output) as Record<string, unknown>;
  const summary: BudgetSummary = {
    ...parseBudgetFromTracker(parsed),
    source: "telegram-usage",
  };

  return {
    ok: true,
    action: "check-budget" as const,
    budget: summary,
    checkedAt: new Date().toISOString(),
  };
};

const runForceHeartbeat = async () => {
  const client = getTaskClient();

  await client.$executeRawUnsafe(
    "INSERT INTO cortana_events (event_type, source, severity, message) VALUES ('manual_heartbeat', 'dashboard', 'info', 'Manual heartbeat forced from Mission Control')"
  );

  return {
    ok: true,
    action: "force-heartbeat" as const,
    message: "Manual heartbeat event inserted",
    timestamp: new Date().toISOString(),
  };
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  if (!VALID_ACTIONS.includes(action as ActionKey)) {
    return NextResponse.json(
      { ok: false, message: `Unknown action: ${action}` },
      { status: 404 }
    );
  }

  try {
    switch (action as ActionKey) {
      case "chaos-test":
        return NextResponse.json(await runChaosTest());
      case "reflection-sweep":
        return NextResponse.json(await runReflectionSweep());
      case "check-budget":
        return NextResponse.json(runBudgetCheck());
      case "force-heartbeat":
        return NextResponse.json(await runForceHeartbeat());
      default:
        return NextResponse.json({ ok: false, message: "Unhandled action" }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Action failed",
      },
      { status: 500 }
    );
  }
}
