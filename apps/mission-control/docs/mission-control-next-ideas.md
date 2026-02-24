# Mission Control — next high-impact ideas

1. **SLA breach predictor for queued/running jobs**
   - Estimate time-to-completion from historical medians and flag likely breaches before they happen.

2. **Failure fingerprinting + auto-clustering**
   - Group failed/timeout runs by normalized stack/error signature so repeated incidents collapse into one actionable bucket.

3. **One-click replay with safe presets**
   - Add "Replay" actions from a failed run with editable parameters (agent, timeout, context), plus dry-run mode.

4. **Agent reliability scorecard**
   - Per-agent rolling metrics (success rate, timeout rate, p95 duration, MTTR) with week-over-week trend badges.

5. **Run-to-task linkage and outcome sync**
   - Attach runs to task IDs/epics and auto-update task states when runs complete/fail.

6. **Event timeline with causality view**
   - Merge run status transitions, logs, and alerts into a single chronological timeline for faster incident reconstruction.

7. **Smart anomaly alerts (not just static thresholds)**
   - Alert on statistically unusual spikes in failures, queue depth, or duration per agent/job type.

8. **Operational playbooks embedded in UI**
   - For common failures/timeouts, show "next best actions" and runbook links directly on the run row/detail panel.
