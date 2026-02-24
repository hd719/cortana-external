import { AgentStatus, PrismaClient, RunStatus, Severity } from "@prisma/client";

const prisma = new PrismaClient();

const agentSeeds = [
  {
    name: "Huragok",
    role: "Systems Engineer",
    description: "Keeps infrastructure healthy and automates self-healing routines.",
    capabilities: "Infra automation, diagnostics, observability, runbook execution",
    status: AgentStatus.active,
    healthScore: 94,
    lastSeen: new Date(),
  },
  {
    name: "Oracle",
    role: "Forecaster",
    description: "Highlights risks and opportunities with quick scenario modeling.",
    capabilities: "Risk analysis, forecasting, alerting",
    status: AgentStatus.active,
    healthScore: 88,
    lastSeen: new Date(Date.now() - 1000 * 60 * 12),
  },
  {
    name: "Researcher",
    role: "Scout",
    description: "Surfaces research summaries, benchmarks, and supporting evidence.",
    capabilities: "Research synthesis, comparisons, source tracking",
    status: AgentStatus.idle,
    healthScore: 85,
    lastSeen: new Date(Date.now() - 1000 * 60 * 45),
  },
  {
    name: "Librarian",
    role: "Knowledge Base",
    description: "Manages notes, memory, and retrieval across projects.",
    capabilities: "Indexing, retrieval, summarization, tagging",
    status: AgentStatus.active,
    healthScore: 91,
    lastSeen: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    name: "Monitor",
    role: "Guardian",
    description: "Watches health signals and raises alerts when SLAs drift.",
    capabilities: "Anomaly detection, alert routing, escalation policies",
    status: AgentStatus.degraded,
    healthScore: 72,
    lastSeen: new Date(Date.now() - 1000 * 60 * 18),
  },
];

const runSeeds = [
  {
    agentName: "Huragok",
    jobType: "daily_sync",
    status: RunStatus.completed,
    summary: "Refreshed infra telemetry and updated cache.",
    payload: { scope: "telemetry", interval: "24h" },
    result: { durationMinutes: 8, refreshed: 124 },
    startedAt: new Date(Date.now() - 1000 * 60 * 50),
    completedAt: new Date(Date.now() - 1000 * 60 * 42),
  },
  {
    agentName: "Researcher",
    jobType: "literature_scan",
    status: RunStatus.running,
    summary: "Scanning for new eval papers on agent reliability.",
    payload: { topic: "agent reliability", sources: ["arxiv", "openreview"] },
    result: null,
    startedAt: new Date(Date.now() - 1000 * 60 * 22),
    completedAt: null,
  },
  {
    agentName: "Monitor",
    jobType: "uptime_probe",
    status: RunStatus.failed,
    summary: "Missed heartbeat from staging gateway.",
    payload: { target: "gateway-staging", intervalSeconds: 60 },
    result: { lastResponseMs: null, attempts: 3 },
    startedAt: new Date(Date.now() - 1000 * 60 * 75),
    completedAt: new Date(Date.now() - 1000 * 60 * 70),
  },
];

const eventSeeds = [
  {
    agentName: "Monitor",
    runType: "uptime_probe",
    type: "alert",
    severity: Severity.warning,
    message: "Gateway missed 2 consecutive heartbeats (staging).",
    metadata: { target: "gateway-staging", missed: 2 },
  },
  {
    agentName: "Oracle",
    runType: null,
    type: "insight",
    severity: Severity.info,
    message: "No critical risks detected in the last 12h window.",
    metadata: { windowHours: 12 },
  },
  {
    agentName: "Huragok",
    runType: "daily_sync",
    type: "health",
    severity: Severity.info,
    message: "Infra sync completed successfully.",
    metadata: { refreshed: 124 },
  },
];

async function main() {
  await prisma.event.deleteMany();
  await prisma.run.deleteMany();
  await prisma.agent.deleteMany();

  const agents = await Promise.all(
    agentSeeds.map((agent) => prisma.agent.create({ data: agent }))
  );

  const agentIdByName = agents.reduce<Record<string, string>>((acc, agent) => {
    acc[agent.name] = agent.id;
    return acc;
  }, {});

  const runs = await Promise.all(
    runSeeds.map((run) =>
      prisma.run.create({
        data: {
          jobType: run.jobType,
          status: run.status,
          summary: run.summary,
          payload: run.payload,
          result: run.result,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          agentId: agentIdByName[run.agentName],
        },
      })
    )
  );

  const runIdByType = runs.reduce<Record<string, string>>((acc, run) => {
    acc[run.jobType] = run.id;
    return acc;
  }, {});

  await Promise.all(
    eventSeeds.map((event) =>
      prisma.event.create({
        data: {
          type: event.type,
          severity: event.severity,
          message: event.message,
          metadata: event.metadata,
          agentId: agentIdByName[event.agentName],
          runId: event.runType ? runIdByType[event.runType] : null,
        },
      })
    )
  );
}

main()
  .catch((error) => {
    console.error("Seeding failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
