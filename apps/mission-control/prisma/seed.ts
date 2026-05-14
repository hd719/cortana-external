import {
  AgentStatus,
  Prisma,
  PrismaClient,
  RunStatus,
  Severity,
} from "@prisma/client";

const prisma = new PrismaClient();

type AgentSeed = {
  id?: string;
  name: string;
  role: string;
  description: string;
  capabilities: string;
  model: string;
  status: AgentStatus;
  healthScore: number;
  lastSeen: Date;
};

type RunSeed = {
  agentName: string;
  jobType: string;
  status: RunStatus;
  summary: string;
  payload: Prisma.InputJsonValue;
  result: Prisma.InputJsonValue | null;
  startedAt: Date;
  completedAt: Date | null;
};

type EventSeed = {
  agentName: string;
  runType: string | null;
  type: string;
  severity: Severity;
  message: string;
  metadata: Prisma.InputJsonValue;
};

const agentSeeds: AgentSeed[] = [
  {
    name: "Librarian",
    role: "Knowledge Base",
    description: "Manages notes, memory, and retrieval across projects.",
    capabilities: "Indexing, retrieval, summarization, tagging",
    model: "openai-codex/gpt-5.1",
    status: AgentStatus.active,
    healthScore: 91,
    lastSeen: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    name: "Monitor",
    role: "Guardian",
    description: "Watches health signals and raises alerts when SLAs drift.",
    capabilities: "Anomaly detection, alert routing, escalation policies",
    model: "openai-codex/gpt-5.1",
    status: AgentStatus.degraded,
    healthScore: 72,
    lastSeen: new Date(Date.now() - 1000 * 60 * 18),
  },
];

const runSeeds: RunSeed[] = [
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

const eventSeeds: EventSeed[] = [
  {
    agentName: "Monitor",
    runType: "uptime_probe",
    type: "alert",
    severity: Severity.warning,
    message: "Gateway missed 2 consecutive heartbeats (staging).",
    metadata: { target: "gateway-staging", missed: 2 },
  },
];

async function main() {
  await prisma.event.deleteMany();
  await prisma.run.deleteMany();
  await prisma.agent.deleteMany();

  const agents = await Promise.all(agentSeeds.map((agent) => prisma.agent.create({ data: agent })));

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

}

main()
  .catch((error) => {
    console.error("Seeding failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
