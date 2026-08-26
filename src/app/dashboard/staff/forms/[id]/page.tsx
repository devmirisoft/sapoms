"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Form, { Submission } from "@/components/Form";

export default function StaffFormEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/forms/${id}`, { credentials: "include", cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load form");
        if (!cancelled) setSubmission(json.data as Submission);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (loading || !submission) return <div className="p-6 text-sm text-gray-500">Loading form...</div>;

  return (
    <div>
      <div className="px-6 pt-6">
        <Link href="/dashboard/staff/forms" className="text-sm font-semibold text-[#12508C]">
          &larr; Back to Forms
        </Link>
      </div>
      <Form submission={submission} mode="edit" role="staff" />
    </div>
  );
}
