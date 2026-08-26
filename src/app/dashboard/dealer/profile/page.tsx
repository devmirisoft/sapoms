"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, Save, Upload, Users } from "lucide-react";
import { staffRoleBadge } from "@/lib/staffRoleLabel";

type DealerSession = {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_City?: string;
  Dealer_Address?: string;
  Dealer_Pincode?: string;
  Dealer_Password?: string;
  Dealer_Image?: string;
  image?: string;
  name?: string;
  email?: string;
};

type DealerContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  role: string;
  roleKey: string;
  roleLabel: string;
  salesRegion: string;
};

function readDealerSession(): DealerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("UserData") || localStorage.getItem("user");
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
        <span className="ml-0.5 text-orange-500">*</span>
      </label>
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

export default function DealerProfilePage() {
  const router = useRouter();
  const [dealerId, setDealerId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [number, setNumber] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [password, setPassword] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [contacts, setContacts] = useState<DealerContact[]>([]);

  useEffect(() => {
    const session = readDealerSession();
    const id = String(session?.Dealer_Id || "");
    if (!id) {
      router.push("/auth/login");
      return;
    }
    setDealerId(id);

    const loadDealer = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/dealer/profile", { cache: "no-store" });
        const json = await response.json();
        const data = json.data || session || {};
        setName(data.Dealer_Name || "");
        setEmail(data.Dealer_Email || "");
        setNumber(data.Dealer_Number || "");
        setCity(data.Dealer_City || "");
        setAddress(data.Dealer_Address || "");
        setPincode(data.Dealer_Pincode || "");
        setPassword(data.Dealer_Password || "");
        // Assigned staff first, then the ASM and RSM they roll up to; the API
        // already excludes anyone listed twice across those three fields.
        const team: DealerContact[] = [
          ...(Array.isArray(data.assignedStaff) ? data.assignedStaff : []),
          ...(data.asm ? [data.asm] : []),
          ...(data.rsm ? [data.rsm] : []),
        ];
        const seen = new Set<string>();
        setContacts(team.filter((entry) => entry?.id && !seen.has(entry.id) && seen.add(entry.id)));
      } catch {
        setToast({ text: "Failed to load dealer profile", type: "error" });
      } finally {
        setIsLoading(false);
      }
    };

    loadDealer();
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dealerId) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/dealer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Dealer_Name: name, Dealer_Email: email, Dealer_Number: number, Dealer_City: city, Dealer_Address: address, Dealer_Pincode: pincode, Dealer_Password: password }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Update failed");
      const previous = readDealerSession() || {};
      const payloadData = payload?.data || {};
      const updated = {
        ...previous,
        ...payloadData,
        Dealer_Id: dealerId,
        Dealer_Name: name,
        Dealer_Email: email,
        Dealer_Number: number,
        Dealer_City: city,
        Dealer_Address: address,
        Dealer_Pincode: pincode,
        Dealer_Password: password,
        name: payloadData.name || previous.name || name,
        email: payloadData.email || previous.email || email,
        image: payloadData.Dealer_Image || payloadData.image || previous.image || undefined,
      };
      localStorage.setItem("status", "true");
      localStorage.setItem("UserData", JSON.stringify(updated));
      localStorage.setItem("roletype", "2");
      setToast({ text: payload?.msg || "Dealer profile updated", type: "success" });
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setToast({ text: "Failed to update dealer profile", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dealer profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {toast && (
        <div className={`fixed right-5 top-5 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-500 text-white"}`}>
          {toast.text}
        </div>
      )}

      <div className="mx-auto max-w-[1840px]">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dealer Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Update your dealer account and contact details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Dealer Details
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="WhatsApp Number" value={number} onChange={setNumber} type="tel" />
              <Field label="City" value={city} onChange={setCity} />
              <Field label="Address" value={address} onChange={setAddress} />
              <Field label="Pin Code" value={pincode} onChange={setPincode} type="number" />
              <Field label="Password" value={password} onChange={setPassword} type="password" />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 flex items-center gap-2 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              <Users className="h-4 w-4 text-gray-400" />
              Your Sales Team
            </h2>
            {contacts.length === 0 ? (
              <p className="text-sm text-gray-500">No staff has been assigned to your account yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {contacts.map((contact) => {
                  const badge = staffRoleBadge(contact);
                  return (
                    <div key={contact.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{contact.name || "-"}</p>
                          {contact.designation && (
                            <p className="mt-0.5 truncate text-xs text-gray-500">{contact.designation}</p>
                          )}
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="flex items-center gap-2 hover:text-indigo-600">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="truncate">{contact.email}</span>
                          </a>
                        )}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`} className="flex items-center gap-2 hover:text-indigo-600">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="truncate">{contact.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
