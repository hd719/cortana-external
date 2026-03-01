import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import {
  closeMappedTasksWithVerification,
  mapMergeToTaskIds,
} from "../lib/post-merge-task-autoclose";

const execFileAsync = promisify(execFile);

type PullRequestEventPayload = {
  pull_request?: {
    number?: number;
    merged?: boolean;
    title?: string;
    body?: string;
    merge_commit_sha?: string;
    labels?: Array<{ name?: string }>;
    base?: { ref?: string };
  };
  repository?: { full_name?: string };
};

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
};

const hasFlag = (name: string): boolean => process.argv.includes(name);

async function loadEventPayload(): Promise<PullRequestEventPayload | null> {
  const eventPath = arg("--event-path") || process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  const raw = await readFile(eventPath, "utf8");
  return JSON.parse(raw) as PullRequestEventPayload;
}

async function fetchPrCommitMessages(repo: string, prNumber: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${repo}/pulls/${prNumber}/commits`,
      "--jq",
      ".[].[\"commit\"][\"message\"]",
    ]);

    return stdout
      .split("\n")
      .map((line: any) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const payload = await loadEventPayload();

  const prNumber = Number(arg("--pr") || payload?.pull_request?.number || 0);
  const repository = arg("--repo") || payload?.repository?.full_name || process.env.GITHUB_REPOSITORY;
  const mergedFromPayload = payload?.pull_request?.merged;
  const baseBranch = payload?.pull_request?.base?.ref;
  const mergeCommitSha = arg("--merge-sha") || payload?.pull_request?.merge_commit_sha || undefined;

  if (!prNumber || !repository) {
    throw new Error("Missing required values. Provide --pr and --repo (or GitHub event context).");
  }

  if (mergedFromPayload === false) {
    console.log(JSON.stringify({ skipped: true, reason: "PR not merged", prNumber }));
    return;
  }

  if (baseBranch && baseBranch !== "main" && !hasFlag("--allow-non-main")) {
    console.log(JSON.stringify({ skipped: true, reason: `Base branch is ${baseBranch}, not main`, prNumber }));
    return;
  }

  const labels = (
    payload?.pull_request?.labels?.map((label: any) => label.name || "").filter(Boolean) ||
    (arg("--labels") || "")
      .split(",")
      .map((item: any) => item.trim())
      .filter(Boolean)
  ) as string[];

  const prTitle = arg("--title") || payload?.pull_request?.title || "";
  const prBody = arg("--body") || payload?.pull_request?.body || "";

  const commitMessages = hasFlag("--no-commit-fetch")
    ? []
    : await fetchPrCommitMessages(repository, prNumber);

  const mappedTaskIds = mapMergeToTaskIds({
    repository,
    prNumber,
    prTitle,
    prBody,
    labels,
    mergeCommitSha,
    commitMessages,
  });

  const receipt = await closeMappedTasksWithVerification({
    repository,
    prNumber,
    prTitle,
    prBody,
    labels,
    mergeCommitSha,
    commitMessages,
  });

  console.log(
    JSON.stringify(
      {
        ...receipt,
        mappedTaskIds,
      },
      null,
      2
    )
  );

  if (!receipt.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
