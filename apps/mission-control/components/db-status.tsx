"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

type Status = { postgres: boolean; lancedb: boolean };

export function DbStatus() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/db-status", { cache: "no-store" });
        if (res.ok) setStatus(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 45_000);
    return () => clearInterval(id);
  }, []);

  const pg = status?.postgres ?? null;
  const lance = status?.lancedb ?? null;

  return (
    <div className="flex h-full flex-col justify-center gap-1.5 rounded-lg border bg-card/60 px-3 py-2 shadow-sm">
      <Badge variant={pg === null ? "outline" : pg ? "secondary" : "destructive"}>
        {pg === null ? "…" : pg ? "●" : "✖"} Postgres
      </Badge>
      <Badge variant={lance === null ? "outline" : lance ? "secondary" : "destructive"}>
        {lance === null ? "…" : lance ? "●" : "✖"} Vector DB
      </Badge>
    </div>
  );
}
