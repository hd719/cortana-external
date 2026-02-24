import assert from "node:assert/strict";
import { mapMergeToTaskIds } from "../lib/post-merge-task-autoclose";

function run() {
  const mapped = mapMergeToTaskIds({
    prNumber: 100,
    prTitle: "feat: close #46 + task: 51",
    prBody: "Implements task-id: 88 and cortana_tasks-99",
    labels: ["infra", "task: 200"],
    commitMessages: ["fix: harden retry for #46", "docs: refs #301"],
  });

  assert.deepEqual(mapped, [46, 51, 88, 99, 200, 301]);

  const noRefs = mapMergeToTaskIds({
    prNumber: 101,
    prTitle: "chore: cleanup",
    prBody: "No explicit task ids",
  });

  assert.deepEqual(noRefs, []);

  console.log("✅ post-merge task auto-close mapping tests passed");
}

run();
