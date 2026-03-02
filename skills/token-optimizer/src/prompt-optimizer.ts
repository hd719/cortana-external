import { readFileSync, existsSync } from 'fs';
import type { CronPayloadAnalysis, OptimizationReport } from './types.js';
import { estimateTokens, profileWorkspace } from './context-profiler.js';

const CRON_PATH = process.env.CRON_PATH ||
  `${process.env.HOME}/.openclaw/cron/jobs.json`;

const SKILL_KEYWORDS: Record<string, string[]> = {
  'weather': ['weather', 'wttr', 'forecast', 'temperature'],
  'fitness-coach': ['whoop', 'tonal', 'recovery', 'strain', 'workout', 'fitness', 'sleep'],
  'bird': ['twitter', 'tweet', 'x.com', 'bird', 'sentiment'],
  'news-summary': ['news', 'rss', 'bbc', 'reuters', 'npr', 'headline'],
  'gog': ['gmail', 'google calendar', 'gog ', 'email'],
  'caldav-calendar': ['caldav', 'khal', 'vdirsyncer', 'ical'],
  'github': ['gh ', 'github', 'pull request', 'issue', 'pr '],
  'coding-agent': ['codex', 'claude code', 'coding', 'implement'],
};

function detectRelevantSkills(payload: string): string[] {
  const lower = payload.toLowerCase();
  const matched: string[] = [];
  for (const [skill, keywords] of Object.entries(SKILL_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(skill);
    }
  }
  return matched;
}

function findCompressionOpportunities(payload: string): string[] {
  const opportunities: string[] = [];
  if (payload.length > 3000) opportunities.push('Payload exceeds 3000 chars — consider splitting setup from instructions');
  if ((payload.match(/export PATH/g) || []).length > 1) opportunities.push('Duplicate PATH exports — consolidate to one');
  if ((payload.match(/psql cortana/g) || []).length > 3) opportunities.push('Multiple psql calls — consider combining into single SQL script');
  if (payload.includes('```') && payload.split('```').length > 5) opportunities.push('Many code blocks — consider extracting to a script file');
  const lines = payload.split('\n');
  const commentLines = lines.filter(l => l.trim().startsWith('#') || l.trim().startsWith('//'));
  if (commentLines.length > lines.length * 0.3) opportunities.push(`${commentLines.length}/${lines.length} lines are comments — reduce inline documentation`);
  return opportunities;
}

export function analyzeCronPayloads(): CronPayloadAnalysis[] {
  if (!existsSync(CRON_PATH)) {
    console.error(`Cron file not found: ${CRON_PATH}`);
    return [];
  }

  const raw = JSON.parse(readFileSync(CRON_PATH, 'utf-8'));
  const jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  const results: CronPayloadAnalysis[] = [];

  for (const job of jobs) {
    const payload = job.payload?.message || '';
    results.push({
      cronId: job.id || '',
      cronName: job.name || 'unnamed',
      enabled: job.enabled ?? false,
      payloadChars: payload.length,
      payloadEstimatedTokens: estimateTokens(payload.length),
      suggestedSkills: detectRelevantSkills(payload),
      compressionOpportunities: findCompressionOpportunities(payload),
    });
  }

  return results.sort((a, b) => b.payloadEstimatedTokens - a.payloadEstimatedTokens);
}

export function generateOptimizationReport(): OptimizationReport {
  const contextProfile = profileWorkspace();
  const cronAnalysis = analyzeCronPayloads();

  const enabledCrons = cronAnalysis.filter(c => c.enabled);
  const currentPerRun = contextProfile.totalEstimatedTokens + 
    (enabledCrons.reduce((s, c) => s + c.payloadEstimatedTokens, 0) / enabledCrons.length);
  
  // Optimized estimate: slim bootstrap (~2k) + compressed payload (~60% of current)
  const optimizedPerRun = 2000 + (currentPerRun - contextProfile.totalEstimatedTokens) * 0.6;
  const savingsPerRun = currentPerRun - optimizedPerRun;
  
  // Estimate daily runs from cron frequencies
  const estimatedDailyRuns = enabledCrons.length * 4; // rough avg 4 runs/day per cron
  const dailySavings = savingsPerRun * estimatedDailyRuns;

  const recommendations: string[] = [];
  
  const bigPayloads = enabledCrons.filter(c => c.payloadEstimatedTokens > 500);
  if (bigPayloads.length > 0) {
    recommendations.push(`${bigPayloads.length} cron jobs have payloads > 500 tokens — compress or extract to scripts`);
  }

  const allOpportunities = enabledCrons.flatMap(c => c.compressionOpportunities);
  if (allOpportunities.length > 0) {
    recommendations.push(`${allOpportunities.length} compression opportunities found across enabled crons`);
  }

  if (contextProfile.totalEstimatedTokens > 5000) {
    recommendations.push(`Bootstrap context is ~${contextProfile.totalEstimatedTokens} tokens — consider trimming MEMORY.md and HEARTBEAT.md for cron sessions`);
  }

  recommendations.push('Set agents.list[].skills allowlists per cron agent to reduce skill injection overhead');
  recommendations.push('Use contextPruning with cache-ttl mode to trim stale tool results');

  return {
    contextProfile,
    cronAnalysis,
    totalCurrentTokensPerCronRun: Math.round(currentPerRun),
    totalOptimizedTokensPerCronRun: Math.round(optimizedPerRun),
    estimatedDailySavingsTokens: Math.round(dailySavings),
    recommendations,
  };
}

export function printOptimizationReport(report: OptimizationReport): void {
  console.log('\n🔧 Token Optimization Report');
  console.log('═'.repeat(60));

  console.log(`\nBootstrap overhead: ~${report.contextProfile.totalEstimatedTokens} tokens/session`);
  console.log(`Avg tokens per cron run (current): ~${report.totalCurrentTokensPerCronRun}`);
  console.log(`Avg tokens per cron run (optimized): ~${report.totalOptimizedTokensPerCronRun}`);
  console.log(`Estimated daily savings: ~${report.estimatedDailySavingsTokens.toLocaleString()} tokens`);

  const enabled = report.cronAnalysis.filter(c => c.enabled);
  console.log(`\nTop cron payloads (${enabled.length} enabled):`);
  for (const c of enabled.slice(0, 10)) {
    console.log(`  ${c.cronName.slice(0, 45).padEnd(47)} ${String(c.payloadEstimatedTokens).padStart(5)} tokens  skills: [${c.suggestedSkills.join(', ') || 'none'}]`);
    for (const opp of c.compressionOpportunities) {
      console.log(`    ⚠️  ${opp}`);
    }
  }

  console.log('\nRecommendations:');
  for (const r of report.recommendations) {
    console.log(`  → ${r}`);
  }
  console.log('');
}
