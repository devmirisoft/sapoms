"use client";

import { useMemo, useState } from "react";
import DealerPasswordModal from "@/components/password/DealerPasswordModal";
import { useAuthSession } from "@/hooks/useAuthSession";

function isSet(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export default function DealerPasswordGate() {
  const auth = useAuthSession();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const dealer = useMemo(() => {
    if (auth.loading || auth.session.status !== "authenticated" || auth.session.role !== "dealer") return null;
    return auth.session.user;
  }, [auth]);

  // Terms first: both gates are siblings in the root layout, so the ordering has
  // to be explicit - this one stays hidden until the terms modal is done.
  // updatedAt closes the modal immediately on success, before the session refetch lands.
  const shouldShow =
    Boolean(dealer?.Dealer_Id) && isSet(dealer?.termsAcceptedAt) && !isSet(updatedAt ?? dealer?.passwordUpdatedAt);

  if (!shouldShow) return null;

  return (
    <DealerPasswordModal
      userName={String(dealer?.Dealer_Name ?? "Dealer")}
      onChanged={(nextUpdatedAt) => {
        setUpdatedAt(nextUpdatedAt);

        try {
          const raw = localStorage.getItem("UserData");
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            parsed.passwordUpdatedAt = nextUpdatedAt;
            localStorage.setItem("UserData", JSON.stringify(parsed));
            window.dispatchEvent(new Event("omsons-auth-changed"));
          }
        } catch {}
      }}
    />
  );
}
