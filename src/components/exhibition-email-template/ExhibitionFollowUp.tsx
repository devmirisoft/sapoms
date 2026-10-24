"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import {
  EXHIBITION_NAME_LIMIT,
  LOGO_PATH,
  SUBJECT_LIMIT,
  defaultSubject,
  firstNameOf,
  isValidEmail,
  oneLine,
  renderExhibitionEmail,
} from "./template";

const PLACEHOLDER = "[Exhibition Name]";

type Contact = { name: string; email: string };
type Sent = { to: string; deliveredTo: string; messageId: string; acceptedAt: string };

export default function ExhibitionFollowUp({ formId }: { formId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#12508C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0e406f]"
      >
        <Mail className="h-4 w-4" /> Send exhibition follow-up
      </button>
      {open && <FollowUpModal formId={formId} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowUpModal({ formId, onClose }: { formId: string; onClose: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loadError, setLoadError] = useState("");
  const [exhibitionName, setExhibitionName] = useState("");
  const [subject, setSubject] = useState<string | null>(null); // null follows the exhibition name
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const inFlight = useRef(false);

  // Re-read the lead: the page holds the version it first loaded, the server sends to the saved one.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/forms/${formId}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load contact");
        const details = json.data.customerDetails ?? {};
        if (!cancelled) setContact({ name: String(details.contactPerson ?? "").trim(), email: String(details.email ?? "").trim() });
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Failed to load contact"));
    return () => {
      cancelled = true;
    };
  }, [formId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !inFlight.current && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = oneLine(exhibitionName, EXHIBITION_NAME_LIMIT);
  const finalSubject = subject ?? defaultSubject(name || PLACEHOLDER);
  const emailOk = contact ? isValidEmail(contact.email) : false;
  const nameError = touched && !name ? "Exhibition name is required." : "";
  const subjectError = !oneLine(finalSubject, SUBJECT_LIMIT)
    ? "Subject is required."
    : finalSubject.includes(PLACEHOLDER)
      ? `Replace ${PLACEHOLDER} in the subject.`
      : "";
  const preview = useMemo(
    () => renderExhibitionEmail({ firstName: firstNameOf(contact?.name), exhibitionName: name || PLACEHOLDER, logoSrc: LOGO_PATH }).html,
    [contact?.name, name],
  );

  async function send() {
    setTouched(true);
    if (inFlight.current || sent || !emailOk || !name || subjectError) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      let res: Response;
      try {
        res = await fetch(`/api/forms/${formId}/exhibition-email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exhibitionName: name, subject: finalSubject }),
        });
      } catch {
        throw new Error("No reply from the server, so the email may or may not have gone out. Check the audit log before sending again.");
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `Sending failed (HTTP ${res.status}).`);
      setSent(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const input = "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#12508C] focus:ring-2 focus:ring-[#12508C]/20";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !inFlight.current && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="followup-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 id="followup-title" className="text-lg font-semibold text-slate-900">Send exhibition follow-up</h2>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</div>
            {loadError ? (
              <p className="text-red-600">{loadError}</p>
            ) : !contact ? (
              <p className="text-slate-400">Loading contact…</p>
            ) : (
              <>
                <p className="font-medium text-slate-900">
                  {contact.name || <span className="italic text-slate-500">No contact person (greeting uses “Valued Customer”)</span>}{" "}
                  <span className="font-normal text-slate-600">&lt;{contact.email || "no email"}&gt;</span>
                </p>
                {!emailOk && <p className="mt-1 text-red-600">This lead has no valid email address. Add one in the form below and save before sending.</p>}
              </>
            )}
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              Exhibition name <span className="text-red-600">*</span>
            </span>
            <input
              autoFocus
              value={exhibitionName}
              maxLength={EXHIBITION_NAME_LIMIT}
              onChange={(event) => setExhibitionName(event.target.value)}
              onBlur={() => setTouched(true)}
              disabled={sending || !!sent}
              aria-invalid={!!nameError}
              placeholder="e.g. Analytica 2026, Munich"
              className={`${input} mt-1 ${nameError ? "border-red-400" : "border-slate-300"}`}
            />
            {nameError && <span className="mt-1 block text-red-600">{nameError}</span>}
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Subject</span>
            <input
              value={finalSubject}
              maxLength={SUBJECT_LIMIT}
              onChange={(event) => setSubject(event.target.value)}
              disabled={sending || !!sent}
              aria-invalid={!!subjectError}
              className={`${input} mt-1 ${touched && subjectError ? "border-red-400" : "border-slate-300"}`}
            />
            {touched && subjectError && <span className="mt-1 block text-red-600">{subjectError}</span>}
          </label>

          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Preview</div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <b>Subject:</b> {finalSubject}
              </div>
              <iframe title="Email preview" sandbox="" srcDoc={preview} className="h-[480px] w-full bg-white" />
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <div aria-live="polite">
            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {sent && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Accepted by the mail server at {new Date(sent.acceptedAt).toLocaleTimeString()} for {sent.to}. This confirms the hand-off
                to the mail server, not delivery to the inbox.
                {sent.deliveredTo !== sent.to && <> Test mode: it went to {sent.deliveredTo} instead.</>}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              {sent ? "Close" : "Cancel"}
            </button>
            {!sent && (
              <button
                type="button"
                onClick={send}
                disabled={sending || !emailOk}
                className="inline-flex items-center gap-2 rounded-lg bg-[#12508C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0e406f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                {sending ? "Sending…" : "Send email"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
