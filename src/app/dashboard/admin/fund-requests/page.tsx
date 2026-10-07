"use client";

import FundRequestQueue from "@/components/fund-requests/FundRequestQueue";

// The NSM (or Admin with no active NSM) approves the RSM stage of requests whose
// RSM is unavailable; the API decides which those are (the "mine" tab).
export default function AdminFundRequestsPage() {
  return <FundRequestQueue
      stage="rsm"
      backHref="/dashboard/admin"
      notice="Requests in your queue have no available RSM — you approve them on the RSM's behalf."
    />;
}
