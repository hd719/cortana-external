import { NextRequest, NextResponse } from "next/server";
import { closeMappedTasksWithVerification } from "@/lib/post-merge-task-autoclose";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GithubPullRequestPayload = {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    merged?: boolean;
    title?: string;
    body?: string;
    merge_commit_sha?: string;
    labels?: Array<{ name?: string }>;
    base?: { ref?: string };
  };
};

export async function POST(req: NextRequest) {
  const token = process.env.GITHUB_MERGE_HOOK_TOKEN?.trim();
  const auth = req.headers.get("authorization") || "";

  if (token && auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json()) as GithubPullRequestPayload;
  const pr = payload.pull_request;

  if (!pr?.number) {
    return NextResponse.json({ error: "Missing pull_request.number" }, { status: 400 });
  }

  if (payload.action !== "closed" || !pr.merged) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not a merged PR close event" });
  }

  if (pr.base?.ref !== "main") {
    return NextResponse.json({ ok: true, skipped: true, reason: `Base branch ${pr.base?.ref} is not main` });
  }

  const receipt = await closeMappedTasksWithVerification({
    repository: payload.repository?.full_name,
    prNumber: pr.number,
    prTitle: pr.title,
    prBody: pr.body,
    labels: pr.labels?.map((label) => label.name || "").filter(Boolean),
    mergeCommitSha: pr.merge_commit_sha,
  });

  const status = receipt.ok ? 200 : 500;
  return NextResponse.json(receipt, { status });
}
