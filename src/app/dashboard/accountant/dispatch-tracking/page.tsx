import { Suspense } from "react";
import DispatchTrackingDashboard from "@/components/dashboard/DispatchTrackingDashboard";

export default function AccountantDispatchTrackingPage() {
  // The dashboard reads ?tab=, and useSearchParams needs a Suspense boundary.
  return (
    <Suspense>
      <DispatchTrackingDashboard />
    </Suspense>
  );
}
