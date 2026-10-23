"use client";

import { useMemo, useState } from "react";
import DealerPasswordModal from "@/components/password/DealerPasswordModal";
import { useAuthSession } from "@/hooks/useAuthSession";
import { refreshCurrentUser } from "@/lib/currentUser";

function isSet(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

// Dealers and staff both get the forced first-login password popup.
export default function DealerPasswordGate() {
  const auth = useAuthSession();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const user = useMemo(() => {
    if (auth.loading || auth.session.status !== "authenticated") return null;
    if (auth.session.role !== "dealer" && auth.session.role !== "staff") return null;
    return auth.session.user;
  }, [auth]);

  // Terms first: both gates are siblings in the root layout, so the ordering has
  // to be explicit - this one stays hidden until the terms modal is done.
  // updatedAt closes the modal immediately on success, before the session refetch lands.
  // A dealer with the T&C switched off has no terms modal to wait for, and staff have none at all.
  const termsDone = user?.role !== "dealer" || isSet(user?.termsAcceptedAt) || user?.termsActive === false;
  const shouldShow = Boolean(user) && termsDone && !isSet(updatedAt ?? user?.passwordUpdatedAt);

  if (!shouldShow) return null;

  return (
    <DealerPasswordModal
      userName={String(user?.Dealer_Name ?? user?.staff_name ?? "User")}
      onChanged={(nextUpdatedAt) => {
        setUpdatedAt(nextUpdatedAt);
        void refreshCurrentUser();
      }}
    />
  );
}
