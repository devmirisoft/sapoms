"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { showToast } from "@/components/ui/toast";

type StaffSession = {
  staff_id?: string;
  staff_name?: string;
  staff_designation?: string;
  staff_location?: string;
  sales_region?: string;
  salesRegion?: string;
  staff_password?: string;
  staff_email?: string;
  staff_roletype?: string;
  image?: string;
  name?: string;
  staff_image?: string;
};

function formatSalesRegion(value?: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return "";
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

function readStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
        <span className="ml-0.5 text-orange-500">*</span>
      </label>
      <input
        required={!readOnly}
        readOnly={readOnly}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 ${readOnly ? "bg-gray-50" : "bg-white"}`}
      />
    </div>
  );
}

export default function StaffProfilePage() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [location, setLocation] = useState("");
  const [salesRegion, setSalesRegion] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const session = readStaffSession();
    const id = String(session?.staff_id || "");
    if (!id) {
      router.push("/auth/login");
      return;
    }
    setStaffId(id);

    const loadStaff = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/staff/profile", { cache: "no-store" });
        const json = await response.json();
        const data = json.data || session || {};
        setName(data.staff_name || "");
        setDesignation(data.staff_designation || "");
        setLocation(data.staff_location || "");
        setSalesRegion(data.sales_region || data.salesRegion || "");
        setPassword(data.staff_password || "");
      } catch {
        showToast("error", "Failed to load staff profile");
      } finally {
        setIsLoading(false);
      }
    };

    loadStaff();
  }, [router]);


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!staffId) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_name: name, staff_designation: designation, staff_location: location, staff_password: password }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Update failed");
      const previous = readStaffSession() || {};
      const payloadData = payload?.data || {};
      const updated = {
        ...previous,
        ...payloadData,
        staff_id: staffId,
        staff_name: name,
        staff_designation: designation,
        staff_location: location,
        sales_region: payloadData.sales_region || payloadData.salesRegion || previous.sales_region || previous.salesRegion || "",
        salesRegion: payloadData.salesRegion || payloadData.sales_region || previous.salesRegion || previous.sales_region || "",
        staff_password: password,
        name: payloadData.name || previous.name || name,
        image: payloadData.image || previous.image || undefined,
      };
      localStorage.setItem("status", "true");
      localStorage.setItem("UserData", JSON.stringify(updated));
      localStorage.setItem("staffData", JSON.stringify(updated));
      localStorage.setItem("roletype", String(updated.staff_roletype || previous.staff_roletype || "1"));
      showToast("success", payload?.msg || "Staff profile updated");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      showToast("error", "Failed to update staff profile");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading staff profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">

      <div className="mx-auto max-w-[1840px]">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Staff Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Update your staff account details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Staff Details
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Designation" value={designation} onChange={setDesignation} />
              <Field label="Location" value={location} onChange={setLocation} />
              {String((readStaffSession()?.staff_roletype ?? "")).toUpperCase() === "RSM" && (
                <Field label="RSM Region" value={formatSalesRegion(salesRegion)} onChange={() => {}} readOnly />
              )}
              <Field label="Password" value={password} onChange={setPassword} type="password" />
            </div>
          </section>

          <div className="flex justify-end gap-3 pb-6">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
