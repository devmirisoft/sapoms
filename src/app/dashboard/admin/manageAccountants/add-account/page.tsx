"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UserPlus, Pencil, Trash2, X, Check, Eye, EyeOff,
  Users, Mail, Phone, ShieldCheck, Loader2, RefreshCw,
} from "lucide-react";
import { showToast } from "@/components/ui/toast";

// ─── Types ───────────────────────────────────────────────────────────────────
type Accountant = {
  _id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
};

type FormState = {
  name: string;
  email: string;
  password: string;
  phone: string;
};

const EMPTY: FormState = { name: "", email: "", password: "", phone: "" };

// ─── API helpers (plain fetch — no accountant token needed for admin) ─────────
async function apiFetch(path: string, init?: RequestInit) {
  const res  = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || `Request failed (${res.status})`);
  return json;
}

const api = {
  list:   ()                              => apiFetch("/admin/accountants"),
  create: (body: FormState)              => apiFetch("/admin/accountants", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<FormState>) => apiFetch(`/admin/accountants/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: string)                   => apiFetch(`/admin/accountants/${id}`, { method: "DELETE" }),
};

// ─── Toast ───────────────────────────────────────────────────────────────────

// ─── Field ───────────────────────────────────────────────────────────────────
function Field({
  id, label, type = "text", value, onChange, error, placeholder, suffix, disabled,
}: {
  id: string; label: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string; placeholder?: string; suffix?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id} type={type} value={value} onChange={onChange}
          placeholder={placeholder} disabled={disabled}
          className={`w-full px-3.5 py-2.5 text-[13px] text-gray-900 border rounded-xl outline-none transition-all
            placeholder:text-gray-300 disabled:opacity-60 bg-white
            ${error
              ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100"
              : "border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            } ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</span>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function AccountantModal({
  mode, initial, onSubmit, onClose, busy,
}: {
  mode: "create" | "edit";
  initial?: Partial<FormState>;
  onSubmit: (data: FormState) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [form,   setForm]   = useState<FormState>({ ...EMPTY, ...initial });
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }));
    setErrors(er => ({ ...er, [key]: "" }));
  };

  const validate = (): boolean => {
    const e: Partial<FormState> = {};
    if (!form.name.trim())  e.name  = "Name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (mode === "create") {
      if (!form.password)          e.password = "Password is required";
      else if (form.password.length < 6) e.password = "Min 6 characters";
    }
    if (!form.phone.trim()) e.phone = "Phone is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              {mode === "create"
                ? <UserPlus size={15} className="text-indigo-600"/>
                : <Pencil   size={15} className="text-indigo-600"/>}
            </div>
            <div>
              <h2 className="text-[14.5px] font-bold text-gray-900">
                {mode === "create" ? "Add Accountant" : "Edit Accountant"}
              </h2>
              <p className="text-[11.5px] text-gray-400 mt-0.5">
                {mode === "create" ? "Create a new accountant account" : "Update account details"}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-40">
            <X size={15}/>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <Field id="name" label="Full Name" value={form.name} onChange={set("name")}
            error={errors.name} placeholder="e.g. Priya Sharma" disabled={busy} />

          <Field id="email" label="Email" type="email" value={form.email} onChange={set("email")}
            error={errors.email} placeholder="accountant@omsons.com" disabled={busy} />

          <Field
            id="password"
            label={mode === "create" ? "Password" : "New Password (leave blank to keep)"}
            type={showPw ? "text" : "password"}
            value={form.password} onChange={set("password")}
            error={errors.password}
            placeholder={mode === "create" ? "Min 6 characters" : "Leave blank to keep current"}
            disabled={busy}
            suffix={
              <button type="button" tabIndex={-1} onClick={() => setShowPw(v => !v)}
                className="text-gray-400 hover:text-gray-600 transition-colors">
                {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            }
          />

          <Field id="phone" label="Phone" type="tel" value={form.phone} onChange={set("phone")}
            error={errors.phone} placeholder="+91 98765 43210" disabled={busy} />

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13px] font-semibold disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {busy
                ? <><Loader2 size={13} className="animate-spin"/> Saving…</>
                : <><Check size={13}/> {mode === "create" ? "Create Account" : "Save Changes"}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm Delete ───────────────────────────────────────────────────────────
function ConfirmDelete({ name, onConfirm, onClose, loading }: {
  name: string; onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-4">
          <Trash2 size={16} className="text-red-500"/>
        </div>
        <h3 className="text-[15px] font-bold text-gray-900">Delete accountant?</h3>
        <p className="text-[13px] text-gray-500 mt-1.5">
          <span className="font-semibold text-gray-700">{name}</span> will be permanently removed.
        </p>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[13px] font-semibold disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {loading ? <Loader2 size={13} className="animate-spin"/> : <Trash2 size={13}/>}
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ManageAccountantsPage() {
  const [accountants, setAccountants] = useState<Accountant[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [modal,       setModal]       = useState<"create" | "edit" | null>(null);
  const [editing,     setEditing]     = useState<Accountant | null>(null);
  const [deleting,    setDeleting]    = useState<Accountant | null>(null);
  const [busy,        setBusy]        = useState(false);


  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const json = await api.list();
      setAccountants(json.data ?? []);
    } catch (e: any) {
      showToast("error", e.message || "Failed to load accountants");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form: FormState) => {
    setBusy(true);
    try {
      await api.create(form);
      showToast("success", "Accountant created");
      setModal(null);
      load(true);
    } catch (e: any) {
      showToast("error", e.message || "Failed to create accountant");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (form: FormState) => {
    if (!editing) return;
    setBusy(true);
    try {
      const payload: Partial<FormState> = {
        name: form.name, email: form.email, phone: form.phone,
      };
      if (form.password) payload.password = form.password;
      await api.update(editing._id, payload);
      showToast("success", "Accountant updated");
      setModal(null);
      setEditing(null);
      load(true);
    } catch (e: any) {
      showToast("error", e.message || "Failed to update accountant");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.remove(deleting._id);
      showToast("success", `${deleting.name} deleted`);
      setDeleting(null);
      load(true);
    } catch (e: any) {
      showToast("error", e.message || "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 py-6 admin-page-shell" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Users size={15} className="text-white"/>
            </div>
            Manage Accountants
          </h1>
          <p className="text-[13px] text-gray-400 mt-1">Create and manage accountant access for the finance portal</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)} disabled={refreshing}
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""}/>
          </button>
          <button
            onClick={() => setModal("create")}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            <UserPlus size={14}/> Add Accountant
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-[12.5px] text-gray-600">
          <Users size={13} className="text-indigo-500"/>
          <span>Total: <strong className="text-gray-900">{accountants.length}</strong></span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[12.5px] text-emerald-700">
          <ShieldCheck size={13}/>
          <span>Active: <strong>{accountants.length}</strong></span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <Loader2 size={24} className="animate-spin text-indigo-400"/>
            <span className="text-[13px]">Loading accountants…</span>
          </div>
        ) : accountants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Users size={24} className="text-gray-300"/>
            </div>
            <p className="text-[13px] text-gray-400 font-medium">No accountants yet</p>
            <button
              onClick={() => setModal("create")}
              className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold rounded-xl transition-colors"
            >
              <UserPlus size={13}/> Add first accountant
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["#", "Name", "Email", "Phone", "Role", "Created", "Actions"].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {accountants.map((a, idx) => (
                  <tr key={a._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-[12px] text-gray-400 font-mono">{String(idx + 1).padStart(2, "0")}</td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
                          {(a.name ?? "AC").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                        </div>
                        <span className="text-[13px] font-semibold text-gray-900">{a.name}</span>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-[12.5px] text-gray-600">
                        <Mail size={11} className="text-gray-300 flex-shrink-0"/>
                        {a.email}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-[12.5px] text-gray-600">
                        <Phone size={11} className="text-gray-300 flex-shrink-0"/>
                        {a.phone || "—"}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                        <ShieldCheck size={10}/>
                        {a.role || "accountant"}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-[12px] text-gray-400 font-mono whitespace-nowrap">
                      {a.createdAt
                        ? new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => { setEditing(a); setModal("edit"); }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg transition-all shadow-sm"
                        >
                          <Pencil size={11}/> Edit
                        </button>
                        <button
                          onClick={() => setDeleting(a)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-lg transition-all shadow-sm"
                        >
                          <Trash2 size={11}/> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === "create" && (
        <AccountantModal
          mode="create"
          onSubmit={handleCreate}
          onClose={() => setModal(null)}
          busy={busy}
        />
      )}

      {modal === "edit" && editing && (
        <AccountantModal
          mode="edit"
          initial={{ name: editing.name, email: editing.email, phone: editing.phone, password: "" }}
          onSubmit={handleUpdate}
          onClose={() => { setModal(null); setEditing(null); }}
          busy={busy}
        />
      )}

      {deleting && (
        <ConfirmDelete
          name={deleting.name}
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
          loading={busy}
        />
      )}

    </div>
  );
}

