import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;

globalThis.__clients = [];
globalThis.__sent = [];
globalThis.__watches = 0;

const stubs = {
  mongodb: `export const ServerApiVersion = { v1: "1" };
    export class MongoClient {
      constructor(uri) { globalThis.__clients.push(uri); }
      async connect() { return this; }
      db() { return globalThis.__db; }
    }`,
  "@/server/auth/email": `export function getTransporter() {
    return { sendMail: async (mail) => { globalThis.__sent.push(mail); return { accepted: [mail.to], response: "250 OK" }; } };
  }`,
  // The real template, so names and subjects are checked against what actually goes out.
  "@/components/exhibition-email-template/template": transpile(await fs.readFile(path.resolve("src/components/exhibition-email-template/template.ts"), "utf8")),
};

async function load() {
  let source = await fs.readFile(path.resolve("src/server/notify/bizcard-email.ts"), "utf8");
  for (const [specifier, code] of Object.entries(stubs)) {
    source = source.replace(new RegExp(`(from\\s+)["']${specifier.replace(/[/@.-]/g, "\\$&")}["']`), `$1"${dataUrl(code)}"`);
  }
  return import(dataUrl(transpile(source)));
}

const { cardEmailDecision, handleCard, startBizcardEmailListener } = await load();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date("2026-10-26T10:30:00Z");
const END = new Date("2026-10-28T18:30:00Z");
const exhibition = { _id: "ex1", name: "ANALYTICA  MUNICH - 2026 ", startTime: START, endTime: END };
const pittcon = { _id: "ex0", name: "PITTCON 2026", startTime: new Date("2026-03-09T14:30:00Z"), endTime: new Date("2026-03-11T20:30:00Z") };

function cardAt(createdAt, overrides = {}) {
  return { _id: "c1", email: " visitor@example.com ", contactPerson: "Mr. Rajesh Kumar", exhibitionId: "ex1", createdAt, ...overrides };
}

function decide(card, { exh = exhibition, earlierSameEmail = 0, now = new Date(Number(card?.createdAt) + 2 * MIN) } = {}) {
  return cardEmailDecision({ card, exhibition: exh, earlierSameEmail, now });
}

test("a fresh card inside its exhibition is sent with a clean first name and exhibition name", () => {
  assert.deepEqual(decide(cardAt(new Date(+START + HOUR))), {
    send: true,
    to: "visitor@example.com",
    firstName: "Rajesh",
    exhibitionName: "ANALYTICA MUNICH - 2026",
  });
});

test("the window runs from 12h before the start to 24h after the end, inclusive", () => {
  assert.equal(decide(cardAt(new Date(+START - 12 * HOUR))).send, true);
  assert.deepEqual(decide(cardAt(new Date(+START - 12 * HOUR - MIN))), { send: false, reason: "outside_window" });
  assert.equal(decide(cardAt(new Date(+END + 24 * HOUR))).send, true);
  assert.deepEqual(decide(cardAt(new Date(+END + 24 * HOUR + MIN))), { send: false, reason: "outside_window" });
});

test("a card saved now for an old exhibition is refused", () => {
  assert.deepEqual(decide(cardAt(new Date("2026-10-26T12:00:00Z"), { exhibitionId: "ex0" }), { exh: pittcon }), { send: false, reason: "outside_window" });
});

test("a card older than 30 minutes is refused even inside the window", () => {
  const card = cardAt(new Date(+START + HOUR));
  assert.equal(decide(card, { now: new Date(+card.createdAt + 30 * MIN) }).send, true);
  assert.deepEqual(decide(card, { now: new Date(+card.createdAt + 31 * MIN) }), { send: false, reason: "stale" });
});

test("missing card, exhibition, name or date never sends", () => {
  assert.deepEqual(decide(null, { now: new Date() }), { send: false, reason: "card_gone" });
  assert.deepEqual(decide(cardAt(new Date(+START + HOUR)), { exh: null }), { send: false, reason: "no_exhibition" });
  assert.deepEqual(decide(cardAt(new Date(+START + HOUR)), { exh: { ...exhibition, name: "  " } }), { send: false, reason: "no_exhibition" });
  assert.deepEqual(decide(cardAt(undefined), { now: new Date(+START + HOUR) }), { send: false, reason: "outside_window" });
  assert.deepEqual(decide(cardAt(new Date(+START + HOUR)), { exh: { ...exhibition, startTime: undefined } }), { send: false, reason: "outside_window" });
});

test("invalid emails and repeat scans are skipped", () => {
  const at = new Date(+START + HOUR);
  assert.deepEqual(decide(cardAt(at, { email: "" })), { send: false, reason: "invalid_email" });
  assert.deepEqual(decide(cardAt(at, { email: "a@b.com, c@d.com" })), { send: false, reason: "invalid_email" });
  assert.deepEqual(decide(cardAt(at), { earlierSameEmail: 1 }), { send: false, reason: "duplicate_email" });
});

test("old cards fall back to the name field", () => {
  assert.equal(decide(cardAt(new Date(+START + HOUR), { contactPerson: "", name: "Dr. Asha Rao" })).firstName, "Asha");
});

test("the greeting tidies capitals, keeps mixed case, and falls back to the company", () => {
  const greet = (overrides) => decide(cardAt(new Date(+START + HOUR), overrides)).firstName;
  assert.equal(greet({ contactPerson: "YOGESH MAHAJAN" }), "Yogesh");
  assert.equal(greet({ contactPerson: "MR. ANNE-MARIE D'SOUZA" }), "Anne-Marie");
  assert.equal(greet({ contactPerson: "priya sharma" }), "Priya");
  assert.equal(greet({ contactPerson: "DeShawn Lee" }), "DeShawn");
  assert.equal(greet({ contactPerson: "", companyName: " Apitoria Pharma  Private Limited " }), "Apitoria Pharma Private Limited");
  assert.equal(greet({ contactPerson: "", company: "ACME LABS PVT LTD" }), "ACME LABS PVT LTD");
  assert.equal(greet({ contactPerson: "" }), "Valued Customer");
});

function useDb({ card, exh = exhibition, earlier = 0 }) {
  globalThis.__db = {
    collection(name) {
      if (name === "exhibitions") return { findOne: async () => exh };
      return {
        findOne: async () => card,
        countDocuments: async (filter) => {
          globalThis.__countFilter = filter;
          return earlier;
        },
        watch: () => {
          globalThis.__watches += 1;
          return { tryNext: () => new Promise(() => {}), close: async () => {} };
        },
      };
    },
  };
}

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  setEnv(values);
  return Promise.resolve(fn()).finally(() => setEnv(saved));
}

const card = cardAt(new Date(+START + HOUR));
const fresh = new Date(+card.createdAt + 2 * MIN);
const env = { BIZCARD_MONGODB_URI: "mongodb://stub", SMTP_USER: "omsonsexport@gmail.com", SMTP_EXHIBITION_FROM: undefined };

test("outside production without a redirect nothing is sent", async () => {
  useDb({ card });
  globalThis.__sent = [];
  await withEnv({ ...env, NODE_ENV: "development", FOLLOWUP_EMAILS_REDIRECT: undefined }, async () => {
    assert.equal(await handleCard("c1", fresh), "skipped no_redirect_outside_production");
  });
  assert.equal(globalThis.__sent.length, 0);
});

test("with a redirect the email goes to the test inbox and names the real recipient", async () => {
  useDb({ card });
  globalThis.__sent = [];
  await withEnv({ ...env, NODE_ENV: "development", FOLLOWUP_EMAILS_REDIRECT: "devbigu@gmail.com" }, async () => {
    assert.equal(await handleCard("c1", fresh), "sent redirected");
  });
  const [mail] = globalThis.__sent;
  assert.equal(mail.to, "devbigu@gmail.com");
  assert.equal(mail.subject, "[to visitor@example.com] A pleasure meeting you at ANALYTICA MUNICH - 2026 | Omsons Glassware");
  assert.deepEqual(mail.from, { name: "Ravinder | Omsons Glassware", address: "omsonsexport@gmail.com" });
  assert.equal(mail.replyTo, "ravi@omsonsnsi.com");
  assert.ok(mail.html.includes("Dear Rajesh,") && mail.text.includes("Dear Rajesh,"));
  assert.equal(mail.attachments[0].cid, "omsons-logo");
});

test("in production without a redirect the visitor gets it", async () => {
  useDb({ card });
  globalThis.__sent = [];
  await withEnv({ ...env, NODE_ENV: "production", FOLLOWUP_EMAILS_REDIRECT: undefined }, async () => {
    assert.equal(await handleCard("c1", fresh), "sent");
  });
  assert.equal(globalThis.__sent[0].to, "visitor@example.com");
  assert.equal(globalThis.__sent[0].subject, "A pleasure meeting you at ANALYTICA MUNICH - 2026 | Omsons Glassware");
});

test("repeat scans are matched case-insensitively and literally", async () => {
  useDb({ card: cardAt(card.createdAt, { email: "a.b@example.com" }), earlier: 1 });
  globalThis.__sent = [];
  await withEnv({ ...env, NODE_ENV: "production", FOLLOWUP_EMAILS_REDIRECT: undefined }, async () => {
    assert.equal(await handleCard("c1", fresh), "skipped duplicate_email");
  });
  assert.equal(globalThis.__sent.length, 0);
  const filter = globalThis.__countFilter;
  const pattern = new RegExp(filter.email.$regex, filter.email.$options);
  assert.ok(pattern.test(" A.B@Example.com "));
  assert.ok(!pattern.test("aXb@example.com"));
  assert.equal(filter.exhibitionId, "ex1");
  assert.deepEqual(filter.createdAt, { $gte: new Date(+START - 12 * HOUR), $lt: card.createdAt });
});

test("handleCard on an old card with the real clock sends nothing", async () => {
  useDb({ card: cardAt(new Date("2026-09-11T06:00:00Z"), { exhibitionId: "ex2" }), exh: { ...exhibition, startTime: new Date("2026-09-10T03:30:00Z"), endTime: new Date("2026-09-12T12:00:00Z") } });
  globalThis.__sent = [];
  await withEnv({ ...env, NODE_ENV: "production", FOLLOWUP_EMAILS_REDIRECT: undefined }, async () => {
    assert.equal(await handleCard("c1", new Date("2026-10-24T12:00:00Z")), "skipped stale");
  });
  assert.equal(globalThis.__sent.length, 0);
});

test("handleCard never throws when MongoDB fails", async () => {
  globalThis.__db = { collection: () => ({ findOne: async () => { throw new Error("boom"); } }) };
  await withEnv(env, async () => {
    assert.equal(await handleCard("c1", fresh), "failed boom");
  });
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the listener refuses to start on Vercel or without a URI", async () => {
  useDb({ card });
  await withEnv({ ...env, VERCEL: "1" }, () => startBizcardEmailListener());
  await withEnv({ ...env, BIZCARD_MONGODB_URI: undefined, VERCEL: undefined }, () => startBizcardEmailListener());
  await tick();
  assert.equal(globalThis.__watches, 0);
});

test("the listener starts only once per process", async () => {
  useDb({ card });
  await withEnv({ ...env, VERCEL: undefined }, () => {
    startBizcardEmailListener();
    startBizcardEmailListener();
  });
  await tick();
  assert.equal(globalThis.__watches, 1);
});
