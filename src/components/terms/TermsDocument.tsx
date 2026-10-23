// "sign" is a row of signature lines, one label per line of its text.
export const TERMS_BLOCK_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "sign"] as const;
export type TermsBlockType = (typeof TERMS_BLOCK_TYPES)[number];
export type TermsBlock = { type: TermsBlockType; text: string };

const BLOCK_CLASS: Record<TermsBlockType, string> = {
  h1: "text-2xl font-bold text-slate-900",
  h2: "text-xl font-semibold text-slate-900",
  h3: "text-lg font-semibold text-slate-900",
  h4: "text-base font-semibold text-slate-900",
  h5: "text-sm font-semibold text-slate-900",
  h6: "text-xs font-semibold uppercase tracking-wide text-slate-900",
  p: "whitespace-pre-line",
  // Top padding leaves room to sign above the line.
  sign: "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-10 gap-y-12 pt-14",
};

// Shown until an admin saves their own version.
export const DEFAULT_TERMS_BLOCKS: TermsBlock[] = [
  ["1. Acceptance of Terms", "By accessing or using this platform, you agree to be bound by these Terms and Conditions and all applicable laws and regulations. If you do not agree with any part of these terms, you are prohibited from using or accessing this platform."],
  ["2. Use License", "Permission is granted to temporarily access the platform for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not modify or copy the materials, use the materials for any commercial purpose or for any public display, or remove any copyright or other proprietary notations from the materials."],
  ["3. Data & Privacy", "We collect information you provide directly to us. We may use your information to operate, maintain, and improve our services; process transactions; send you technical notices, updates, security alerts, and support messages. We do not sell, trade, or transfer your personally identifiable information to third parties without your consent."],
  ["4. User Responsibilities", "You are responsible for maintaining the confidentiality of your account and password. You agree to accept responsibility for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account or any breach of security."],
  ["5. Prohibited Activities", "You are prohibited from using the platform to transmit any unsolicited or unauthorized advertising or promotional material, engage in any conduct that restricts or inhibits anyone's use or enjoyment of the platform, or use the platform in any way that violates any applicable local, national, or international law or regulation."],
  ["6. Disclaimer", "The materials on this platform are provided on an 'as is' basis. We make no warranties, expressed or implied, and hereby disclaim all other warranties including without limitation implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property."],
  ["7. Limitations", "In no event shall the platform or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on the platform."],
  ["8. Governing Law", "These terms and conditions are governed by and construed in accordance with applicable laws and you irrevocably submit to the exclusive jurisdiction of the courts in the applicable location."],
].flatMap(([title, body]): TermsBlock[] => [
  { type: "h2", text: title },
  { type: "p", text: body },
]);

// Colours sampled from the printed letterhead.
const LOGO_PAINT = "linear-gradient(#2f60ad 78%, #134c9c 78%)"; // oval, then the darker GERMANY line
const BAR_PAINT =
  "linear-gradient(to right, #e3eafa 0 4%, #cad5f3 4% 8%, #aec0e8 8% 12%, #95addd 12% 88%, #aec0e8 88% 92%, #cad5f3 92% 96%, #e3eafa 96%)";

const LETTERHEAD_FOOTER = [
  "Khuda Kalan to Sapehra Road, Vill. Sapehra, P.O. Pilkhani",
  "Ambala Cantt - 133104, Haryana - INDIA",
  "Cell: +91 99965 25018, +91 98131 63495",
  "Email: sales@omsonslabs.com | info@omsonslabs.com",
  "www.omsonslabs.com | www.omsonsglassware.com",
];

// Rendered as React elements, never raw HTML, so admin text can't inject markup.
export function TermsDocument({ blocks }: { blocks: TermsBlock[] }) {
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

      <div className="space-y-3">
        {blocks.map((block, index) => {
          if (block.type === "sign") {
            const labels = block.text.split("\n").map((label) => label.trim()).filter(Boolean);
            return (
              <div key={index} className={BLOCK_CLASS.sign}>
                {labels.map((label, i) => (
                  <p key={i} className="w-48 max-w-full border-t border-dashed border-slate-500 pt-1 font-semibold text-slate-900">{label}</p>
                ))}
              </div>
            );
          }
          const Tag = block.type;
          return <Tag key={index} className={BLOCK_CLASS[block.type]}>{block.text}</Tag>;
        })}
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-3 text-[11px] leading-snug text-slate-500">
        {LETTERHEAD_FOOTER.map((line) => <p key={line}>{line}</p>)}
      </footer>
    </>
  );
}
