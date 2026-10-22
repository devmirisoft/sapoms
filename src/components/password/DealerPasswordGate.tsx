"use client";

import { useMemo, useState } from "react";
import DealerPasswordModal from "@/components/password/DealerPasswordModal";
import { useAuthSession } from "@/hooks/useAuthSession";
import { refreshCurrentUser } from "@/lib/currentUser";

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
  // A dealer with the T&C switched off has no terms modal to wait for.
  const termsDone = isSet(dealer?.termsAcceptedAt) || dealer?.termsActive === false;
  const shouldShow = Boolean(dealer?.Dealer_Id) && termsDone && !isSet(updatedAt ?? dealer?.passwordUpdatedAt);

  if (!shouldShow) return null;

  return (
    <DealerPasswordModal
      userName={String(dealer?.Dealer_Name ?? "Dealer")}
      onChanged={(nextUpdatedAt) => {
        setUpdatedAt(nextUpdatedAt);
        void refreshCurrentUser();
      }}
    />
  );
}
