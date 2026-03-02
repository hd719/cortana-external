import { readFileSync, existsSync } from 'fs';
import type { SessionUsage, UsageReport, SessionKind } from './types.js';
import { MODEL_COSTS } from './types.js';

const SESSIONS_PATH = process.env.SESSIONS_PATH ||
  `${process.env.HOME}/.openclaw/agents/main/sessions/sessions.json`;

function classifySession(key: string): SessionKind {
  if (key === 'agent:main:main') return 'main';
  if (key.includes(':cron:') && key.includes(':run:')) return 'cron-isolated';
  if (key.includes(':cron:')) return 'cron-main';
  if (key.includes(':subagent:')) return 'subagent';
  return 'unknown';
}

function estimateCost(usage: { inputTokens: number; outputTokens: number; cacheRead: number }, model: string): number {
  const modelKey = Object.keys(MODEL_COSTS).find(k => model.includes(k));
  const rates = modelKey ? MODEL_COSTS[modelKey] : MODEL_COSTS['gpt-5.3-codex'];
  return (
    (usage.inputTokens / 1_000_000) * rates.input +
    (usage.outputTokens / 1_000_000) * rates.output +
    (usage.cacheRead / 1_000_000) * rates.cacheRead
  );
}

export function loadSessionUsage(): SessionUsage[] {
  if (!existsSync(SESSIONS_PATH)) {
    console.error(`Sessions file not found: ${SESSIONS_PATH}`);
    return [];
  }

  const data = JSON.parse(readFileSync(SESSIONS_PATH, 'utf-8'));
  const sessions: SessionUsage[] = [];

  for (const [key, val] of Object.entries(data)) {
    const v = val as any;
    const input = v.inputTokens || 0;
    const output = v.outputTokens || 0;
    const cacheRead = v.cacheRead || 0;
    const cacheWrite = v.cacheWrite || 0;
    const total = input + output + cacheRead;

    if (total === 0) continue;

    const model = v.model || 'unknown';
    sessions.push({
      sessionKey: key,
      sessionId: v.sessionId || '',
      model,
      kind: classifySession(key),
      inputTokens: input,
      outputTokens: output,
      cacheRead,
      cacheWrite,
      totalTokens: total,
      estimatedCostUsd: estimateCost({ inputTokens: input, outputTokens: output, cacheRead }, model),
    });
  }

  return sessions.sort((a, b) => b.totalTokens - a.totalTokens);
}

export function generateUsageReport(sessions: SessionUsage[]): UsageReport {
  const byKind: UsageReport['byKind'] = {
    main: { count: 0, tokens: 0, costUsd: 0 },
    'cron-isolated': { count: 0, tokens: 0, costUsd: 0 },
    'cron-main': { count: 0, tokens: 0, costUsd: 0 },
    subagent: { count: 0, tokens: 0, costUsd: 0 },
    unknown: { count: 0, tokens: 0, costUsd: 0 },
  };

  for (const s of sessions) {
    byKind[s.kind].count++;
    byKind[s.kind].tokens += s.totalTokens;
    byKind[s.kind].costUsd += s.estimatedCostUsd;
  }

  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0);

  return {
    date: new Date().toISOString().split('T')[0],
    sessions,
    totalTokens,
    totalEstimatedCostUsd: totalCost,
    topSpenders: sessions.slice(0, 10),
    byKind,
  };
}

export function printUsageReport(report: UsageReport): void {
  console.log('\n💰 Token Usage Report');
  console.log('═'.repeat(60));
  console.log(`Date: ${report.date}\n`);

  console.log('By Session Kind:');
  for (const [kind, stats] of Object.entries(report.byKind)) {
    if (stats.count === 0) continue;
    console.log(`  ${kind.padEnd(16)} ${String(stats.count).padStart(4)} sessions  ${String(stats.tokens).padStart(10)} tokens  $${stats.costUsd.toFixed(4)}`);
  }

  console.log(`\n  ${'TOTAL'.padEnd(16)} ${String(report.sessions.length).padStart(4)} sessions  ${String(report.totalTokens).padStart(10)} tokens  $${report.totalEstimatedCostUsd.toFixed(4)}`);

  console.log('\nTop 10 Spenders:');
  for (const s of report.topSpenders) {
    const name = s.sessionKey.length > 50 ? '...' + s.sessionKey.slice(-47) : s.sessionKey;
    console.log(`  ${name.padEnd(52)} ${String(s.totalTokens).padStart(8)} tokens  $${s.estimatedCostUsd.toFixed(4)}  (${s.kind})`);
  }
  console.log('');
}
