"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCcw, ShieldAlert } from "lucide-react";
import type { AutonomyOpsSnapshot, AutonomyOpsArtifact } from "@/lib/autonomy-ops";
import type { HumanRequiredAction } from "@/lib/human-required-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AutonomyClientProps = {
  initialSnapshot: AutonomyOpsSnapshot;
  initialHumanActions: HumanRequiredAction[];
  initialHumanActionsError: string | null;
};

type HumanActionsResponse = {
  ok: boolean;
  items: HumanRequiredAction[];
  error?: string;
};

type RefreshResponse = AutonomyOpsSnapshot & {
  refreshedAt?: string;
  staleData?: AutonomyOpsSnapshot | AutonomyOpsArtifact;
};

const tone: Record<string, string> = {
  live: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700",
  watch: "border-amber-500/40 bg-amber-500/5 text-amber-700",
  attention: "border-red-500/40 bg-red-500/5 text-red-700",
};

function TimeLabel({ iso }: { iso: string | null }) {
  if (!iso) return <span>unknown</span>;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return <span>unknown</span>;
  return <span>{parsed.toLocaleString()}</span>;
}

function routeForText(value: string, fallback = "/services"): string {
  const text = value.toLowerCase();
  if (text.includes("cron") || text.includes("schedule")) return "/cron";
  if (text.includes("session") || text.includes("subagent")) return "/sessions";
  if (text.includes("task")) return "/task-board";
  if (text.includes("approval")) return "/approvals";
  if (text.includes("feedback") || text.includes("remediation")) return "/feedback";
  if (text.includes("trading") || text.includes("market") || text.includes("schwab") || text.includes("alpaca") || text.includes("polymarket")) return "/trading-ops";
  if (text.includes("memory")) return "/memories";
  if (text.includes("doc")) return "/docs";
  if (text.includes("gateway") || text.includes("browser") || text.includes("channel") || text.includes("runtime") || text.includes("service")) return "/services";
  return fallback;
}

function routeForHumanAction(item: HumanRequiredAction): string {
  const text = `${item.system} ${item.category} ${item.summary} ${item.requiredAction}`;
  if (/oauth|auth|token|login|whoop|schwab|service/i.test(text)) return "/services";
  return routeForText(text, "/task-board");
}

function routeForSource(source: AutonomyOpsArtifact["sources"][number]): string {
  return routeForText(`${source.key} ${source.label} ${source.detail ?? ""}`, "/services");
}

function ClickableMetric({
  href,
  icon,
  value,
  label,
}: {
  href: string;
  icon: ReactNode;
  value: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Open ${label}`}
    >
      <Card className="h-full transition group-hover:border-primary/45 group-hover:bg-accent/35">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <div className="text-2xl font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-70 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function ListBlock({ title, items, empty, href }: { title: string; items: string[]; empty: string; href: string }) {
  return (
    <Card id={title.toLowerCase().replaceAll(" ", "-")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-sm uppercase tracking-wide text-muted-foreground">
          <Link href={href} className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {title}
          </Link>
          <Link href={href} aria-label={`Open ${title}`} className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {items.length ? items.slice(0, 6).map((item) => (
          <Link
            key={item}
            href={routeForText(item, href)}
            className="group flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 outline-none transition hover:border-primary/45 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{item}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        )) : (
          <Link href={href} className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-muted-foreground outline-none transition hover:border-primary/45 hover:bg-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <span>{empty}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function AutonomyClient({ initialSnapshot, initialHumanActions, initialHumanActionsError }: AutonomyClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [humanActions, setHumanActions] = useState(initialHumanActions);
  const [humanActionsError, setHumanActionsError] = useState(initialHumanActionsError);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const data = snapshot.ok ? snapshot.data : null;
  const state = data?.operatorState ?? "attention";

  const refresh = () => {
    startTransition(async () => {
      setRefreshError(null);
      try {
        const [autonomyResponse, humanResponse] = await Promise.all([
          fetch("/api/autonomy-ops/refresh", { method: "POST", cache: "no-store" }),
          fetch("/api/human-required-actions", { cache: "no-store" }),
        ]);
        const autonomyPayload = (await autonomyResponse.json()) as RefreshResponse;
        const humanPayload = (await humanResponse.json()) as HumanActionsResponse;
        if (!autonomyResponse.ok && !autonomyPayload.ok) {
          setRefreshError(autonomyPayload.error ?? "Autonomy refresh failed.");
        }
        if ("ok" in autonomyPayload && (autonomyPayload.ok || !autonomyResponse.ok)) {
          setSnapshot(autonomyPayload);
        }
        if (humanPayload.ok) {
          setHumanActions(humanPayload.items);
          setHumanActionsError(null);
        } else {
          setHumanActions([]);
          setHumanActionsError(humanPayload.error ?? "Queue unavailable.");
        }
      } catch (error) {
        setRefreshError(error instanceof Error ? error.message : String(error));
      }
    });
  };

  const humanRequiredHref = useMemo(() => (
    humanActions[0] ? routeForHumanAction(humanActions[0]) : "/services"
  ), [humanActions]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Autonomy Ops</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Self-Management Posture</h1>
          <p className="text-sm text-muted-foreground">Operational links for bounded recovery, stale signals, and operator-required actions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/api/autonomy-ops" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="outline" className={tone[state]}>{state.toUpperCase()}</Badge>
          </Link>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={isPending}>
            <RefreshCcw className={isPending ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {!snapshot.ok ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader><CardTitle className="text-base">Autonomy artifact unavailable</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <div>{snapshot.error}</div>
            <div className="mt-3">
              <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={isPending}>
                <RefreshCcw className={isPending ? "animate-spin" : ""} />
                Retry refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {refreshError ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />Refresh failed: {refreshError}
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <ClickableMetric href="/feedback?source=system&remediationStatus=resolved&rangeHours=168" icon={<Activity className="h-5 w-5" />} value={data.counts.autoRemediated} label="Auto-fixed" />
            <ClickableMetric href="/approvals?status=pending&rangeHours=168" icon={<ShieldAlert className="h-5 w-5" />} value={data.counts.escalated} label="Escalated" />
            <ClickableMetric href={humanRequiredHref} icon={<AlertTriangle className="h-5 w-5" />} value={humanActions.length} label="Human-required" />
            <ClickableMetric href="#source-freshness" icon={<Clock3 className="h-5 w-5" />} value={<span className="text-sm font-medium"><TimeLabel iso={data.freshUntil} /></span>} label={snapshot.stale ? "Stale cache" : "Fresh until"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card id="human-required">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <Link href={humanRequiredHref} className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring">Human-Required Actions</Link>
                  <Link href={humanRequiredHref} aria-label="Open human-required action lane" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {humanActionsError ? (
                  <Link href="/services" className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground outline-none transition hover:border-primary/45 hover:bg-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Queue unavailable: {humanActionsError}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : humanActions.length ? humanActions.map((item) => (
                  <Link key={item.id} href={routeForHumanAction(item)} className="group block rounded-md border border-border p-3 outline-none transition hover:border-primary/45 hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.summary}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{item.requiredAction}</div>
                      </div>
                      <Badge variant="outline">{item.severity}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{item.system} · seen <TimeLabel iso={item.lastSeenAt} /></span>
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                  </Link>
                )) : (
                  <Link href="/services" className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground outline-none transition hover:border-primary/45 hover:bg-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />No open human-required actions.</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card id="source-freshness">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <Link href="/services" className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring">Source Freshness</Link>
                  <Link href="/services" aria-label="Open services health" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.sources.map((source) => (
                  <Link key={source.key} href={routeForSource(source)} className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm outline-none transition hover:border-primary/45 hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring">
                    <span>{source.label}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{source.status}</Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <ListBlock title="Auto-Fixed" items={data.sections.autoFixed} empty="No recent auto-fixes." href="/feedback?source=system&remediationStatus=resolved&rangeHours=168" />
            <ListBlock title="Degraded" items={data.sections.degraded} empty="No degraded autonomy lanes." href="/services" />
            <ListBlock title="Blocked" items={data.sections.blockers} empty="No active blockers." href="/task-board" />
          </div>
        </>
      ) : null}
    </div>
  );
}
