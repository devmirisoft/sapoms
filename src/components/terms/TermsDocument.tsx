export const TERMS_BLOCK_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
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

// Rendered as React elements, never raw HTML, so admin text can't inject markup.
export function TermsDocument({ blocks }: { blocks: TermsBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        const Tag = block.type;
        return <Tag key={index} className={BLOCK_CLASS[block.type]}>{block.text}</Tag>;
      })}
    </>
  );
}
