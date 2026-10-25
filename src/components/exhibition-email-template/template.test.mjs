import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/components/exhibition-email-template/template.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { CATALOGUE_URL, defaultSubject, firstNameOf, isValidEmail, oneLine, renderExhibitionEmail } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

test("dynamic values are escaped in the HTML and left readable in the text part", () => {
  const { html, text } = renderExhibitionEmail({ firstName: "<b>Jo</b>", exhibitionName: `Expo "A" & <script>`, logoSrc: "cid:omsons-logo" });
  assert.ok(html.includes("Dear &#60;b&#62;Jo&#60;/b&#62;,"));
  assert.ok(html.includes("at Expo &#34;A&#34; &#38; &#60;script&#62;!"));
  assert.ok(!html.includes("<script>"));
  assert.ok(text.includes(`Dear <b>Jo</b>,`) && text.includes(`at Expo "A" & <script>!`));
  assert.ok(html.includes('src="cid:omsons-logo"'));
});

test("the body carries the links, the footer, and no Germany location", () => {
  const { html } = renderExhibitionEmail({ firstName: "Joan", exhibitionName: "Analytica", logoSrc: "x" });
  for (const href of ["https://wa.me/919992525018", "mailto:ravi@omsonsnsi.com", "tel:+919992525018"]) assert.ok(html.includes(`href="${href}"`), href);
  assert.ok(html.includes("Omsons Glassware Private Limited</td>"));
  assert.ok(!/germany/i.test(html.replace(/<img[^>]*>/g, "")));
});

test("only an email asked for the catalogue carries its line and button", () => {
  const crm = renderExhibitionEmail({ firstName: "Joan", exhibitionName: "Analytica", logoSrc: "x" });
  const bizcard = renderExhibitionEmail({ firstName: "Joan", exhibitionName: "Analytica", logoSrc: "x", withCatalogue: true });
  assert.ok(!crm.html.includes(CATALOGUE_URL) && !/catalogue/i.test(crm.text));
  assert.ok(bizcard.html.includes(`href="${CATALOGUE_URL}"`) && bizcard.html.includes(">View catalogue</a>"));
  assert.ok(bizcard.text.includes(`You can view our product catalogue online.\n${CATALOGUE_URL}`));
});

test("first name drops titles and falls back to Valued Customer", () => {
  assert.equal(firstNameOf("Mr. Rajesh Kumar"), "Rajesh");
  assert.equal(firstNameOf("  Dr Anita   Rao "), "Anita");
  assert.equal(firstNameOf("Mrinal Sen"), "Mrinal");
  assert.equal(firstNameOf("Mr."), "Valued Customer");
  assert.equal(firstNameOf(""), "Valued Customer");
  assert.equal(firstNameOf(undefined), "Valued Customer");
});

test("subject and exhibition name cannot smuggle header lines", () => {
  assert.equal(oneLine("Expo\r\nBcc: evil@example.com", 200), "Expo Bcc: evil@example.com");
  assert.equal(oneLine(42, 200), "");
  assert.equal(defaultSubject("Analytica 2026"), "A pleasure meeting you at Analytica 2026 | Omsons Glassware");
});

test("only one plain address counts as a valid recipient", () => {
  assert.ok(isValidEmail("joan@example.co.in"));
  for (const bad of ["", "joan", "joan@example", "a@b.com, c@d.com", "Joan <joan@example.com>", "a b@c.com"]) assert.ok(!isValidEmail(bad), bad);
});
