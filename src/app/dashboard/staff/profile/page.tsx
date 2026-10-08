"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/ui/toast";
import { SALES_REGION_OPTIONS } from "@/lib/salesRegions";
import { WAREHOUSE_OPTIONS } from "@/lib/warehouses";

type Person = { id: string; name: string; email?: string } | null;

type StaffProfile = {
  name: string;
  email: string;
  staff_username: string;
  designation: string;
  location: string;
  mobileNo: string;
  alternateNo: string;
  permanentAddress: string;
  localAddress: string;
  gender: string;
  dob: string;
  nationality: string;
  maritalStatus: string;
  qualification: string;
  emergencyContactNo1: string;
  emergencyContactNo2: string;
  role: string;
  staffRoleType: string;
  status: string;
  salesRegion: string;
  warehouse: string;
  parentRsm: Person;
  parentAsm: Person;
  rsms: NonNullable<Person>[];
  assignedStates: string[];
  assignedCities: string[];
};

// Mirrors the role labels on the admin staff form.
function roleLabel(role: string, staffRoleType: string) {
  if (role === "RSM" || role === "ASM" || role === "NSM") return role;
  if (staffRoleType === "2") return "Staff";
  if (staffRoleType === "1") return "Sales Manager";
  return role || "—";
}

const optionLabel = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label || value;

const personLabel = (person: Person) => (person ? `${person.name}${person.email ? ` (${person.email})` : ""}` : "");

function Field({ label, value, wide = false }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</span>
      <div className="min-h-[42px] whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900">
        {value || "—"}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

export default function StaffProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) { router.push("/auth/login"); return; }
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.message);
        setProfile(json.data as StaffProfile);
      })
      .catch(() => showToast("error", "Failed to load staff profile"))
      .finally(() => setIsLoading(false));
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading staff profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) return <div className="min-h-screen bg-gray-100 p-6 text-sm text-gray-500">Profile unavailable.</div>;

  const p = profile;
  const isRsm = p.role === "RSM";
  const isAsm = p.role === "ASM";
  const isFieldStaff = p.role === "STAFF" && p.staffRoleType === "2";
  const isSalesManager = p.role === "STAFF" && p.staffRoleType === "1";

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-[1840px]">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Staff Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Your account details. Contact an admin to change anything here.</p>
        </div>

        <div className="space-y-6 pb-6">
          <Section title="Personal Information">
            <Field label="Full Name" value={p.name} />
            <Field label="Designation" value={p.designation} />
            <Field label="Email" value={p.email} />
            <Field label="Location" value={p.location} />
            <Field label="Mobile No." value={p.mobileNo} />
            <Field label="Alternate Number" value={p.alternateNo} />
            <Field label="Gender" value={p.gender} />
            <Field label="Date of Birth" value={p.dob} />
            <Field label="Nationality" value={p.nationality} />
            <Field label="Marital Status" value={p.maritalStatus} />
            <Field label="Qualification" value={p.qualification} />
            <Field label="Emergency Contact No. 1" value={p.emergencyContactNo1} />
            <Field label="Emergency Contact No. 2" value={p.emergencyContactNo2} />
            <Field label="Permanent Address" value={p.permanentAddress} />
            <Field label="Local Address" value={p.localAddress} />
          </Section>

          <Section title="Account Settings">
            <Field label="Username" value={p.staff_username} />
            <Field label="Status" value={p.status === "ACTIVE" ? "Active" : "Inactive"} />
            <Field label="Role" value={roleLabel(p.role, p.staffRoleType)} />
            {isRsm && <Field label="Region" value={optionLabel(SALES_REGION_OPTIONS, p.salesRegion)} />}
            {isFieldStaff && <Field label="Warehouse" value={optionLabel(WAREHOUSE_OPTIONS, p.warehouse)} />}
            {isFieldStaff && <Field label="RSMs" value={p.rsms.map(personLabel).join("\n")} wide />}
            {isAsm && <Field label="RSM" value={personLabel(p.parentRsm)} />}
            {isSalesManager && <Field label="ASM" value={personLabel(p.parentAsm)} />}
            {(isRsm || isAsm) && <Field label="States" value={p.assignedStates.join(", ")} wide />}
            {isSalesManager && <Field label="Cities" value={p.assignedCities.join(", ")} wide />}
          </Section>
        </div>
      </div>
    </div>
  );
}
