import { AgentStatus, Prisma, PrismaClient, RunStatus, Severity } from "@prisma/client";

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

const epicSeeds = [
  {
    name: "Reliability",
    title: "Keep Cortana agents reliable and observable",
    metadata: { pillar: "Career" },
  },
  {
    name: "Time",
    title: "Return time through automation",
    metadata: { pillar: "Time" },
  },
  {
    name: "Health",
    title: "Health telemetry and habits",
    metadata: { pillar: "Health" },
  },
];

const taskSeeds = [
  {
    key: "uptime-playbook",
    title: "Draft uptime playbook for gateway",
    description: "Codify steps to recover from heartbeat misses.",
    status: "pending",
    priority: 2,
    autoExecutable: false,
    metadata: { pillar: "Career" },
    epic: "Reliability",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2),
  },
  {
    key: "auto-remediation",
    title: "Enable auto-remediation for heartbeat misses",
    description: "Trigger restart + alert when uptime probes fail twice.",
    status: "pending",
    priority: 1,
    autoExecutable: true,
    dependsOnKeys: ["uptime-playbook"],
    metadata: { pillar: "Career" },
    epic: "Reliability",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 36),
  },
  {
    key: "task-board-ui",
    title: "Add task board to Mission Control",
    description: "Expose ready, blocked, and pillar views for transparency.",
    status: "in_progress",
    priority: 2,
    autoExecutable: false,
    metadata: { pillar: "Career" },
    epic: "Time",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
  },
  {
    key: "heartbeat-upgrade",
    title: "Harden heartbeat checks",
    description: "Add variance alerting and slack pings for degraded agents.",
    status: "pending",
    priority: 3,
    autoExecutable: false,
    metadata: { pillar: "Time" },
    epic: "Time",
  },
  {
    key: "sleep-sync",
    title: "Sync sleep score into daily brief",
    description: "Pull Whoop recovery + HRV into morning dashboard.",
    status: "done",
    priority: 3,
    autoExecutable: true,
    outcome: "Integrated recovery + HRV pull; adds 0.3s to brief generation.",
    metadata: { pillar: "Health" },
    epic: "Health",
    completedAt: new Date(Date.now() - 1000 * 60 * 60 * 20),
  },
  {
    key: "step-targets",
    title: "Set step targets for weekdays",
    description: "Auto-generate daily step target nudges.",
    status: "pending",
    priority: 4,
    autoExecutable: true,
    dependsOnKeys: ["sleep-sync"],
    metadata: { pillar: "Health" },
    epic: "Health",
    dueAt: new Date(Date.now() - 1000 * 60 * 60 * 4),
  },
  {
    key: "expense-ingest",
    title: "Ingest last 30 days of expenses",
    description: "Pull Plaid export and normalize merchants.",
    status: "pending",
    priority: 2,
    autoExecutable: true,
    metadata: { pillar: "Wealth" },
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
  },
  {
    key: "budget-drift",
    title: "Detect budget drift",
    description: "Flag spend anomalies vs. targets and alert.",
    status: "pending",
    priority: 1,
    autoExecutable: true,
    dependsOnKeys: ["expense-ingest"],
    metadata: { pillar: "Wealth" },
  },
  {
    key: "weekly-review",
    title: "Ship weekly review",
    description: "Send recap across pillars with ready/blocked tasks.",
    status: "in_progress",
    priority: 3,
    autoExecutable: false,
    metadata: { pillar: "Time" },
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 72),
  },
  {
    key: "db-snapshots",
    title: "DB snapshots",
    description: "Nightly snapshots for task state.",
    status: "done",
    priority: 3,
    autoExecutable: true,
    outcome: "Nightly cron enabled; snapshots stored locally.",
    metadata: { pillar: "Career" },
    completedAt: new Date(Date.now() - 1000 * 60 * 60 * 30),
  },
];

async function main() {
  await prisma.event.deleteMany();
  await prisma.run.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.cortanaTask.deleteMany();
  await prisma.cortanaEpic.deleteMany();

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
          result: run.result ?? Prisma.JsonNull,
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

  const epics = await Promise.all(
    epicSeeds.map((epic) =>
      prisma.cortanaEpic.create({
        data: {
          title: epic.title,
          metadata: epic.metadata,
          source: "seed",
        },
      })
    )
  );

  const epicIdByName = epics.reduce<Record<string, number>>((acc, epic, index) => {
    const name = epicSeeds[index]?.name || epic.title;
    acc[name] = epic.id;
    return acc;
  }, {});

  const createdTaskByKey: Record<string, number> = {};

  for (const task of taskSeeds) {
    const dependsOn = (task.dependsOnKeys || [])
      .map((key) => createdTaskByKey[key])
      .filter(Boolean);

    const created = await prisma.cortanaTask.create({
      data: {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        autoExecutable: task.autoExecutable,
        dependsOn,
        metadata: task.metadata,
        epicId: task.epic ? epicIdByName[task.epic] : null,
        dueAt: task.dueAt,
        completedAt: task.completedAt,
        outcome: task.outcome,
        source: "seed",
      },
    });

    createdTaskByKey[task.key] = created.id;
  }
}

main()
  .catch((error) => {
    console.error("Seeding failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
