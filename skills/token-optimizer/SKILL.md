# Token Optimizer

Analyze and optimize token usage across OpenClaw sessions, crons, and sub-agents.

## USE WHEN
- Token budget analysis and cost tracking
- Prompt optimization and context profiling
- Identifying high-spend sessions and crons
- Recommending skill allowlists per job

## DON'T USE
- Direct prompt manipulation of other skills at runtime
- Runtime model switching (use OpenClaw config for that)

## Usage
```bash
# Profile workspace context (bootstrap file sizes + token estimates)
npx tsx skills/token-optimizer/src/index.ts --profile

# Today's token usage breakdown by session
npx tsx skills/token-optimizer/src/index.ts --usage

# Optimization recommendations for cron payloads
npx tsx skills/token-optimizer/src/index.ts --optimize
```
