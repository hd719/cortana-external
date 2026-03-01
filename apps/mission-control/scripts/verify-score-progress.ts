import prisma from "../lib/prisma";
import { RunStatus } from "@prisma/client";
import { AgentOperationalStats, computeHealthScore } from "../lib/agent-health";

const normalizeIdentity = (value?: string | null) => (value || "").trim().toLowerCase();

async function loadStatsByAgent() {
  const [agents, runs, tasks] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, name: true, role: true } }),
    prisma.run.findMany({
      where: { agentId: { not: null } },
      select: { agentId: true, status: true },
      take: 2000,
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.cortanaTask.findMany({
      where: { assignedTo: { not: null } },
      select: { assignedTo: true, status: true },
      take: 4000,
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  const statsByAgent = new Map<string, AgentOperationalStats>();
  const ensureStats = (agentId: string) => {
    if (!statsByAgent.has(agentId)) {
      statsByAgent.set(agentId, {
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        completedTasks: 0,
        failedTasks: 0,
      });
    }
    return statsByAgent.get(agentId)!;
  };

  for (const run of runs) {
    if (!run.agentId) continue;
    const stats = ensureStats(run.agentId);
    if (run.status === RunStatus.completed) stats.completedRuns += 1;
    else if (run.status === RunStatus.failed) stats.failedRuns += 1;
    else if (run.status === RunStatus.cancelled) stats.cancelledRuns += 1;
  }

  const agentIdsByIdentity = new Map<string, string[]>();
  for (const agent of agents) {
    const keys = [agent.id, agent.name, agent.role].map(normalizeIdentity).filter(Boolean);
    for (const key of keys) {
      const existing = agentIdsByIdentity.get(key) || [];
      if (!existing.includes(agent.id)) existing.push(agent.id);
      agentIdsByIdentity.set(key, existing);
    }
  }

  for (const task of tasks) {
    const assigneeKey = normalizeIdentity(task.assignedTo);
    if (!assigneeKey) continue;
    const matches = agentIdsByIdentity.get(assigneeKey) || [];
    if (matches.length === 0) continue;

    const normalizedTaskStatus = task.status.toLowerCase();
    for (const agentId of matches) {
      const stats = ensureStats(agentId);
      if (["done", "completed"].includes(normalizedTaskStatus)) stats.completedTasks += 1;
      else if (["failed", "cancelled", "canceled", "timeout", "killed"].includes(normalizedTaskStatus)) {
        stats.failedTasks += 1;
      }
    }
  }

  return agents.map((agent) => ({
    ...agent,
    stats:
      statsByAgent.get(agent.id) ||
      ({ completedRuns: 0, failedRuns: 0, cancelledRuns: 0, completedTasks: 0, failedTasks: 0 } as AgentOperationalStats),
  }));
}

async function main() {
  const rows = await loadStatsByAgent();

  let failing = 0;
  console.log("Agent score progression check (+1 successful run simulation):");

  for (const row of rows) {
    const before = computeHealthScore(row.stats);
    const after = computeHealthScore({ ...row.stats, completedRuns: row.stats.completedRuns + 1 });
    const delta = Number((after - before).toFixed(2));

    console.log(`- ${row.name.padEnd(10)} before=${before.toFixed(1)} after=${after.toFixed(1)} delta=${delta.toFixed(2)}`);

    if (before < 100 && delta <= 0) {
      failing += 1;
      console.error(`  ❌ Non-responsive score for ${row.name}`);
    }
  }

  await prisma.$disconnect();

  if (failing > 0) {
    throw new Error(`Score progression check failed for ${failing} agent(s)`);
  }

  console.log("✅ Score progression is responsive for all agents below 100.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
