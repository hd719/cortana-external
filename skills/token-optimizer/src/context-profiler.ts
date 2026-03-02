import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { TokenEstimate, ContextProfile } from './types.js';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || '', 'openclaw');

const BOOTSTRAP_FILES = [
  'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
  'USER.md', 'HEARTBEAT.md', 'MEMORY.md', 'BOOTSTRAP.md',
];

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function profileFile(filePath: string): TokenEstimate | null {
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  if (!stat.isFile()) return null;
  const content = readFileSync(filePath, 'utf-8');
  return {
    file: filePath.replace(WORKSPACE + '/', ''),
    chars: content.length,
    estimatedTokens: estimateTokens(content.length),
  };
}

export function profileWorkspace(): ContextProfile {
  const files: TokenEstimate[] = [];

  for (const name of BOOTSTRAP_FILES) {
    const result = profileFile(join(WORKSPACE, name));
    if (result) files.push(result);
  }

  const totalChars = files.reduce((sum, f) => sum + f.chars, 0);
  const totalEstimatedTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    files,
    totalChars,
    totalEstimatedTokens,
    timestamp: new Date().toISOString(),
  };
}

export function printContextProfile(profile: ContextProfile): void {
  console.log('\n📊 Workspace Bootstrap Context Profile');
  console.log('═'.repeat(60));
  console.log(`Timestamp: ${profile.timestamp}\n`);

  const sorted = [...profile.files].sort((a, b) => b.estimatedTokens - a.estimatedTokens);
  for (const f of sorted) {
    const bar = '█'.repeat(Math.ceil(f.estimatedTokens / 200));
    console.log(`  ${f.file.padEnd(20)} ${String(f.chars).padStart(6)} chars  ~${String(f.estimatedTokens).padStart(5)} tokens  ${bar}`);
  }

  console.log(`\n  ${'TOTAL'.padEnd(20)} ${String(profile.totalChars).padStart(6)} chars  ~${String(profile.totalEstimatedTokens).padStart(5)} tokens`);
  console.log(`\n  This context is injected into EVERY session (main, cron, sub-agent).`);
  console.log(`  With ${sorted.length} bootstrap files, each API call pays ~${profile.totalEstimatedTokens} tokens before any message content.\n`);
}
