import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { getTransporter } from "@/server/auth/email";
import { createAuditLog } from "@/server/audit/audit-log";
import { AUDIT_ACTION, AUDIT_ENTITY } from "@/lib/auditActions";
import {
  EXHIBITION_NAME_LIMIT,
  LOGO_CID,
  LOGO_PATH,
  SENDER,
  SUBJECT_LIMIT,
  defaultSubject,
  firstNameOf,
  isValidEmail,
  oneLine,
  renderExhibitionEmail,
} from "@/components/exhibition-email-template/template";
import { formsErrorResponse } from "../../route";
import { accessWhere } from "../route";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const LOGO_FILE = path.join(process.cwd(), "public", LOGO_PATH);

function fail(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

/**
 * Sends the exhibition follow-up to the lead's contact. The client supplies only
 * the exhibition name and subject; recipient, greeting and HTML come from here.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const where = accessWhere(actor, id);
    if (where instanceof NextResponse) return where;

    const body = await req.json().catch(() => null);
    const exhibitionName = oneLine(body?.exhibitionName, EXHIBITION_NAME_LIMIT);
    if (!exhibitionName) return fail(400, "Exhibition name is required");
    const subject = oneLine(body?.subject, SUBJECT_LIMIT) || defaultSubject(exhibitionName);

    const lead = await prisma.formSubmission.findFirst({ where, select: { id: true, leadNo: true, customerDetails: true } });
    if (!lead) return fail(404, "Form submission not found");

    const details = (lead.customerDetails ?? {}) as Record<string, unknown>;
    const email = oneLine(details.email, 254);
    if (!isValidEmail(email)) return fail(422, "This lead has no valid email address. Add one to the form and save it first.");

    // The dev database holds real customers, so outside production every send must be redirected.
    const redirect = process.env.FOLLOWUP_EMAILS_REDIRECT?.trim();
    if (!redirect && process.env.NODE_ENV !== "production") {
      return fail(503, "Set FOLLOWUP_EMAILS_REDIRECT to a test inbox before sending outside production");
    }

    const { html, text } = renderExhibitionEmail({ firstName: firstNameOf(details.contactPerson), exhibitionName, logoSrc: `cid:${LOGO_CID}` });
    const activity = { template: "exhibition_follow_up", leadNo: lead.leadNo, exhibitionName, subject, to: email, redirectedTo: redirect || null };
    const audit = (action: string, metadata: Record<string, unknown>) =>
      createAuditLog({ actor, action, entity: AUDIT_ENTITY.LEAD, entityId: lead.id, metadata: { ...activity, ...metadata }, request: req });

    // ponytail: no server-side dedupe, the modal blocks double clicks; add a per-lead cooldown if repeat sends become a problem.
    let info;
    try {
      // Gmail rewrites a From address its login doesn't own, so default to the login's address.
      info = await getTransporter().sendMail({
        from: process.env.SMTP_EXHIBITION_FROM?.trim() || { name: SENDER.name, address: process.env.SMTP_USER?.trim() ?? "" },
        replyTo: SENDER.address,
        to: redirect || email,
        subject: redirect ? `[to ${email}] ${subject}` : subject,
        html,
        text,
        attachments: [{ filename: "omsons-logo.png", path: LOGO_FILE, cid: LOGO_CID, contentDisposition: "inline" }],
      });
      if (!info.accepted?.length) throw new Error(`Recipient rejected: ${info.response}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[POST /api/forms/:id/exhibition-email]", error);
      await audit(AUDIT_ACTION.EMAIL_FAILED, { status: "failed", error: message });
      return message === "Email delivery is not configured"
        ? fail(503, "Email sending is not configured on the server (SMTP_*)")
        : fail(502, "The mail server did not accept the email. Check the address or try again later.");
    }

    const acceptedAt = new Date().toISOString();
    await audit(AUDIT_ACTION.EMAIL_SENT, { status: "accepted_by_smtp", messageId: info.messageId, smtpResponse: info.response, acceptedAt });

    return NextResponse.json({
      success: true,
      data: { status: "accepted", to: email, deliveredTo: redirect || email, messageId: info.messageId, acceptedAt },
    });
  } catch (error) {
    return formsErrorResponse("[POST /api/forms/:id/exhibition-email]", error, "Failed to send follow-up email");
  }
}
