"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type AutoRefreshProps = {
  intervalMs?: number;
};

export function AutoRefresh({ intervalMs = 15000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, router]);

  return null;
}
