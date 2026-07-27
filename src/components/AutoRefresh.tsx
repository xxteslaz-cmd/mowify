"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current without a manual reload.
 *
 * Server Actions only revalidate for the client that invoked them, so a crew
 * completing a stop on their phone leaves an open dashboard stale. Polling
 * `router.refresh()` closes that gap.
 *
 * Hidden tabs are skipped so backgrounded phones don't poll on battery, and a
 * tab returning to the foreground refreshes at once instead of waiting a tick.
 */
export default function AutoRefresh({
  intervalMs = 10_000,
  paused = false,
}: {
  intervalMs?: number;
  paused?: boolean;
}) {
  const router = useRouter();

  // Held in a ref so toggling `paused` mid-drag doesn't tear down and restart
  // the interval on every render.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    function refreshIfIdle() {
      if (pausedRef.current) return;
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }

    const timer = setInterval(refreshIfIdle, intervalMs);
    const onWake = () => refreshIfIdle();

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [router, intervalMs]);

  return null;
}
