# Token Optimizer

A skill for analyzing and optimizing token usage across OpenClaw sessions, crons, and sub-agents.

## What it does

- **Context Profiler**: Measures workspace bootstrap files (SOUL.md, MEMORY.md, etc.) and estimates their token overhead per session
- **Token Tracker**: Reads OpenClaw session store, breaks down usage by session kind (main/cron/subagent), estimates costs per model
- **Prompt Optimizer**: Analyzes cron payloads for compression opportunities, suggests skill allowlists, and estimates savings

## Usage

```bash
cd skills/token-optimizer

# Profile workspace context overhead
npx tsx src/index.ts --profile

# Today's token usage breakdown
npx tsx src/index.ts --usage

# Optimization recommendations
npx tsx src/index.ts --optimize

# All reports
npx tsx src/index.ts --all
```

## Integration

This skill can be called by heartbeat crons or monitoring agents to track token spend and surface optimization opportunities. Add to your cron rotation:

```bash
npx tsx /path/to/skills/token-optimizer/src/index.ts --usage
```

## Architecture

- `src/types.ts` — Shared types, model cost table
- `src/context-profiler.ts` — Bootstrap file measurement
- `src/token-tracker.ts` — Session usage analysis from OpenClaw store
- `src/prompt-optimizer.ts` — Cron payload analysis and recommendations
- `src/index.ts` — CLI entry point
