import { after } from "next/server";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { sendEmail } from "@/server/auth/email";
import { ACTIVE_RSM, ACTIVE_USER, rsmOrderScope } from "@/server/auth/sales-scope";

type Shipment = { dispatchPartner: string; trackingNumber: string | null; trackingLink: string | null };

export type DealerEmail =
  | { kind: "placed" }
  | { kind: "accepted"; note?: string | null }
  | { kind: "declined"; note?: string | null }
  | { kind: "dispatched"; full: boolean; shipment?: Shipment | null }
  | { kind: "cancelled"; reason?: string | null }
  | { kind: "discount_rejected"; requestId: string; note?: string | null; partial?: boolean };

export type StaffEmailKind = "rsm_review" | "staff_accept" | "cancel_request" | "edit_request";

const REFUND_LINE = "If you paid from your wallet, the amount has been refunded to it.";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function noteLine(label: string, value: string | null | undefined) {
  return value?.trim() ? `<b>${label}:</b> ${escapeHtml(value.trim())}` : "";
}

function rupees(paise: bigint | number) {
  return `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function layout(greeting: string, lines: string[], link?: string | null) {
  return [greeting, ...lines, link ? `<a href="${escapeHtml(link)}">Open in SAPOMS</a>` : ""]
    .filter(Boolean)
    .map((line) => `<p style="white-space:pre-line">${line}</p>`)
    .join("\n");
}

function shipmentLines(shipment: Shipment | null | undefined) {
  if (!shipment) return [];
  const link = shipment.trackingLink?.trim();
  return [
    noteLine("Courier", shipment.dispatchPartner),
    noteLine("Tracking number", shipment.trackingNumber),
    // Staff type the link in; only a web link becomes clickable.
    link && /^https?:\/\//i.test(link) ? `<a href="${escapeHtml(link)}">Track this shipment</a>` : "",
  ];
}

/** Subject and body for one dealer notification. Everything staff or dealers typed is escaped. */
export function renderDealerEmail(event: DealerEmail, ctx: { businessName: string; orderNumber?: string; link?: string | null }) {
  const number = ctx.orderNumber ?? "";
  const order = `<b>${escapeHtml(number)}</b>`;
  let subject: string;
  let lines: string[];

  switch (event.kind) {
    case "placed":
      subject = `Order ${number} placed`;
      lines = [`We have received your order ${order}. It is now awaiting review.`];
      break;
    case "accepted":
      subject = `Order ${number} accepted`;
      lines = [`Your order ${order} has been accepted and will be prepared for dispatch.`, noteLine("Note", event.note)];
      break;
    case "declined":
      subject = `Order ${number} declined, moved to Drafts`;
      lines = [`Your order ${order} was declined and moved to your Drafts, where you can edit and resubmit it.`, noteLine("Reason", event.note), REFUND_LINE];
      break;
    case "dispatched":
      subject = event.full ? `Order ${number} fully dispatched` : `Order ${number} partially dispatched`;
      lines = [
        event.full ? `All items of your order ${order} have been dispatched.` : `Part of your order ${order} has been dispatched; the remaining items will follow.`,
        ...shipmentLines(event.shipment),
      ];
      break;
    case "cancelled":
      subject = `Order ${number} cancelled`;
      lines = [`Your order ${order} has been cancelled.`, noteLine("Reason", event.reason), REFUND_LINE];
      break;
    case "discount_rejected": {
      const request = `#${escapeHtml(event.requestId)}`;
      subject = event.partial ? `Some items of discount request #${event.requestId} rejected` : `Discount request #${event.requestId} rejected`;
      lines = [
        event.partial
          ? `Some items of your discount request ${request} were rejected and moved to your Drafts.`
          : `Your discount request ${request} was rejected and its items were moved to your Drafts.`,
        noteLine("Reason", event.note),
        "You can edit them there and request again.",
      ];
      break;
    }
  }

  return { subject, html: layout(`Dear ${escapeHtml(ctx.businessName)},`, lines, ctx.link) };
}

/** Subject and body for the staff member who has to act on an order next. */
export function renderStaffEmail(
  kind: StaffEmailKind,
  ctx: { orderNumber: string; dealerName: string; amountPaise: bigint | number; note?: string | null; link?: string | null },
) {
  const order = `<b>${escapeHtml(ctx.orderNumber)}</b>`;
  const dealer = `<b>${escapeHtml(ctx.dealerName)}</b>`;
  const amount = `<b>Order value:</b> ${rupees(ctx.amountPaise)}`;
  let subject: string;
  let lines: string[];

  switch (kind) {
    case "rsm_review":
      subject = `New order ${ctx.orderNumber} from ${ctx.dealerName} needs your approval`;
      lines = [`${dealer} placed order ${order}. It is waiting for your approval.`, amount];
      break;
    case "staff_accept":
      subject = `Order ${ctx.orderNumber} approved by RSM, ready to accept`;
      lines = [`Order ${order} from ${dealer} has been approved by the RSM and is ready for you to accept and dispatch.`, amount];
      break;
    case "cancel_request":
    case "edit_request": {
      const verb = kind === "cancel_request" ? "cancel" : "edit";
      subject = `${ctx.dealerName} asked to ${verb} order ${ctx.orderNumber}`;
      lines = [`${dealer} has asked to ${verb} accepted order ${order}. Please approve or reject the request.`, noteLine("Dealer's note", ctx.note), amount];
      break;
    }
  }

  return { subject, html: layout("Hello,", lines, ctx.link) };
}

function siteLink(path: string) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return site ? `${site}${path}` : null;
}

function orderPath(order: { id: bigint; legacyPhpId: string | null }) {
  return `/orders/${encodeURIComponent(order.legacyPhpId || order.id.toString())}`;
}

/** ORDER_EMAILS_REDIRECT sends everything to one test inbox, naming the real recipients in the subject. */
async function deliver(to: string[], subject: string, html: string) {
  const recipients = [...new Set(to.map((email) => email.trim()).filter(Boolean))];
  if (!recipients.length) return;
  const redirect = process.env.ORDER_EMAILS_REDIRECT?.trim();
  await sendEmail(redirect || recipients.join(", "), redirect ? `[to ${recipients.join(", ")}] ${subject}` : subject, html);
}

/**
 * Run an email job after the response is sent. Off unless ORDER_EMAILS_ENABLED=true:
 * the dev database holds real dealers' and staff addresses. Call only after the
 * transaction that made the change has committed.
 */
// ponytail: fire-and-forget, a send that fails is only logged; add an outbox table + retry if delivery must be guaranteed.
function schedule(label: string, job: () => Promise<void>) {
  if (process.env.ORDER_EMAILS_ENABLED !== "true") return;
  after(async () => {
    try {
      await job();
    } catch (error) {
      console.error("[order-email]", label, error);
    }
  });
}

/** Email the dealer about an order event. */
export function notifyDealer(target: { orderNumber: string } | { dealerId: bigint }, event: DealerEmail) {
  schedule(event.kind, async () => {
    const dealerSelect = { businessName: true, user: { select: { email: true } } } as const;
    let dealer: { businessName: string; user: { email: string } } | null;
    let orderNumber: string | undefined;
    let path = "/drafts";
    if ("orderNumber" in target) {
      const order = await prisma.order.findUnique({
        where: { orderNumber: target.orderNumber },
        select: { id: true, legacyPhpId: true, orderNumber: true, dealer: { select: dealerSelect } },
      });
      dealer = order?.dealer ?? null;
      orderNumber = order?.orderNumber;
      if (order && event.kind !== "declined") path = orderPath(order);
    } else {
      dealer = await prisma.dealerProfile.findUnique({ where: { id: target.dealerId }, select: dealerSelect });
    }
    if (!dealer) return;
    const { subject, html } = renderDealerEmail(event, { businessName: dealer.businessName, orderNumber, link: siteLink(path) });
    await deliver([dealer.user.email], subject, html);
  });
}

const staffOrderSelect = {
  id: true,
  legacyPhpId: true,
  orderNumber: true,
  status: true,
  rsmApprovalStatus: true,
  acceptanceStatus: true,
  finalPayableAmountPaise: true,
  dealer: { select: { businessName: true } },
  assignedStaff: { select: { user: { select: { email: true, status: true, deletedAt: true } } } },
} as const;

async function activeEmails(roles: UserRole[]) {
  const users = await prisma.user.findMany({ where: { role: { in: roles }, ...ACTIVE_USER }, select: { email: true } });
  return users.map((user) => user.email);
}

/** The active RSMs whose scope holds this order: the same rule that lists it on their screen. */
async function rsmEmails(orderId: bigint) {
  const rsms = await prisma.staffProfile.findMany({ where: ACTIVE_RSM, select: { id: true, userId: true, user: { select: { email: true } } } });
  const hits = await Promise.all(rsms.map((rsm) => prisma.order.count({ where: { id: orderId, ...rsmOrderScope(rsm.id, rsm.userId) } })));
  return rsms.filter((_, index) => hits[index] > 0).map((rsm) => rsm.user.email);
}

/**
 * Email whoever has to approve this order next, read off its state at send time:
 * its RSM while RSM approval is pending (the NSM, else Admin, when it has none),
 * then the assigned Staff member once the RSM has approved.
 */
export function notifyApprover(orderNumber: string) {
  schedule("approver", async () => {
    const order = await prisma.order.findUnique({ where: { orderNumber }, select: staffOrderSelect });
    if (!order || order.status === "CANCELLED" || order.status === "DECLINED" || order.acceptanceStatus !== "AWAITING") return;

    let kind: StaffEmailKind;
    let to: string[];
    if (order.rsmApprovalStatus === "AWAITING") {
      kind = "rsm_review";
      to = await rsmEmails(order.id);
      if (!to.length) to = await activeEmails(["NSM"]);
      if (!to.length) to = await activeEmails(["ADMIN"]);
    } else if (order.rsmApprovalStatus === "ACCEPTED") {
      kind = "staff_accept";
      const user = order.assignedStaff?.user;
      to = user && user.status === "ACTIVE" && !user.deletedAt ? [user.email] : [];
    } else {
      return;
    }

    const { subject, html } = renderStaffEmail(kind, { orderNumber: order.orderNumber, dealerName: order.dealer.businessName, amountPaise: order.finalPayableAmountPaise, link: siteLink(orderPath(order)) });
    await deliver(to, subject, html);
  });
}

/** Email Admin and NSM, who review a dealer's cancel/edit request on an accepted order. */
export function notifyReviewers(orderNumber: string, request: "cancel" | "edit", note?: string | null) {
  schedule(`${request}_request`, async () => {
    const order = await prisma.order.findUnique({ where: { orderNumber }, select: staffOrderSelect });
    if (!order) return;
    const { subject, html } = renderStaffEmail(request === "cancel" ? "cancel_request" : "edit_request", {
      orderNumber: order.orderNumber,
      dealerName: order.dealer.businessName,
      amountPaise: order.finalPayableAmountPaise,
      note,
      link: siteLink(orderPath(order)),
    });
    await deliver(await activeEmails(["ADMIN", "NSM"]), subject, html);
  });
}
