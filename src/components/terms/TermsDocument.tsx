import type { ReactNode } from "react";

// "sign" is a row of signature lines, one label per line of its text.
export const TERMS_BLOCK_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "sign"] as const;
export type TermsBlockType = (typeof TERMS_BLOCK_TYPES)[number];
export type TermsBlock = { type: TermsBlockType; text: string };
// A drawn signature on one slot, keyed by the slot's label.
export type SignatureView = { image: string; signerName: string; signedAt: string };

const BLOCK_CLASS: Record<TermsBlockType, string> = {
  // h1, h4 and h5 follow the printed agreement: centred title, body-sized underlined section headings.
  h1: "text-center text-lg font-bold text-slate-900 underline underline-offset-4",
  h2: "text-xl font-semibold text-slate-900",
  h3: "text-lg font-semibold text-slate-900",
  h4: "pt-3 text-sm font-bold text-slate-900 underline underline-offset-2",
  h5: "pt-3 text-sm font-bold text-slate-900 underline underline-offset-2",
  h6: "text-xs font-semibold uppercase tracking-wide text-slate-900",
  p: "whitespace-pre-line text-justify",
  // Each slot keeps its own room to sign above the line (see the sign block below).
  sign: "grid auto-cols-fr grid-flow-col gap-x-6 pt-6",
};

// Filled in from the dealer's profile wherever one dealer's document is shown (see fillDealerFields).
export const DEALER_PLACEHOLDERS = [
  "[DEALER NAME]", "[DEALER ADDRESS]", "[MOBILE NUMBER]", "[DEALER GST]", "[DEALER PAN]",
  "[DISCOUNT]", "[TARGET]", "[CREDIT LIMIT]", "[CREDIT DAYS]",
] as const;
export type DealerPlaceholder = (typeof DEALER_PLACEHOLDERS)[number];

// Missing values keep their placeholder, so a gap in the dealer's profile stays visible.
export function fillPlaceholders(blocks: TermsBlock[], values: Record<DealerPlaceholder, string | null>): TermsBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: block.text.replace(/\[[A-Z ]+\]/g, (token) => values[token as DealerPlaceholder]?.trim() || token),
  }));
}

// Inline markup in block text: **bold**. ==text== is the retired highlight, still in saved documents, shown as plain text.
const INLINE_MARKUP = /(==[^=]+==|\*\*[^*]+\*\*)/;

function renderInline(text: string) {
  // split() with a capture group puts the matches at odd indexes.
  return text.split(INLINE_MARKUP).map((part, i) => {
    if (i % 2 === 0) return part;
    const inner = part.slice(2, -2);
    return part.startsWith("==") ? inner : <strong key={i} className="font-semibold text-slate-900">{inner}</strong>;
  });
}

const LIST_ITEM = /^\s*(\d+[.)])\s*(.*)$/;

// Block-level layout: all-numbered lines become an indented list, "left || right" splits one line.
function renderBody(text: string) {
  const lines = text.split("\n");
  if (lines.every((line) => LIST_ITEM.test(line))) {
    return lines.map((line, i) => {
      const [, marker, rest] = line.match(LIST_ITEM)!;
      return (
        <span key={i} className="flex gap-2 pl-6">
          <span className="w-5 shrink-0">{marker}</span>
          <span>{renderInline(rest)}</span>
        </span>
      );
    });
  }
  const columns = text.split("||");
  if (columns.length > 1) {
    return (
      <span className="flex flex-wrap justify-between gap-x-6">
        {columns.map((column, i) => <span key={i}>{renderInline(column.trim())}</span>)}
      </span>
    );
  }
  return renderInline(text);
}

// The standard dealer agreement. Shown until an admin saves their own version, and loadable from the editor.
export const DEFAULT_TERMS_BLOCKS: TermsBlock[] = ([
  ["h1", "AGREEMENT"],
  ["p", "**Manufacturer:-** || **Date: September 4th, 2026**"],
  ["p", "**OMSONS GLASSWARE PRIVATE LIMITED**\nKhuda Kalan to Sapehra Road, P.O. Pilkhani\nAmbala-133104\nState-HARYANA\nCountry-INDIA\nPh: +919992525018, 9992929169\nE-mail: info@omsonsnsl.com, sales@omsonsnsl.com\n**GST No: 06AACCO7631A1ZV**"],
  ["h5", "Dealer:-"],
  ["p", "==[DEALER NAME]==\n==[DEALER ADDRESS]==\nMobile Number: ==[MOBILE NUMBER]=="],
  ["p", "**Terms and Conditions for dealers across the country for the sales and supply of OMSONS products.**"],
  ["p", "**INTRODUCTION:**\n**OMSONS GLASSWARE PVT LTD is a company manufacturing Hydrometers, Thermometers, Laboratory Glassware, Instruments & Plasticware and working through 550 plus dealers all India having motto ‘QUALITY PRODUCTS AT ECONOMICAL PRICE’**"],
  ["h4", "ELIGIBILITY"],
  ["p", "1. Individual Firms, partnership firms.\n2. Central/State public sector undertaking"],
  ["h4", "PAST EXPERIENCE AND TURNOVER"],
  ["p", "Dealer should have 1 year experience preferably in glassware and chemical business.\nThe freshers can also apply for the dealership however the dealership will be awarded to them for 3 months based on their financial strength market capture capability etc. the period of dealership will be extended by another 2 years based on their performance."],
  ["h4", "TARGET OF THE DEALER"],
  ["p", "==[TARGET]=="],
  ["h4", "FINANCIAL CREDIBILITY"],
  ["p", "Dealer should have a strong financial position. Letter to this effect from the banker mentioning cash/credit limit and other facilities sanctioned to be submitted. List of property like own godown /shop/house etc. with address to be submitted to OMSONS."],
  ["h4", "STORAGE FACILITY"],
  ["p", "Dealer should have adequate storage facility in case of hired warehouse, details to be submitted to OMSONS."],
  ["h4", "PACK SIZE"],
  ["p", "**All orders will be accepted in pack size.**"],
  ["h4", "BREAKAGE"],
  ["p", "Breakage will be entertained if the total breakage is more than 2% of the total amount of the bill."],
  ["h4", "EXCHANGE OF MATERIAL"],
  ["p", "If any material is dumped with the dealer’s premises that can be replaced or exchanged by the same rate as of material purchased. Freight Charges from both end for Dumped material must pay by dealer only."],
  ["h4", "GST"],
  ["p", "Dealer should have the Valid GST ==[DEALER GST]=="],
  ["h4", "PAN"],
  ["p", "Pan number with a copy of latest return ==[DEALER PAN]=="],
  ["h4", "VALIDITY AND RENEWAL"],
  ["p", "Initial validity of appointment is for 3 months, from the date of signing the agreement will be renew every financial year.\nRenewal of dealership will be purely dependent upon the performance of dealer. OMSONS has the right to renew the dealership or reject the renewal."],
  ["h4", "AREA OF OPERATION"],
  ["p", "OMSONS dealer will be free to operate anywhere in the Allocated area given by the company. The dealer shall be selling only OMSONS brand no other brand of glassware is allowed simultaneously."],
  ["p", "If Company have more than one Dealer in Area of Operation then Annexure is Mandatory to avoid Clash at Customer end."],
  ["h4", "CONDITIONS"],
  ["p", "All the RC’s will be done in the favour of OMSONS.\nFurthermore, list of customers to be submitted to OMSONS & update that list time to time."],
  ["h4", "SECURITY DEPOSIT"],
  ["p", "If the dealership is awarded, dealer shall submit without date cheque of awarded credit amount duly signed with stamp."],
  ["h4", "DISCOUNT"],
  ["p", "Dealer will be given ==[DISCOUNT]== discount as per the area and allocation.\nAdditional discount will be given on the special or on ANNUAL RATE CONTRACT."],
  ["p", "**SLABS: - If the single order will be of 2,50,000 (without GST) additional 2% discount will be given on net price and if the order will be of 5,00,000 and above (without GST) then 5% additional discount will be given net price by the company.**"],
  ["h4", "ORDER BOOKING"],
  ["p", "Orders can be placed through SAP/E-MAIL only."],
  ["h4", "DISPATCH"],
  ["p", "Material will be dispatched through transport, cargo and courier.\n**Note: - If order is above 25000 (without GST) than freight will be half paid by both Omsons & Dealer but if the order is above 50000 (without GST) than freight will fully paid by the Omsons.**"],
  ["h4", "PAYMENT MODE"],
  ["p", "NEFT OR RTGS\nAs per Invoice from the date of Invoice.\nIf the payment is not done as per given credit period, further Billing will be stopped.\nIf once bill is done, it cannot be stopped for payment, due to pending material.\nNo lump sum payment will be accepted."],
  ["h4", "CREDIT LIMIT"],
  ["p", "==[CREDIT LIMIT]==\n**1st three orders – 100% advance**"],
  ["h4", "DAYS OF CREDIT"],
  ["p", "==[CREDIT DAYS]==\n**Note: - Billing will be stopped if the credit limit or days of credit crosses the agreed limit.**"],
  ["h4", "RETURN OF GOODS"],
  ["p", "Goods once sold to the dealer shall not be taken back until the product have manufacturing error or defect."],
  ["h4", "TERMINATION OF AGREEMENT"],
  ["p", "1) The period of the contract expires\n2) In the event of termination of the contract for any reason, the dealer shall settle all the accounts of recoverable statements sent by OMSONS, within 30 days of receipt of the statement.\n3) In the event, dealer fails to achieve the target, and review of performance of the dealer and if found unsatisfactory. Dealer will have to challenge the termination of dealership."],
  ["h4", "INCENTIVE"],
  ["p", "Additional 1% discount will be given to the dealer if the dealer completes its target (for this dealer must clear all its outstanding’s by April 30. Any deviation from this will not be entertained in any circumstances)"],
  ["h4", "PROMOTION"],
  ["p", "OMSONS may time to time send material of promotion."],
  ["h4", "JURISDICTION"],
  ["p", "All the disputes/differences or claims arising out of dealership agreement shall have Ambala as its jurisdiction"],
  ["sign", "Authorized Signatory\nDealer signature\nSales person’s signature"],
] as [TermsBlockType, string][]).map(([type, text]) => ({ type, text }));

// Colours sampled from the printed letterhead.
const LOGO_PAINT = "linear-gradient(#2f60ad 78%, #134c9c 78%)"; // oval, then the darker GERMANY line
const BAR_PAINT =
  "linear-gradient(to right, #e3eafa 0 4%, #cad5f3 4% 8%, #aec0e8 8% 12%, #95addd 12% 88%, #aec0e8 88% 92%, #cad5f3 92% 96%, #e3eafa 96%)";

const LETTERHEAD_FOOTER = [
  "Khuda Kalan to Sapehra Road, Vill. Sapehra, P.O. Pilkhani",
  "Ambala Cantt - 133104, Haryana - INDIA",
  "Cell: +91 99925 25018, +91 99929 29169",
  "Email: sales@omsonsnsl.com | info@omsonsnsl.com",
  "www.omsonslabs.com | www.omsonsglassware.com",
];

// Rendered as React elements, never raw HTML, so admin text can't inject markup.
// renderSlot fills an unsigned signature slot, e.g. with a signature pad for the person who may sign it.
export function TermsDocument({
  blocks,
  signatures,
  renderSlot,
}: {
  blocks: TermsBlock[];
  signatures?: Record<string, SignatureView>;
  renderSlot?: (label: string) => ReactNode;
}) {
  return (
    <>
      <header className="flex items-end gap-2.5 pb-4">
        {/* The logo's letters are transparent, so masking it paints the letterhead's blue version. */}
        <span
          role="img"
          aria-label="Omsons Germany"
          className="aspect-[7052/4172] h-12 shrink-0 sm:h-16"
          style={{ background: LOGO_PAINT, mask: "url(/Omsons_Logo.png) center / contain no-repeat" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-base leading-none text-[#6082c4] sm:text-2xl sm:leading-none">OMSONS GLASSWARE PVT. LTD.</p>
          <div className="mt-2 h-2 sm:mt-3 sm:h-2.5" style={{ background: BAR_PAINT }} />
          <p className="mt-2 font-serif text-sm leading-none text-[#363636] sm:mt-2.5 sm:text-lg sm:leading-none">
            Exploring the Science...
          </p>
        </div>
      </header>

      {/* flex-1 pushes the footer to the bottom when the parent is a full-height page. */}
      <div className="flex-1 space-y-2">
        {blocks.map((block, index) => {
          if (block.type === "sign") {
            const labels = block.text.split("\n").map((label) => label.trim()).filter(Boolean);
            return (
              <div key={index} className={BLOCK_CLASS.sign}>
                {labels.map((label, i) => {
                  const signed = signatures?.[label];
                  return (
                    <div key={i} className="flex min-w-0 flex-col">
                      {/* Room above the line: the saved signature, the caller's pad, or blank for pen and paper.
                          It grows to the tallest slot in the row so the three lines stay level. */}
                      <div className="flex min-h-14 flex-1 items-end">
                        {signed ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={signed.image} alt={`${label}, signed by ${signed.signerName}`} className="h-14 w-auto max-w-full" />
                        ) : (
                          renderSlot?.(label)
                        )}
                      </div>
                      <p className="border-t border-dashed border-slate-500 pt-1 font-semibold text-slate-900">{label}</p>
                      <p className="min-h-4 text-[11px] text-slate-500">
                        {signed && `${signed.signerName} · ${new Date(signed.signedAt).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          }
          const Tag = block.type;
          return <Tag key={index} className={BLOCK_CLASS[block.type]}>{renderBody(block.text)}</Tag>;
        })}
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-3 text-[11px] leading-snug text-slate-500">
        {LETTERHEAD_FOOTER.map((line) => <p key={line}>{line}</p>)}
      </footer>
    </>
  );
}
