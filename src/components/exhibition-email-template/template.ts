// Exhibition follow-up email. Import-free so the CRM modal renders its preview
// with the same function the send route uses: what staff see is what goes out.

export const SENDER = { name: "Ravinder | Omsons Glassware", address: "ravi@omsonsnsi.com" };
export const LOGO_CID = "omsons-logo";
/** Under public/: the preview loads it by URL, the send route attaches the file. */
export const LOGO_PATH = "/email/omsons-germany-logo.png";
/** The full-size catalogue on Drive. Replace it there with "Manage versions" so this link keeps working. */
export const CATALOGUE_URL = "https://drive.google.com/file/d/1u2A_1fcgtnpMBGzH_ij3BRELdA6vZoyI/view";
export const EXHIBITION_NAME_LIMIT = 120;
export const SUBJECT_LIMIT = 200;
export const FALLBACK_NAME = "Valued Customer";

const ORANGE = "#E85222"; // sampled from the logo; divider only
const TEXT_ORANGE = "#C9441A"; // the logo orange darkened to 4.9:1 on white, for small text
const PHONE = "+91 999 2525 018";
const PHONE_URL = "tel:+919992525018";
const WHATSAPP_URL = "https://wa.me/919992525018";
const MAILTO = `mailto:${SENDER.address}`;
const SANS = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const CATALOGUE_LINE = "You can view our product catalogue online.";

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Collapses newlines and control characters, so the value is safe in a mail header. */
export function oneLine(value: unknown, limit: number) {
  return (typeof value === "string" ? value : "").replace(/[\s\p{Cc}]+/gu, " ").trim().slice(0, limit);
}

export function defaultSubject(exhibitionName: string) {
  return `A pleasure meeting you at ${exhibitionName} | Omsons Glassware`;
}

const TITLE = /^(mr|mrs|ms|miss|dr|prof|shri|smt|sri)\b\.?\s*/i;

/** First word of the contact person, without a leading title like "Mr." or "Dr.". */
export function firstNameOf(contactPerson: unknown) {
  return oneLine(contactPerson, 160).replace(TITLE, "").split(" ")[0] || FALLBACK_NAME;
}

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

/** One plain address: no display name, no list, nothing a header could split on. */
export function isValidEmail(value: string) {
  return value.length <= 254 && EMAIL.test(value);
}

function paragraphs(exhibition: string) {
  return [
    `Thank you for visiting Omsons Glassware at ${exhibition}! It was a pleasure meeting you, introducing our product range, and exploring potential business opportunities.`,
    "We sincerely appreciate your interest in our products and look forward to building a strong, long-term business relationship with you.",
    "Stay connected with Omsons Glassware for our product updates and exciting business opportunities. We look forward to staying in touch!",
  ];
}

const text = (size: number, line: number) => `font-family:${SANS};font-size:${size}px;line-height:${line}px;color:#222222;`;
const link = (href: string, label: string) => `<a href="${href}" style="color:${TEXT_ORANGE};text-decoration:underline;">${label}</a>`;

/**
 * `logoSrc` is `cid:${LOGO_CID}` when sending and LOGO_PATH in the preview.
 * `withCatalogue` adds the catalogue line and button; only the bizcard email sets it.
 */
export function renderExhibitionEmail({
  firstName,
  exhibitionName,
  logoSrc,
  withCatalogue = false,
}: {
  firstName: string;
  exhibitionName: string;
  logoSrc: string;
  withCatalogue?: boolean;
}) {
  const body = [`Dear ${escapeHtml(firstName)},`, ...paragraphs(escapeHtml(exhibitionName))]
    .map((line) => `<p style="margin:0 0 18px;${text(16, 26)}">${line}</p>`)
    .join("\n");
  const catalogue = withCatalogue
    ? `<p style="margin:0 0 18px;${text(16, 26)}">${CATALOGUE_LINE}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:4px;background-color:${TEXT_ORANGE};">
    <a href="${CATALOGUE_URL}" style="display:inline-block;padding:12px 26px;border:1px solid ${TEXT_ORANGE};border-radius:4px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;">View catalogue</a>
  </td></tr></table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<style>
  @media (max-width: 620px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 30px !important; line-height: 36px !important; }
    .sep { display: none !important; }
    .contact { display: block !important; padding: 3px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#EEF0F3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF0F3;">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;">
<tr><td class="px" style="padding:40px 44px 0;">
  <img src="${escapeHtml(logoSrc)}" width="200" height="118" alt="OMSONS" style="display:block;width:200px;max-width:100%;height:auto;border:0;font-family:${SANS};font-size:32px;font-weight:bold;color:${ORANGE};">
</td></tr>
<tr><td class="px" style="padding:28px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${ORANGE};font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>
<tr><td class="px" style="padding:30px 44px 0;">
  <p style="margin:0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:3px;color:${TEXT_ORANGE};">EXHIBITION FOLLOW-UP</p>
  <h1 class="h1" style="margin:12px 0 28px;font-family:${SERIF};font-size:36px;line-height:42px;font-weight:bold;color:#111111;">A pleasure meeting you.</h1>
  ${body}
  ${catalogue}
  <p style="margin:30px 0 0;${text(16, 26)}">Warm regards,<br><strong>Ravinder</strong><br>Director<br>Omsons Glassware Private Limited</p>
</td></tr>
<tr><td class="px" style="padding:32px 44px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" style="border-top:1px solid #D9DCE1;padding-top:20px;${text(14, 24)}">
      <span class="contact" style="display:inline-block;">${link(PHONE_URL, "<strong>Call</strong>")} <strong style="color:${TEXT_ORANGE};">/</strong> ${link(WHATSAPP_URL, `<strong>WhatsApp:</strong> ${PHONE}`)}</span><span class="sep" style="color:#B8BDC4;padding:0 10px;">|</span><span class="contact" style="display:inline-block;">${link(MAILTO, `<strong>Email:</strong> ${SENDER.address}`)}</span>
    </td>
  </tr></table>
</td></tr>
<tr><td class="px" style="padding:18px 44px;background-color:#F4F5F7;font-family:${SANS};font-size:13px;line-height:18px;font-weight:bold;color:#5F6670;">Omsons Glassware Private Limited</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const plain = [
    `Dear ${firstName},`,
    ...paragraphs(exhibitionName),
    ...(withCatalogue ? [`${CATALOGUE_LINE}\n${CATALOGUE_URL}`] : []),
    "Warm regards,\nRavinder\nDirector\nOmsons Glassware Private Limited",
    `Call / WhatsApp: ${PHONE} (${WHATSAPP_URL})\nEmail: ${SENDER.address}`,
  ].join("\n\n");

  return { html, text: plain };
}
