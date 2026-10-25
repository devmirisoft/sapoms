import path from "node:path";
import { MongoClient, ServerApiVersion, type ChangeStream, type ChangeStreamInsertDocument, type ObjectId, type ResumeToken } from "mongodb";
import { getTransporter } from "@/server/auth/email";
import {
  EXHIBITION_NAME_LIMIT,
  FALLBACK_NAME,
  LOGO_CID,
  LOGO_PATH,
  SENDER,
  defaultSubject,
  firstNameOf,
  isValidEmail,
  oneLine,
  renderExhibitionEmail,
} from "@/components/exhibition-email-template/template";

/**
 * Emails the exhibition follow-up to visitors whose cards the bizcard app saves
 * (its own MongoDB, read-only here). Only live inserts are watched, and a card must
 * fall inside its own exhibition's window and be fresh, so visitors from earlier
 * exhibitions are never emailed. Nothing is written to MongoDB or Postgres.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** The lead covers exhibitions whose start time was entered in the wrong timezone. */
const WINDOW_LEAD_MS = 12 * HOUR;
const WINDOW_GRACE_MS = 24 * HOUR;
/** Staff get this long to fix a misread email or delete the card; it is re-read before sending. */
const SEND_DELAY_MS = 2 * MINUTE;
/** A card older than this is never emailed, whatever calls handleCard. */
const MAX_CARD_AGE_MS = 30 * MINUTE;
const RESTART_DELAY_MS = MINUTE;

const LOGO_FILE = path.join(process.cwd(), "public", LOGO_PATH);

type Card = {
  _id: ObjectId;
  email?: unknown;
  contactPerson?: unknown;
  name?: unknown;
  companyName?: unknown;
  company?: unknown;
  exhibitionId?: ObjectId | null;
  createdAt?: Date;
};
type Exhibition = { _id: ObjectId; name?: unknown; startTime?: Date; endTime?: Date };

export type CardEmailDecision =
  | { send: true; to: string; firstName: string; exhibitionName: string }
  | { send: false; reason: "card_gone" | "no_exhibition" | "outside_window" | "stale" | "invalid_email" | "duplicate_email" };

/** Bizcard stores many names in capitals: "YOGESH" becomes "Yogesh". Mixed-case names stay as typed. */
function tidyName(name: string) {
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_match, separator: string, letter: string) => separator + letter.toUpperCase());
}

/** The person's first name, else the company as written on the card, else "Valued Customer". */
function greetingName(card: Card) {
  const first = firstNameOf(card.contactPerson || card.name);
  if (first !== FALLBACK_NAME) return tidyName(first);
  return oneLine(card.companyName || card.company, 160) || FALLBACK_NAME;
}

function emailWindow(exhibition: Exhibition) {
  return { from: Number(exhibition.startTime) - WINDOW_LEAD_MS, to: Number(exhibition.endTime) + WINDOW_GRACE_MS };
}

export function cardEmailDecision(input: { card: Card | null; exhibition: Exhibition | null; earlierSameEmail: number; now: Date }): CardEmailDecision {
  const { card, exhibition } = input;
  if (!card) return { send: false, reason: "card_gone" };
  const exhibitionName = oneLine(exhibition?.name, EXHIBITION_NAME_LIMIT);
  if (!exhibition || !exhibitionName) return { send: false, reason: "no_exhibition" };

  const created = Number(card.createdAt);
  const window = emailWindow(exhibition);
  // Written so a missing date (NaN) fails the check instead of passing it.
  if (!(created >= window.from && created <= window.to)) return { send: false, reason: "outside_window" };
  if (!(input.now.getTime() - created <= MAX_CARD_AGE_MS)) return { send: false, reason: "stale" };

  const to = oneLine(card.email, 254);
  if (!isValidEmail(to)) return { send: false, reason: "invalid_email" };
  if (input.earlierSameEmail > 0) return { send: false, reason: "duplicate_email" };

  return { send: true, to, firstName: greetingName(card), exhibitionName };
}

let clientPromise: Promise<MongoClient> | undefined;

async function bizcardDb() {
  const uri = process.env.BIZCARD_MONGODB_URI?.trim();
  if (!uri) throw new Error("BIZCARD_MONGODB_URI is not set");
  clientPromise ??= new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } })
    .connect()
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  return (await clientPromise).db("bizcard");
}

async function deliver({ to, firstName, exhibitionName }: Extract<CardEmailDecision, { send: true }>) {
  // Same rule as the CRM follow-up: outside production every send needs a test inbox.
  const redirect = process.env.FOLLOWUP_EMAILS_REDIRECT?.trim();
  if (!redirect && process.env.NODE_ENV !== "production") return "skipped no_redirect_outside_production";

  const subject = defaultSubject(exhibitionName);
  const { html, text } = renderExhibitionEmail({ firstName, exhibitionName, logoSrc: `cid:${LOGO_CID}`, withCatalogue: true });
  // ponytail: mirrors the sendMail in api/forms/[id]/exhibition-email/route.ts; extract a shared helper if a third sender appears.
  const info = await getTransporter().sendMail({
    from: process.env.SMTP_EXHIBITION_FROM?.trim() || { name: SENDER.name, address: process.env.SMTP_USER?.trim() ?? "" },
    replyTo: SENDER.address,
    to: redirect || to,
    subject: redirect ? `[to ${to}] ${subject}` : subject,
    html,
    text,
    attachments: [{ filename: "omsons-logo.png", path: LOGO_FILE, cid: LOGO_CID, contentDisposition: "inline" }],
  });
  if (!info.accepted?.length) throw new Error(`Recipient rejected: ${info.response}`);
  return redirect ? "sent redirected" : "sent";
}

/** Re-reads one card and emails its visitor if every check passes. Never throws. */
export async function handleCard(cardId: ObjectId, now = new Date()) {
  let exhibitionName = "";
  let outcome: string;
  try {
    const db = await bizcardDb();
    const card = await db.collection<Card>("cards").findOne(
      { _id: cardId },
      { projection: { email: 1, contactPerson: 1, name: 1, companyName: 1, company: 1, exhibitionId: 1, createdAt: 1 } },
    );
    const exhibition = card?.exhibitionId
      ? await db.collection<Exhibition>("exhibitions").findOne({ _id: card.exhibitionId }, { projection: { name: 1, startTime: 1, endTime: 1 } })
      : null;
    exhibitionName = oneLine(exhibition?.name, EXHIBITION_NAME_LIMIT);

    let decision = cardEmailDecision({ card, exhibition, earlierSameEmail: 0, now });
    // Only a card that passed every other check is compared against earlier scans of the same address.
    if (decision.send && card && exhibition) {
      const earlierSameEmail = await db.collection<Card>("cards").countDocuments({
        exhibitionId: card.exhibitionId,
        _id: { $ne: card._id },
        createdAt: { $gte: new Date(emailWindow(exhibition).from), $lt: card.createdAt },
        email: { $regex: `^\\s*${decision.to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, $options: "i" },
      });
      decision = cardEmailDecision({ card, exhibition, earlierSameEmail, now });
    }
    outcome = decision.send ? await deliver(decision) : `skipped ${decision.reason}`;
  } catch (error) {
    outcome = `failed ${error instanceof Error ? error.message : String(error)}`;
  }
  // Addresses stay out of the logs; the SMTP account's Sent folder is the record.
  console.log(`[bizcard-email] ${outcome} card=${cardId} exhibition="${exhibitionName}"`);
  return outcome;
}

const PIPELINE = [
  { $match: { operationType: "insert" } },
  // Cards can carry megabytes of inline images; only the id is needed here.
  { $project: { "fullDocument._id": 1, "fullDocument.exhibitionId": 1, "fullDocument.createdAt": 1 } },
];

// ponytail: in-memory only; inserts while the server is down, or pending at a restart, get no email. Persist the resume token if that matters.
async function watchCards(startAfter?: ResumeToken) {
  let stream: ChangeStream<Card, ChangeStreamInsertDocument<Card>> | undefined;
  let opened = false;
  try {
    const db = await bizcardDb();
    stream = db.collection<Card>("cards").watch<Card, ChangeStreamInsertDocument<Card>>(PIPELINE, startAfter ? { startAfter } : {});
    // tryNext opens the stream, so "listening" is only logged once it really is.
    const first = await stream.tryNext();
    opened = true;
    console.log("[bizcard-email] listening on bizcard.cards");
    for (let event = first; ; event = await stream.next()) {
      const id = event?.fullDocument?._id;
      if (id) setTimeout(() => void handleCard(id), SEND_DELAY_MS);
    }
  } catch (error) {
    console.error(`[bizcard-email] change stream stopped, restarting in ${RESTART_DELAY_MS / 1000}s`, error);
  }
  // A token that failed to reopen the stream is dropped, so a stale one can't loop forever.
  const token = opened ? (stream?.resumeToken ?? startAfter) : undefined;
  await stream?.close().catch(() => {});
  setTimeout(() => void watchCards(token), RESTART_DELAY_MS);
}

const listener = globalThis as typeof globalThis & { __bizcardEmailListener?: boolean };

/** Starts watching once per process. Called from instrumentation.ts when BIZCARD_EMAILS_ENABLED=true. */
export function startBizcardEmailListener() {
  if (process.env.VERCEL) {
    console.warn("[bizcard-email] not started: on Vercel every serverless instance would send its own copy");
    return;
  }
  if (!process.env.BIZCARD_MONGODB_URI?.trim()) {
    console.error("[bizcard-email] not started: BIZCARD_MONGODB_URI is not set");
    return;
  }
  if (listener.__bizcardEmailListener) return;
  listener.__bizcardEmailListener = true;
  void watchCards();
}
