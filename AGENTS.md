# AGENTS.md — cortana-external Bootstrap Manual

Fresh session rule: read this file first, then inspect `/Users/hd/Developer/cortana-external`, `/Users/hd/Developer/cortana`, and `/Users/hd/.openclaw` before trying to solve the problem.

This file is the high-signal bootstrap for stateless Codex sessions working in `cortana-foundry/cortana-external`.

Use it when:
- a new Codex session starts cold
- chat history is missing
- you are working from Hamel's laptop over Tailscale into the Mac mini
- you need to debug Mission Control, external-service, the backtester, or launchd-managed runtime state
- you need to decide whether a change belongs in `cortana-external`, `cortana`, or `~/.openclaw`

This repo is the runtime body.
If `cortana` is doctrine, routing, prompts, and command-brain policy, `cortana-external` is the live execution/runtime surface.
Durable operational follow-up now belongs in GitHub Issues, not Mission Control Task Board rows. Do not reintroduce `/task-board`, `/api/task-board`, or local task mirror tables.

## 1. Primary Reality

Treat the Mac mini as the canonical machine unless Hamel explicitly says otherwise.

Primary machine assumptions:
- Host role: always-on runtime machine
- User: `hd`
- Repo path: `/Users/hd/Developer/cortana-external`
- Sibling command-brain repo: `/Users/hd/Developer/cortana`
- Live runtime/state path: `/Users/hd/.openclaw`
- External-service loopback: `http://127.0.0.1:3033`
- Mission Control prod loopback: `http://127.0.0.1:3000`
- Mission Control dev loopback: `http://127.0.0.1:3001`

Mac mini access defaults:
- Tailscale IP: `100.120.198.12`
- SSH config label from Hamel's laptop: `Mac-Mini`
- Tailscale browser paths:
  - prod: `http://100.120.198.12:3000`
  - dev: `http://100.120.198.12:3001`
  - do not use `3002`; it is not a supported Mission Control environment
  - host HTTPS path often used for prod: `https://hs-mac-mini.taild96d14.ts.net`

If you begin on another machine:
1. SSH to the Mac mini first.
2. Rebuild context on the live machine.
3. Treat notes or old chat summaries as advisory only.

## 2. What This Repo Owns

`cortana-external` owns runtime-facing code and operator surfaces:
- Mission Control UI and API: `/Users/hd/Developer/cortana-external/apps/mission-control`
- External fitness/trading service: `/Users/hd/Developer/cortana-external/apps/external-service`
- CANSLIM/backtester runtime and trading workflows: `/Users/hd/Developer/cortana-external/backtester`
- Watchdog reliability monitor: `/Users/hd/Developer/cortana-external/watchdog`
- Launchd entrypoints and production-style restart flows
- Runtime docs, runbooks, and operator knowledge for these surfaces

It does not own:
- Cortana doctrine, routing policy, identity, prompts, or memory policy
- Tracked OpenClaw command-layer config
- Live runtime truth by itself when deploy/runtime drift exists

Related sources of truth:
- `cortana`: `/Users/hd/Developer/cortana`
- runtime live state: `/Users/hd/.openclaw`

If source and runtime disagree, inspect runtime first before claiming anything is fixed.

## 3. Cross-Repo Reality

Many tasks in `cortana-external` are really split-brain tasks.

Use this ownership map:
- Mission Control, external-service, watchdog, launchd scripts, operator-facing runtime surfaces, and runtime GitHub issue follow-up: `cortana-external`
- doctrine, routing, prompts, tracked config, identity, memory policy, command-layer docs: `cortana`
- deployed/live runtime state, cron truth, queues, logs, gateway bindings, generated memory/wiki: `~/.openclaw`

When a task crosses repos:
1. update runtime implementation in `cortana-external`
2. update doctrine/config/docs in `cortana` if the behavior contract changed
3. verify whether runtime restart or state reconciliation is needed in `~/.openclaw`

For cross-repo orientation, also read:
- `/Users/hd/Developer/cortana/AGENTS.md`

## 4. Cold-Start Protocol

Do not start editing immediately in a fresh session.

First 60-second checklist:
1. Read this file.
2. Read `/Users/hd/Developer/cortana/AGENTS.md`.
3. Check repo state:
   - `git -C /Users/hd/Developer/cortana-external status --short --branch`
   - `git -C /Users/hd/Developer/cortana status --short --branch`
4. Inspect the live surfaces:
   - `/Users/hd/Developer/cortana-external`
   - `/Users/hd/Developer/cortana`
   - `/Users/hd/.openclaw`
5. Decide whether the issue is:
   - stale runtime state
   - launchd/process drift
   - source/runtime contract mismatch
   - actual code defect
   - operator misunderstanding caused by noisy UI/runtime state

If the issue touches Mission Control, also read:
- `/Users/hd/Developer/cortana-external/apps/mission-control/README.md`

If the issue touches watchdog:
- `/Users/hd/Developer/cortana-external/watchdog/README.md`

If the issue touches trading/backtester:
- `/Users/hd/Developer/cortana-external/backtester/README.md`
- `/Users/hd/Developer/cortana-external/knowledge/domains/backtester/current-state.md`

## 5. Repo Layout That Matters

High-signal paths:
- root README: `/Users/hd/Developer/cortana-external/README.md`
- Mission Control: `/Users/hd/Developer/cortana-external/apps/mission-control`
- Mission Control restart script: `/Users/hd/Developer/cortana-external/apps/mission-control/scripts/restart-mission-control.sh`
- Mission Control start entrypoint: `/Users/hd/Developer/cortana-external/apps/mission-control/scripts/start-mission-control.sh`
- external-service launchd wrapper: `/Users/hd/Developer/cortana-external/launchd-run.sh`
- backtester runtime: `/Users/hd/Developer/cortana-external/backtester`
- watchdog: `/Users/hd/Developer/cortana-external/watchdog`

Important repo-level facts:
- there is an `apps/` directory, not a top-level `services/` directory
- there is no generic top-level `scripts/` folder; service entrypoints live under app/feature directories
- launchd-managed runtime is first-class here; do not assume `pnpm dev` is the production truth

## 6. Mission Control Reality

Mission Control is a Next.js operator dashboard with two launchd-managed profiles:
- source: `/Users/hd/Developer/cortana-external/apps/mission-control`
- prod URL: `http://127.0.0.1:3000`
- dev URL: `http://127.0.0.1:3001`
- prod health endpoint: `http://127.0.0.1:3000/api/heartbeat-status`
- dev health endpoint: `http://127.0.0.1:3001/api/heartbeat-status`
- prod launchd label: `com.cortana.mission-control`
- dev launchd label: `com.cortana.mission-control-dev`

Environment mapping:
- prod: `PORT=3000`, `MISSION_CONTROL_RUNTIME_ENV=prod`, `MARKET_LAB_ENV=prod`
- dev: `PORT=3001`, `MISSION_CONTROL_RUNTIME_ENV=dev`, `MARKET_LAB_ENV=dev`
- no `3002` Mission Control profile exists; if `100.120.198.12:3002` serves anything, inspect stale Tailscale Serve config.

Preferred restart flow:
```bash
cd /Users/hd/Developer/cortana-external
bash apps/mission-control/scripts/restart-mission-control.sh --env prod
bash apps/mission-control/scripts/restart-mission-control.sh --env dev
```

What the restart script does:
- builds the app with `pnpm build`
- reinstalls the LaunchAgent to a direct `next start` entrypoint
- kills stale `next-server` or `pnpm start` wrappers
- bootstraps/kickstarts `com.cortana.mission-control`
- waits for `/api/heartbeat-status`
- optionally runs the Trading Ops smoke guard

Do not treat `pnpm dev` as equivalent to the launchd-managed runtime if the user is QAing a live surface.

Mission Control-specific debugging:
1. check health:
   - `curl -sS http://127.0.0.1:3000/api/heartbeat-status`
   - `curl -sS http://127.0.0.1:3001/api/heartbeat-status`
2. if unhealthy, run the restart script above
3. inspect launchd state:
   - `launchctl print gui/$(id -u)/com.cortana.mission-control`
   - `launchctl print gui/$(id -u)/com.cortana.mission-control-dev`
4. inspect listeners:
   - `lsof -iTCP:3000 -sTCP:LISTEN`
   - `lsof -iTCP:3001 -sTCP:LISTEN`
   - `lsof -iTCP:3002 -sTCP:LISTEN` should be empty
5. if the app differs from repo expectations, confirm `.env.local` and build output

Useful build/test commands:
```bash
cd /Users/hd/Developer/cortana-external/apps/mission-control
pnpm build
npx vitest run
```

## 7. External Service Reality

The external-service is the runtime edge for provider integrations.

Key facts:
- source: `/Users/hd/Developer/cortana-external/apps/external-service`
- default bind: `127.0.0.1:3033`
- launchd wrapper: `/Users/hd/Developer/cortana-external/launchd-run.sh`
- launchd label: `com.cortana.fitness-service`

Primary health paths:
- `http://127.0.0.1:3033/health`
- `http://127.0.0.1:3033/market-data/ready`
- `http://127.0.0.1:3033/market-data/ops`

Preferred restart:
```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service
```

Useful local commands:
```bash
cd /Users/hd/Developer/cortana-external
pnpm --filter @cortana/external-service start
pnpm --filter @cortana/external-service dev
pnpm --filter @cortana/external-service test
pnpm --filter @cortana/external-service typecheck
```

Runtime files often involved in debugging:
- `/Users/hd/Developer/cortana-external/.env`
- `/Users/hd/Developer/cortana-external/whoop_tokens.json`
- `/Users/hd/Developer/cortana-external/tonal_tokens.json`
- `/Users/hd/Developer/cortana-external/alpaca_keys.json`

## 8. Backtester / Trading Ops Reality

Backtester runtime lives at:
- `/Users/hd/Developer/cortana-external/backtester`

Trading Ops in Mission Control depends on:
- Mission Control app health
- external-service health on `3033`
- Postgres truth for `mc_trading_runs`
- file/artifact fallback when DB truth is missing

If Trading Ops looks wrong:
1. check Mission Control health
2. check external-service health and `/market-data/ops`
3. inspect whether the UI is using DB-backed truth or fallback truth
4. verify the same run/artifact from the backtester side

High-signal commands:
```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python advisor.py --quick-check NVDA
uv run python nightly_discovery.py --limit 20
```

## 9. Watchdog Reality

Watchdog is a launchd reliability monitor.

Key facts:
- source: `/Users/hd/Developer/cortana-external/watchdog`
- launchd label: `com.cortana.watchdog`
- runtime plist: `~/Library/LaunchAgents/com.cortana.watchdog.plist`

It watches at least:
- Mission Control via `http://127.0.0.1:3000/api/heartbeat-status`
- external-service / market-data readiness on `3033`

Useful commands:
```bash
launchctl print gui/$(id -u)/com.cortana.watchdog
launchctl kickstart -k gui/$(id -u)/com.cortana.watchdog
```

Read:
- `/Users/hd/Developer/cortana-external/watchdog/README.md`

## 10. Debugging Playbook

Default debugging posture: assume runtime or contract drift first.

Use this sequence:
1. verify branch/worktree state
2. verify the relevant launchd job and listening port
3. hit the health/readiness endpoint directly
4. read the repo docs/readme for that surface
5. compare source assumptions against live runtime truth
6. only then patch code

Mission Control weirdness:
- check `/api/heartbeat-status`
- restart via `apps/mission-control/scripts/restart-mission-control.sh`
- inspect `launchctl print gui/$(id -u)/com.cortana.mission-control`

External-service or market-data weirdness:
- check `/health`, `/market-data/ready`, `/market-data/ops`
- restart `com.cortana.fitness-service`
- confirm `.env`/token files

Trading Ops weirdness:
- verify both Mission Control and external-service
- determine whether the UI is showing DB truth or fallback truth
- cross-check the underlying run/artifact

Codex Sessions workspace weirdness:
- Mission Control mirrors the local Codex store under `~/.codex`
- if sessions look wrong, inspect the repo code plus the local Codex state before assuming the browser is the only problem

Cross-repo drift:
- if behavior depends on prompts, doctrine, routing, or tracked config, inspect `cortana`
- if behavior depends on runtime state, inspect `~/.openclaw`

## 11. Git Hygiene

Before any branch/commit/push work:
```bash
git status --short --branch
```

Rules:
- stage only intended files
- do not sweep unrelated work into a branch
- do not rely on the GitHub connector/plugin to create PRs for this repo
- when starting from `main`, use `codex/<description>` branches unless the user asks otherwise

Safe branch flow:
```bash
git switch main
git pull --ff-only origin main
git switch -c codex/<description>
```

## 12. PR Creation That Actually Works

This repo has a known sharp edge:
- GitHub integration/plugin PR creation may fail with `403 Resource not accessible by integration`

Reliable path:
1. create/switch branch locally
2. commit locally
3. push with local git
4. create PR with local `gh`

Default publish rule:
- when a task changes repo code, default to pushing a ready PR in the same work session unless Hamel explicitly says not to publish yet

Use local Mac mini git and gh, not the GitHub connector, for PR creation in `cortana-foundry/cortana-external`.

Preferred commands:
```bash
git push -u origin $(git branch --show-current)
gh pr create --draft --base main --head $(git branch --show-current)
```

If the PR body needs markdown, code spans, or multiple lines:
1. write it to a temp `.md` file
2. use `--body-file`

Example:
```bash
gh pr create \
  --draft \
  --base main \
  --head $(git branch --show-current) \
  --title "[codex] concise title" \
  --body-file /tmp/pr-body.md
```

Do not inline complex markdown with backticks into remote shell commands.

## 13. Remote Shell Safety

The Mac mini remote shell is `zsh` with `nomatch` enabled.

Rules:
- do not put raw `[codex]`-style strings inside double-quoted remote commands
- do not inline markdown with backticks into remote commands
- for complex remote commands, prefer:
  - `ssh <host> "bash -lc '...'"` 
- if a PR body or markdown is needed remotely, write a temp file and pass `--body-file`

## 14. Validation Expectations

Do not stop at code changes if the task is runtime-facing.

At minimum, when relevant:
- run the most specific tests for the changed area
- run a build/typecheck if types/interfaces changed
- restart Mission Control if the user is QAing the live UI
- verify the health endpoint after restart

Mission Control validation example:
```bash
cd /Users/hd/Developer/cortana-external/apps/mission-control
pnpm build
npx vitest run app/sessions/page.client.test.tsx
cd /Users/hd/Developer/cortana-external
bash apps/mission-control/scripts/restart-mission-control.sh
curl -sS http://127.0.0.1:3000/api/heartbeat-status
```

## 15. Quick Orientation Commands

Use these first in a cold session:

```bash
git -C /Users/hd/Developer/cortana-external status --short --branch
git -C /Users/hd/Developer/cortana status --short --branch
curl -sS http://127.0.0.1:3000/api/heartbeat-status
curl -sS http://127.0.0.1:3033/health
launchctl print gui/$(id -u)/com.cortana.mission-control
launchctl print gui/$(id -u)/com.cortana.fitness-service
launchctl print gui/$(id -u)/com.cortana.watchdog
```

If you only remember one mental model:
- `cortana-external` = runtime body
- `cortana` = command brain
- `~/.openclaw` = live deployed state
- Mac mini = canonical machine
- local `git` + local `gh` = reliable PR path
