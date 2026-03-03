"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type SloPayload = {
  generatedAt: string;
  windowHours: number;
  metrics: {
    cronOnTimePct: number;
    abortedRunRatePct: number;
    deliverySuccessPct: number;
    p95ResponseMs: number;
    api429RateByProvider: Array<{ provider: string; ratePct: number; total: number; count429: number }>;
    samples: {
      cronJobs: number;
      terminalRuns: number;
      deliveryRequiredJobs: number;
      responseSamples: number;
      providerSamples: number;
    };
  };
};

const POLL_MS = 60_000;

const formatMs = (value: number) => `${Math.round(value)} ms`;

export function ReliabilitySloCard() {
  const [data, setData] = useState<SloPayload | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reliability-slo", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const payload = (await res.json()) as SloPayload;
      setData(payload);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const metrics = data?.metrics;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          Reliability SLOs
          <Badge variant="outline">rolling {data?.windowHours ?? 24}h</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Cron on-time" value={`${metrics?.cronOnTimePct ?? 0}%`} sample={`n=${metrics?.samples.cronJobs ?? 0}`} />
          <Metric
            label="Aborted run rate"
            value={`${metrics?.abortedRunRatePct ?? 0}%`}
            sample={`n=${metrics?.samples.terminalRuns ?? 0}`}
          />
          <Metric
            label="Delivery success"
            value={`${metrics?.deliverySuccessPct ?? 0}%`}
            sample={`n=${metrics?.samples.deliveryRequiredJobs ?? 0}`}
          />
          <Metric
            label="P95 response"
            value={formatMs(metrics?.p95ResponseMs ?? 0)}
            sample={`n=${metrics?.samples.responseSamples ?? 0}`}
          />
          <Metric
            label="API 429 rate"
            value={`${metrics?.api429RateByProvider?.[0]?.ratePct ?? 0}%`}
            sample={metrics?.api429RateByProvider?.[0] ? metrics.api429RateByProvider[0].provider : "no provider data"}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">429 by provider</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(metrics?.api429RateByProvider || []).slice(0, 4).map((item) => (
              <div key={item.provider} className="rounded-md border border-border/70 bg-card/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium capitalize">{item.provider}</span>
                  <span className="font-mono">{item.ratePct}%</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.count429} / {item.total} runs</p>
              </div>
            ))}
            {(metrics?.api429RateByProvider || []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No provider telemetry in window.</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : "Loading..."}</span>
        </div>

        {error ? <p className="text-xs text-amber-400">Reliability SLOs unavailable. Retrying…</p> : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, sample }: { label: string; value: string; sample: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sample}</p>
    </div>
  );
}
