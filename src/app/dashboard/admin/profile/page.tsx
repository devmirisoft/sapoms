"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Save, Upload } from "lucide-react";
import { showToast } from "@/components/ui/toast";

const ADMIN_PROFILE_URL = "/api/admin/profile";

type AdminSession = {
  ADMIN_ID?: string;
  ADMIN_NAME?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PHONE?: string;
  id?: string;
  admin_id?: string;
  name?: string;
  email?: string;
  ADMIN_IMAGE?: string;
  image?: string;
};

function readAdminSession(): AdminSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem("UserData") ||
      localStorage.getItem("AdminData") ||
      localStorage.getItem("admin");
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
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-orange-500">*</span>}
      </label>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

export default function AdminProfilePage() {
  const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState<File | null>(null);

  useEffect(() => {
    const admin = readAdminSession();

    const loadAdmin = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(ADMIN_PROFILE_URL, { credentials: "include" });
        const json = await response.json();
        // Prefer session/localStorage values first so recent client-side updates show immediately
        const data = admin || json.data || {};
        setName(data.ADMIN_NAME || data.name || "");
        setPhone(data.ADMIN_PHONE || "");
        setEmail(data.ADMIN_EMAIL || data.email || "");
      } catch {
        showToast("error", "Failed to load admin profile");
      } finally {
        setIsLoading(false);
      }
    };

    loadAdmin();
  }, [router]);


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await axios.patch(ADMIN_PROFILE_URL, { name, email, phone }, { withCredentials: true });
      const payload = response.data || {};
      const previous = readAdminSession() || {};
      const payloadData = payload?.data || {};

      const updated = {
        ...previous,
        ...payloadData,

        ADMIN_NAME: name,
        ADMIN_EMAIL: email,
        ADMIN_PHONE: phone,

        name: payloadData.name || previous.name || name,
        email: payloadData.email || previous.email || email,
        image: payloadData.ADMIN_IMAGE || payloadData.image || previous.image || previous.ADMIN_IMAGE || undefined,
      };

      localStorage.setItem("status", "true");
      localStorage.setItem("UserData", JSON.stringify(updated));
      localStorage.setItem("AdminData", JSON.stringify(updated));
      localStorage.setItem("roletype", "3");
      showToast("success", payload?.msg || "Admin profile updated");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      showToast("error", "Failed to update admin profile");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading admin profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">

      <div className="admin-page-shell">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Update your administrator account details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Account Details
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="Phone Number" value={phone} onChange={setPhone} type="tel" />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Profile Image
            </h2>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600 hover:border-indigo-300 hover:bg-indigo-50">
              <span className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {image ? image.name : "Choose image"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => setImage(event.target.files?.[0] || null)} />
            </label>
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
