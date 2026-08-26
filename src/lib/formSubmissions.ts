import { Prisma } from "@prisma/client";
import type { FormSubmission } from "@prisma/client";

const TEXT_LIMIT = 2000;
const ITEM_LIMIT = 160;
const PHONE_LIMIT = 80;
const ARRAY_LIMIT = 50;

export const LEAD_SEQUENCE_ID = "leadNo";

export const PRODUCT_NAMES = ["Syringe Filter", "Capsule", "Cartridge Filter"] as const;
export type ProductName = (typeof PRODUCT_NAMES)[number];

export type DecisionMaker = { name: string; designation: string; phone: string; email: string };
export type FormSection = Record<string, string | string[] | DecisionMaker>;

export type FormSubmissionInput = {
  products: ProductName[];
  customerDetails: FormSection;
  syringeFilter?: FormSection;
  capsule?: FormSection;
  cartridgeFilter?: FormSection;
  commercialInfo: FormSection;
};

type SectionKey = "customerDetails" | "syringeFilter" | "capsule" | "cartridgeFilter" | "commercialInfo";

const TEXT_FIELDS: Record<SectionKey, string[]> = {
  customerDetails: [
    "companyName",
    "contactPerson",
    "department",
    "designation",
    "mobile",
    "email",
    "website",
    "address",
    "cityState",
    "industryTypeOther",
    "existingSupplier",
  ],
  syringeFilter: [
    "poreSizeOther",
    "membraneTypeOther",
    "housingMaterialOther",
    "applicationOther",
    "quantityRequired",
    "monthlyConsumption",
    "targetPrice",
    "requiredDeliveryTime",
  ],
  capsule: [
    "membraneTypeOther",
    "poreSizeOther",
    "connectionTypeOther",
    "flowRateRequirement",
    "operatingPressure",
    "validationRequirement",
    "quantityRequired",
    "monthlyConsumption",
    "requiredDeliveryTime",
  ],
  cartridgeFilter: [
    "membraneMediaOther",
    "micronRatingOther",
    "endConnectionOther",
    "operatingTemperature",
    "operatingPressure",
    "flowRateRequirement",
    "quantityRequired",
    "monthlyConsumption",
    "validationRequirement",
    "requiredDeliveryTime",
  ],
  commercialInfo: [
    "expectedOrderQty",
    "expectedOrderValue",
    "followUpDate",
    "competitorBrandInUse",
    "sampleDetails",
  ],
};

const ARRAY_FIELDS: Record<SectionKey, string[]> = {
  customerDetails: ["industryType", "inquirySource"],
  syringeFilter: ["filterDiameter", "poreSize", "membraneType", "housingMaterial", "application", "sampleType"],
  capsule: ["capsuleSize", "membraneType", "poreSize", "connectionType", "application"],
  cartridgeFilter: ["cartridgeLength", "membraneMedia", "micronRating", "endConnection", "sealMaterial", "application"],
  commercialInfo: [],
};

const SINGLE_FIELDS: Partial<Record<SectionKey, string[]>> = {
  syringeFilter: ["individuallyPacked", "sterile"],
  capsule: ["sterile"],
  commercialInfo: ["requirementType", "purchaseTimeline", "techApprovalRequired", "sampleRequired"],
};

function toText(value: unknown, limit = TEXT_LIMIT): string {
  if (typeof value === "string") return value.trim().slice(0, limit);
  if (typeof value === "number" || typeof value === "boolean") return String(value).slice(0, limit);
  return "";
}

function toArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = toText(value, ITEM_LIMIT);
    return single ? [single] : [];
  }
  return value
    .map((item) => toText(item, ITEM_LIMIT))
    .filter((item) => item.length > 0)
    .slice(0, ARRAY_LIMIT);
}

function normalizeDecisionMaker(value: unknown): DecisionMaker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "", designation: "", phone: "", email: "" };
  }
  const input = value as Record<string, unknown>;
  return {
    name: toText(input.name, ITEM_LIMIT),
    designation: toText(input.designation, ITEM_LIMIT),
    phone: toText(input.phone, PHONE_LIMIT),
    email: toText(input.email, ITEM_LIMIT),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeSection(key: SectionKey, raw: unknown): FormSection {
  const input = asObject(raw);
  const section: FormSection = {};

  for (const field of TEXT_FIELDS[key]) {
    section[field] = toText(input[field]);
  }
  for (const field of ARRAY_FIELDS[key]) {
    section[field] = toArray(input[field]);
  }
  for (const field of SINGLE_FIELDS[key] ?? []) {
    section[field] = toText(input[field], ITEM_LIMIT);
  }
  return section;
}

function trimHiddenOther(section: FormSection, field: string, otherField: string) {
  const values = section[field];
  const hasOther = Array.isArray(values) && values.includes("Other");
  if (!hasOther) section[otherField] = "";
}

export function validateFormSubmissionBody(body: unknown): FormSubmissionInput {
  const input = asObject(body);

  const products = toArray(input.products).filter((item): item is ProductName =>
    (PRODUCT_NAMES as readonly string[]).includes(item)
  );
  if (products.length === 0) {
    throw new Error("At least one product is required");
  }

  const customerDetails = sanitizeSection("customerDetails", input.customerDetails);
  if (!toText(customerDetails.companyName)) {
    throw new Error("Company Name is required");
  }
  trimHiddenOther(customerDetails, "industryType", "industryTypeOther");

  const commercialRaw = asObject(input.commercialInfo ?? input.commercialInformation);
  const commercialInfo = sanitizeSection("commercialInfo", commercialRaw);
  commercialInfo.decisionMaker = normalizeDecisionMaker(commercialRaw.decisionMaker);
  if (commercialInfo.sampleRequired !== "Yes") {
    commercialInfo.sampleDetails = "";
  }

  const data: FormSubmissionInput = { products, customerDetails, commercialInfo };

  if (products.includes("Syringe Filter")) {
    const section = sanitizeSection("syringeFilter", input.syringeFilter);
    trimHiddenOther(section, "poreSize", "poreSizeOther");
    trimHiddenOther(section, "membraneType", "membraneTypeOther");
    trimHiddenOther(section, "housingMaterial", "housingMaterialOther");
    trimHiddenOther(section, "application", "applicationOther");
    data.syringeFilter = section;
  }

  if (products.includes("Capsule")) {
    const section = sanitizeSection("capsule", input.capsule);
    trimHiddenOther(section, "membraneType", "membraneTypeOther");
    trimHiddenOther(section, "poreSize", "poreSizeOther");
    trimHiddenOther(section, "connectionType", "connectionTypeOther");
    data.capsule = section;
  }

  if (products.includes("Cartridge Filter")) {
    const section = sanitizeSection("cartridgeFilter", input.cartridgeFilter);
    trimHiddenOther(section, "membraneMedia", "membraneMediaOther");
    trimHiddenOther(section, "micronRating", "micronRatingOther");
    trimHiddenOther(section, "endConnection", "endConnectionOther");
    data.cartridgeFilter = section;
  }

  return data;
}

/**
 * Atomically reserves the next lead number. The UPDATE ... RETURNING runs inside
 * the caller's transaction and takes a row lock, so concurrent creators serialize
 * and never share a number.
 */
export async function nextLeadNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    INSERT INTO "form_lead_sequences" ("id", "last_value", "updated_at")
    VALUES (${LEAD_SEQUENCE_ID}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE
      SET "last_value" = "form_lead_sequences"."last_value" + 1,
          "updated_at" = CURRENT_TIMESTAMP
    RETURNING "last_value"
  `;
  const seq = Number(rows[0]?.last_value ?? 1);
  return formatLeadNo(seq);
}

export function formatLeadNo(seq: number): string {
  return `OML-${String(seq).padStart(3, "0")}`;
}

/** Non-atomic preview of the number the next create would receive. */
export async function peekNextLeadNo(client: Prisma.TransactionClient): Promise<string> {
  const row = await client.formLeadSequence.findUnique({ where: { id: LEAD_SEQUENCE_ID } });
  return formatLeadNo(Number(row?.lastValue ?? 0) + 1);
}

function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

type FormSubmissionWithSubmitter = FormSubmission & {
  submittedBy?: { id: bigint; email: string } | null;
};

export function serializeFormSubmission(doc: FormSubmissionWithSubmitter) {
  return {
    id: doc.id.toString(),
    leadNo: doc.leadNo,
    products: doc.products,
    customerDetails: doc.customerDetails,
    syringeFilter: doc.syringeFilter ?? undefined,
    capsule: doc.capsule ?? undefined,
    cartridgeFilter: doc.cartridgeFilter ?? undefined,
    commercialInfo: doc.commercialInfo,
    submittedBy: {
      userId: doc.submittedByUserId.toString(),
      name: doc.submittedByName,
      role: doc.submittedByRole,
    },
    visitedDate: toIso(doc.visitedDate),
    submittedAt: toIso(doc.submittedAt),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

/** Parses a route id into a BigInt, or null when it is not a positive integer. */
export function formIdFromString(id: string): bigint | null {
  if (!/^\d+$/.test(id)) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

/**
 * Maps validated input onto the Json/scalar columns shared by create and update.
 * Unselected product sections are written as SQL NULL (Prisma.JsonNull) so a PUT
 * that drops a product clears the stored section rather than leaving it behind.
 */
export function toFormSubmissionColumns(data: FormSubmissionInput) {
  const section = (value: FormSection | undefined) =>
    value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

  return {
    products: data.products,
    customerDetails: data.customerDetails as Prisma.InputJsonValue,
    syringeFilter: section(data.syringeFilter),
    capsule: section(data.capsule),
    cartridgeFilter: section(data.cartridgeFilter),
    commercialInfo: data.commercialInfo as Prisma.InputJsonValue,
    companyName: toText(data.customerDetails.companyName),
  };
}
