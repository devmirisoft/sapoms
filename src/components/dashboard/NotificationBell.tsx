"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { MissedActivity } from "@/lib/missedActivity";

const SEEN_KEY = "omsons-missed-activity-seen";
const READ_KEY = "omsons-notifications-read";
const TIMEOUT_MS = 7000;
// One below the Toaster limit, leaving room for the "+N more" summary.
const MAX_TOASTS = 4;

const DOT: Record<MissedActivity["type"], string> = { success: "#16a34a", error: "#dc2626", info: "#075ED6" };

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** Header bell holding the order-flow activity that happened while this user was
 *  logged out. The API returns the same list for the whole session, so the bell
 *  keeps it; the toasts still pop once per login. */
export default function NotificationBell({ className }: { className?: string }) {
  const [items, setItems] = useState<MissedActivity[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/missed-activity", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { key: string | null; items: MissedActivity[] } | null) => {
        if (!data?.key || !data.items?.length) return;
        const { items } = data;
        setItems(items);
        setKey(data.key);
        setUnread(readStorage(READ_KEY) !== data.key);

        if (readStorage(SEEN_KEY) === data.key) return;
        writeStorage(SEEN_KEY, data.key);
        // Added oldest first, so the newest lands on top of the stack.
        if (items.length > MAX_TOASTS) {
          toast.add({
            type: "info",
            title: `${items.length} updates while you were away`,
            description: `Showing the latest ${MAX_TOASTS}. The bell has the rest.`,
            timeout: TIMEOUT_MS,
          });
        }
        items.slice(0, MAX_TOASTS).reverse().forEach((item) => {
          toast.add({ type: item.type, title: item.title, description: item.description || undefined, timeout: TIMEOUT_MS });
        });
      })
      .catch((error) => console.error("[missed activity]", error));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((value) => !value);
    if (unread && key) {
      writeStorage(READ_KEY, key);
      setUnread(false);
    }
  };

  return (
    <div ref={rootRef} className="dl-menu-root">
      <button
        className={className}
        onClick={toggle}
        aria-label={unread ? `Notifications, ${items.length} unread` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={18} />
        {unread && <span className="dl-bell-dot" />}
      </button>

      {open && (
        <div className="dl-menu dl-notif-menu" role="dialog" aria-label="Notifications">
          <div className="dl-menu-head">
            Notifications
            {items.length > 0 && <span>{items.length}</span>}
          </div>
          {items.length === 0 ? (
            <div className="dl-notif-empty">You&apos;re all caught up.</div>
          ) : (
            <ul className="dl-notif-list">
              {items.map((item) => (
                <li key={`${item.orderId}-${item.at}-${item.title}`}>
                  <Link href={`/orders/${item.orderId}`} className="dl-notif-item" onClick={() => setOpen(false)}>
                    <span className="dl-notif-dot" style={{ background: DOT[item.type] }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="dl-notif-title">{item.title}</span>
                      {item.description && <span className="dl-notif-desc">{item.description}</span>}
                      <span className="dl-notif-time">{new Date(item.at).toLocaleString()}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
