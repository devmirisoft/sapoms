// Builds a product description in the layout the admin form's buildDescription writes and
// both description parsers read back: base text, "ABOUT THIS ITEM" bullets, then one
// "VARIANT SPECIFICATIONS" line per variant ("<sku> - Key: value; Key: value").

const text = (v) => String(v ?? "").trim();
const ABOUT = "ABOUT THIS ITEM";
const SPECS = "VARIANT SPECIFICATIONS";

// "Cap. (ml)", "Capacity (mL)" and "Capacity (ml)" name one spec. A product keeps one spelling
// (the first it meets), so its variant table shows one capacity column, not two half-empty ones.
const keyForm = (key) => text(key).toLowerCase().replace(/^cap\.?(?=\s|\(|$)/, "capacity").replace(/[^a-z0-9]+/g, " ").trim();
const lineKeys = (line) => text(line.split(" - ").slice(1).join(" - ")).split(";").map((entry) => text(entry.split(":")[0])).filter(Boolean);

/** sku -> spec line, from a stored description's VARIANT SPECIFICATIONS section. */
export function specLinesOf(description) {
  const lines = new Map();
  let inSpecs = false;
  for (const raw of String(description ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.toUpperCase() === ABOUT) { inSpecs = false; continue; }
    if (line.toUpperCase() === SPECS) { inSpecs = true; continue; }
    const match = inSpecs && line.match(/^(.+?)\s+-\s+(.+)$/);
    if (match) lines.set(match[1].trim(), line);
  }
  return lines;
}

/**
 * `keepLines` (sku -> stored line) is used verbatim for those skus, e.g. variants the file
 * contradicts itself on. `lossy` collects spec entries a ":" / ";" / newline would break.
 */
export function describe(baseText, features, variants, { keepLines = new Map(), lossy = [] } = {}) {
  const parts = [text(baseText)].filter(Boolean);
  const bullets = (features ?? []).map(text).filter(Boolean);
  if (bullets.length) parts.push(`${ABOUT}\n${bullets.map((item) => `- ${item}`).join("\n")}`);

  const spelling = new Map();
  for (const line of keepLines.values()) for (const key of lineKeys(line)) if (!spelling.has(keyForm(key))) spelling.set(keyForm(key), key);
  const spell = (key) => spelling.get(keyForm(key)) ?? (spelling.set(keyForm(key), key), key);

  const specLines = variants.map((variant) => {
    const sku = text(variant.sku);
    if (keepLines.has(sku)) return keepLines.get(sku);
    const specs = Object.entries(variant.specs ?? {}).map(([key, value]) => [text(key), text(value)]).filter(([key, value]) => key && value);
    for (const [key, value] of specs) if (/[:;\n]/.test(key) || /[;\n]/.test(value)) lossy.push(`${sku} ${key}: ${value}`);
    return specs.length ? `${sku} - ${specs.map(([key, value]) => `${spell(key)}: ${value}`).join("; ")}` : "";
  }).filter(Boolean);
  if (specLines.length) parts.push(`${SPECS}\n${specLines.join("\n")}`);
  return parts.join("\n\n");
}
