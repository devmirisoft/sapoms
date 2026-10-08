"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { COPY, type Audience } from "./audience";

// Chat code only ships once someone opens the assistant.
const ChatPanel = dynamic(() => import("./ChatPanel"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[13px] text-gray-500">Loading…</div>,
});

/**
 * Floating assistant for every signed-in user. Mounted once in the root layout, so it
 * survives client navigation. z-45 keeps it above page chrome (z-40) and below every
 * modal and toast (z-50 and up).
 */
export default function AgentWidget() {
  const auth = useAuthSession();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted (just hidden) so a reply in flight isn't lost on close.
  const [mounted, setMounted] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Every signed-in role gets it: dealers the ordering assistant, everyone else the reports
  // one (the server decides which tools and data each role gets). The chat is kept per user.
  const session = !auth.loading && auth.session.status === "authenticated" ? auth.session : null;
  const audience: Audience = session?.role === "dealer" ? "dealer" : "internal";
  const user = session?.user;
  const userKey = session && user
    ? `${session.role}:${String(user.Dealer_Id ?? user.staff_id ?? user.admin_id ?? user.accountant_id ?? user.email ?? "me")}`
    : "";
  const title = COPY[audience].title;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!userKey || pathname.startsWith("/auth")) return null;

  const toggle = () => {
    setMounted(true);
    setOpen((value) => !value);
  };

  return (
    <>
      {mounted && (
        <div
          role="dialog"
          aria-label={title}
          hidden={!open}
          className={`fixed inset-0 z-45 bg-white sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[70vh] sm:max-h-[640px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-2xl ${audience === "internal" ? "sm:w-[440px]" : "sm:w-[380px]"}`}
        >
          <ChatPanel key={userKey} audience={audience} storageKey={`omsons-agent-chat:${userKey}`} currentPage={pathname} open={open} onClose={() => { setOpen(false); launcherRef.current?.focus(); }} />
        </div>
      )}
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        aria-label={`${open ? "Close" : "Open"} ${title.toLowerCase()}`}
        aria-expanded={open}
        className={`fixed bottom-5 right-5 z-45 h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${open ? "hidden sm:flex" : "flex"}`}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}
