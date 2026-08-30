"use client";

import { useEffect, useState } from "react";
import FundRequestQueue from "@/components/fund-requests/FundRequestQueue";

/**
 * One route for both approval stages.
 *
 * RSM and Staff share the `staff` app role, so the stage comes from the real
 * server role. This only picks the wording and which requests are actionable
 * on screen - the API independently decides what each actor may see and do.
 */
export default function StaffFundRequestsPage() {
  const [stage, setStage] = useState<"rsm" | "staff" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        setStage(String(json?.data?.role ?? "").toLowerCase() === "rsm" ? "rsm" : "staff");
      })
      .catch(() => {
        if (!cancelled) setStage("staff");
      });
    return () => { cancelled = true; };
  }, []);

  if (!stage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Loading fund requests...
      </div>
    );
  }

  return <FundRequestQueue stage={stage} backHref="/dashboard/staff" />;
}
