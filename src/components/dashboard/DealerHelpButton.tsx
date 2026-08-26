"use client";

/**
 * Dealer help: the people appointed to this dealer, with a way to reach them.
 *
 * Contacts come from /api/dealer/profile, which resolves the dealer's actively
 * assigned staff plus the ASM and RSM they roll up to. The endpoint is
 * dealer-only, so this button is rendered only for the dealer role and fetches
 * lazily on first open rather than on every dashboard load.
 */

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, Mail, Phone, X } from "lucide-react";

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roleLabel: string;
  designation: string;
};

type ContactsPayload = {
  staff?: Contact[];
  asm?: Contact | null;
  rsm?: Contact | null;
};

function contactList(contacts: ContactsPayload | null): Array<Contact & { tier: string }> {
  if (!contacts) return [];
  const seen = new Set<string>();
  const rows: Array<Contact & { tier: string }> = [];
  const push = (contact: Contact | null | undefined, tier: string) => {
    if (!contact?.id || seen.has(contact.id)) return;
    // Somebody with neither an email nor a phone cannot be contacted, which is
    // the entire point of this panel.
    if (!contact.email && !contact.phone) return;
    seen.add(contact.id);
    rows.push({ ...contact, tier });
  };
  (contacts.staff ?? []).forEach((entry) => push(entry, "Your representative"));
  push(contacts.asm, "Area manager");
  push(contacts.rsm, "Regional manager");
  return rows;
}

export default function DealerHelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactsPayload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/dealer/profile", { credentials: "include" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || "Failed to load contacts");
      const data = payload.data ?? {};
      setContacts({ staff: data.assignedStaff ?? [], asm: data.asm ?? null, rsm: data.rsm ?? null });
      setState("idle");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (open && !contacts && state !== "loading") void load();
  }, [open, contacts, state, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const rows = contactList(contacts);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        title="Need help? Contact your representative"
        aria-label="Need help? Contact your representative"
      >
        <HelpCircle size={14} />
        <span>Help</span>
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "80px 16px 16px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your contacts"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-950">Need help?</p>
                <p className="text-[12px] text-gray-500">Reach the team appointed to your account.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-900"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {state === "loading" && (
                <p className="px-4 py-6 text-center text-[13px] text-gray-500">Loading contacts...</p>
              )}
              {state === "error" && (
                <div className="px-4 py-6 text-center">
                  <p className="text-[13px] text-gray-600">We could not load your contacts.</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-2 rounded-md bg-gray-950 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-800"
                  >
                    Try again
                  </button>
                </div>
              )}
              {state === "idle" && rows.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-gray-500">
                  No representative is listed for your account yet.
                </p>
              )}

              {state === "idle" && rows.map((contact) => (
                <div key={contact.id} className="border-b border-gray-50 px-4 py-3 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-gray-950">{contact.name || "Unnamed"}</p>
                    <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                      {contact.roleLabel || contact.designation || contact.tier}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">{contact.tier}</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex items-center gap-2 text-[13px] text-gray-700 transition hover:text-indigo-700"
                      >
                        <Phone size={13} className="flex-shrink-0 text-gray-400" />
                        <span className="font-mono">{contact.phone}</span>
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-2 text-[13px] text-gray-700 transition hover:text-indigo-700"
                      >
                        <Mail size={13} className="flex-shrink-0 text-gray-400" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
