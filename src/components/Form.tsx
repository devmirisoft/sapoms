"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";

type Option = { label: string; value: string };
type DecisionMaker = { name: string; designation: string; phone: string; email: string };
type Section = Record<string, string | string[] | DecisionMaker | undefined>;
type Product = "Syringe Filter" | "Capsule" | "Cartridge Filter";

export type Submission = {
  id: string;
  leadNo: string;
  products: Product[];
  customerDetails: Section;
  syringeFilter?: Section;
  capsule?: Section;
  cartridgeFilter?: Section;
  commercialInfo?: Section;
  commercialInformation?: Section;
  visitedDate?: string;
  createdAt?: string;
  updatedAt?: string;
};

const BLUE = "#12508C";
const opts = (arr: string[]): Option[] => arr.map((value) => ({ label: value, value }));

const PRODUCTS = opts(["Syringe Filter", "Capsule", "Cartridge Filter"]);
const INDUSTRY = opts(["Pharma", "Biotech", "Food, Beverages", "Chemical", "Research", "Academic", "Other"]);
const INQUIRY_SOURCE = opts(["Exhibition", "Website", "Distributor", "Reference", "Sales Visit / Other"]);
const SYRINGE_DIAMETER = opts(["13mm", "25mm", "33mm", "50mm"]);
const SYRINGE_PORE = opts(["0.22um", "0.45um", "Other"]);
const MEMBRANE_SYRINGE = opts(["PTFE", "Nylon", "PVDF", "PES", "MCE", "CA", "GF", "Other"]);
const HOUSING = opts(["PP", "Other"]);
const YES_NO = opts(["Yes", "No"]);
const APPLICATION_SYRINGE = opts(["Sample Preparation", "Sterile Filtration", "HPLC", "Other"]);
const SAMPLE_TYPE = opts(["Aqueous", "Organic", "Aggressive Chemicals", "Biological"]);
const STERILE = opts(["Sterile", "Non Sterile"]);
const CAPSULE_SIZE = opts(["1\"", "2\"", "5\" Small", "5\" Large", "8\"", "10\" Small", "10\" Large"]);
const MEMBRANE_CAPSULE = opts(["PES", "PTFE", "PVDF", "Nylon", "PP", "GF", "Other"]);
const PORE_CAPSULE = opts(["0.1um", "0.22um", "0.45um", "0.8um", "1.0um", "5um", "10um", "20um", "Other"]);
const CONNECTION_TYPE = opts(["Hose Barb", "TC", "Threaded", "Other"]);
const APPLICATION_CAPSULE = opts(["Vent", "Liquid", "Gas", "Solvent"]);
const CARTRIDGE_LENGTH = opts(["5\"", "10\"", "20\"", "30\"", "40\""]);
const END_CONNECTION = opts(["DOE", "SOE", "TC", "Other"]);
const SEAL_MATERIAL = opts(["Silicone", "EPDM", "Viton", "PTFE"]);
const APPLICATION_CARTRIDGE = opts(["Water", "Solvent", "Chemical", "Pharma", "Air", "Gas"]);
const REQUIREMENT_TYPE = opts(["Trial", "Regular", "Tender", "Project"]);
const PURCHASE_TIMELINE = opts(["Immediate", "1 Month", "3 Months", "Future"]);

const EMPTY_DM: DecisionMaker = { name: "", designation: "", phone: "", email: "" };
const initialText: Record<string, string> = {};
const initialChoices: Record<string, string[]> = {};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <div className="pt-2 text-[13px] font-semibold text-slate-700">{label}</div>
      <div className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-[#12508C] focus-within:ring-2 focus-within:ring-[#12508C]/10">
        {children}
      </div>
    </div>
  );
}

function TextBox({
  value,
  onChange,
  placeholder = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-6 w-full bg-transparent text-[14px] font-medium text-black outline-none placeholder:text-black/45"
    />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mt-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="h-5 w-1 rounded-full" style={{ background: BLUE }} />
        <span className="text-[13px] font-bold uppercase tracking-wide" style={{ color: BLUE }}>
          {children}
        </span>
      </div>
    </div>
  );
}

function MultiSelect({
  name,
  options,
  selected,
  onChange,
  multiple = true,
}: {
  name: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  const toggle = (value: string) => {
    if (!multiple) {
      onChange(selected.includes(value) ? [] : [value]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 bg-transparent text-left"
      >
        <span className="flex flex-wrap gap-1.5">
          {selected.length === 0 ? (
            <span className="rounded border border-transparent px-2 py-0.5 text-[13px] font-medium text-black/55">
              Select
            </span>
          ) : (
            selected.map((value) => (
              <span
                key={value}
                className="rounded border border-[#12508C]/20 bg-[#12508C]/5 px-2 py-0.5 text-[13px] font-medium text-black"
              >
                {value}
              </span>
            ))
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-[13px] text-black outline-none placeholder:text-black/40"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-black hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name={name}
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="accent-[#12508C]"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : [];

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

function normalizeDecisionMaker(value: unknown): DecisionMaker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_DM;
  const input = value as Record<string, unknown>;
  return {
    name: asText(input.name),
    designation: asText(input.designation),
    phone: asText(input.phone),
    email: asText(input.email),
  };
}

export default function Form({
  submission,
  mode = "create",
  role = "staff",
}: {
  submission?: Submission | null;
  mode?: "create" | "edit";
  role?: "staff" | "admin";
}) {
  void role;

  const isEdit = mode === "edit" && Boolean(submission?.id);

  const [text, setText] = useState<Record<string, string>>(initialText);
  const [choices, setChoices] = useState<Record<string, string[]>>(initialChoices);
  const [decisionMaker, setDecisionMaker] = useState<DecisionMaker>(EMPTY_DM);
  const [submitting, setSubmitting] = useState(false);
  const [leadPreview, setLeadPreview] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const set = (key: string) => (value: string) => setText((prev) => ({ ...prev, [key]: value }));
  const choose = (key: string) => (values: string[]) => setChoices((prev) => ({ ...prev, [key]: values }));

  const selectedProducts = (choices.products ?? []) as Product[];
  const sampleRequired = choices.sampleRequired?.[0] === "Yes";

  useEffect(() => {
    if (sampleRequired) return;
    setText((prev) => (prev.sampleDetails ? { ...prev, sampleDetails: "" } : prev));
  }, [sampleRequired]);

  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/forms/next-lead", { credentials: "include", cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json.success) setLeadPreview(String(json.leadNo ?? ""));
      } catch {
        if (!cancelled) setLeadPreview("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  useEffect(() => {
    if (!submission) return;

    const customer = submission.customerDetails ?? {};
    const syringe = submission.syringeFilter ?? {};
    const capsule = submission.capsule ?? {};
    const cartridge = submission.cartridgeFilter ?? {};
    const commercial = submission.commercialInfo ?? submission.commercialInformation ?? {};

    setText({
      companyName: asText(customer.companyName),
      contactPerson: asText(customer.contactPerson),
      department: asText(customer.department),
      designation: asText(customer.designation),
      mobile: asText(customer.mobile),
      email: asText(customer.email),
      website: asText(customer.website),
      address: asText(customer.address),
      cityState: asText(customer.cityState),
      industryOther: asText(customer.industryTypeOther),
      existingSupplier: asText(customer.existingSupplier),

      synPoreOther: asText(syringe.poreSizeOther),
      synMembraneOther: asText(syringe.membraneTypeOther),
      synHousingOther: asText(syringe.housingMaterialOther),
      synApplicationOther: asText(syringe.applicationOther),
      synQty: asText(syringe.quantityRequired),
      synMonthly: asText(syringe.monthlyConsumption),
      synPrice: asText(syringe.targetPrice),
      synDelivery: asText(syringe.requiredDeliveryTime),

      capMembraneOther: asText(capsule.membraneTypeOther),
      capPoreOther: asText(capsule.poreSizeOther),
      capConnectionOther: asText(capsule.connectionTypeOther),
      capFlow: asText(capsule.flowRateRequirement),
      capPressure: asText(capsule.operatingPressure),
      capValidation: asText(capsule.validationRequirement),
      capQty: asText(capsule.quantityRequired),
      capMonthly: asText(capsule.monthlyConsumption),
      capDelivery: asText(capsule.requiredDeliveryTime),

      cartMediaOther: asText(cartridge.membraneMediaOther),
      cartMicronOther: asText(cartridge.micronRatingOther),
      cartEndOther: asText(cartridge.endConnectionOther),
      cartTemp: asText(cartridge.operatingTemperature),
      cartPressure: asText(cartridge.operatingPressure),
      cartFlow: asText(cartridge.flowRateRequirement),
      cartQty: asText(cartridge.quantityRequired),
      cartMonthly: asText(cartridge.monthlyConsumption),
      cartValidation: asText(cartridge.validationRequirement),
      cartDelivery: asText(cartridge.requiredDeliveryTime),

      expQty: asText(commercial.expectedOrderQty),
      expValue: asText(commercial.expectedOrderValue),
      sampleDetails: asText(commercial.sampleDetails),
      followUp: asText(commercial.followUpDate),
      competitorBrand: asText(commercial.competitorBrandInUse),
    });

    setChoices({
      products: asArray(submission.products),
      industry: asArray(customer.industryType),
      inquirySource: asArray(customer.inquirySource),

      synDiameter: asArray(syringe.filterDiameter),
      synPore: asArray(syringe.poreSize),
      synMembrane: asArray(syringe.membraneType),
      synHousing: asArray(syringe.housingMaterial),
      synPacked: asArray(syringe.individuallyPacked),
      synApplication: asArray(syringe.application),
      synSample: asArray(syringe.sampleType),
      synSterile: asArray(syringe.sterile),

      capSize: asArray(capsule.capsuleSize),
      capMembrane: asArray(capsule.membraneType),
      capPore: asArray(capsule.poreSize),
      capConnection: asArray(capsule.connectionType),
      capApplication: asArray(capsule.application),
      capSterile: asArray(capsule.sterile),

      cartLength: asArray(cartridge.cartridgeLength),
      cartMedia: asArray(cartridge.membraneMedia),
      cartMicron: asArray(cartridge.micronRating),
      cartEnd: asArray(cartridge.endConnection),
      cartSeal: asArray(cartridge.sealMaterial),
      cartApplication: asArray(cartridge.application),

      reqType: asArray(commercial.requirementType),
      timeline: asArray(commercial.purchaseTimeline),
      techApproval: asArray(commercial.techApprovalRequired),
      sampleRequired: asArray(commercial.sampleRequired),
    });

    setDecisionMaker(normalizeDecisionMaker(commercial.decisionMaker));
  }, [submission]);

  const payload = useMemo(() => {
    const pick = (key: string) => choices[key] ?? [];
    const other = (key: string, source: string) => (pick(source).includes("Other") ? text[key] ?? "" : "");

    return {
      products: selectedProducts,
      customerDetails: {
        companyName: text.companyName ?? "",
        contactPerson: text.contactPerson ?? "",
        department: text.department ?? "",
        designation: text.designation ?? "",
        mobile: text.mobile ?? "",
        email: text.email ?? "",
        website: text.website ?? "",
        address: text.address ?? "",
        cityState: text.cityState ?? "",
        industryType: pick("industry"),
        industryTypeOther: other("industryOther", "industry"),
        existingSupplier: text.existingSupplier ?? "",
        inquirySource: pick("inquirySource"),
      },
      ...(selectedProducts.includes("Syringe Filter")
        ? {
            syringeFilter: {
              filterDiameter: pick("synDiameter"),
              poreSize: pick("synPore"),
              poreSizeOther: other("synPoreOther", "synPore"),
              membraneType: pick("synMembrane"),
              membraneTypeOther: other("synMembraneOther", "synMembrane"),
              housingMaterial: pick("synHousing"),
              housingMaterialOther: other("synHousingOther", "synHousing"),
              individuallyPacked: pick("synPacked")[0] ?? "",
              application: pick("synApplication"),
              applicationOther: other("synApplicationOther", "synApplication"),
              sampleType: pick("synSample"),
              quantityRequired: text.synQty ?? "",
              monthlyConsumption: text.synMonthly ?? "",
              sterile: pick("synSterile")[0] ?? "",
              targetPrice: text.synPrice ?? "",
              requiredDeliveryTime: text.synDelivery ?? "",
            },
          }
        : {}),
      ...(selectedProducts.includes("Capsule")
        ? {
            capsule: {
              capsuleSize: pick("capSize"),
              membraneType: pick("capMembrane"),
              membraneTypeOther: other("capMembraneOther", "capMembrane"),
              poreSize: pick("capPore"),
              poreSizeOther: other("capPoreOther", "capPore"),
              connectionType: pick("capConnection"),
              connectionTypeOther: other("capConnectionOther", "capConnection"),
              flowRateRequirement: text.capFlow ?? "",
              operatingPressure: text.capPressure ?? "",
              application: pick("capApplication"),
              sterile: pick("capSterile")[0] ?? "",
              validationRequirement: text.capValidation ?? "",
              quantityRequired: text.capQty ?? "",
              monthlyConsumption: text.capMonthly ?? "",
              requiredDeliveryTime: text.capDelivery ?? "",
            },
          }
        : {}),
      ...(selectedProducts.includes("Cartridge Filter")
        ? {
            cartridgeFilter: {
              cartridgeLength: pick("cartLength"),
              membraneMedia: pick("cartMedia"),
              membraneMediaOther: other("cartMediaOther", "cartMedia"),
              micronRating: pick("cartMicron"),
              micronRatingOther: other("cartMicronOther", "cartMicron"),
              endConnection: pick("cartEnd"),
              endConnectionOther: other("cartEndOther", "cartEnd"),
              sealMaterial: pick("cartSeal"),
              application: pick("cartApplication"),
              operatingTemperature: text.cartTemp ?? "",
              operatingPressure: text.cartPressure ?? "",
              flowRateRequirement: text.cartFlow ?? "",
              quantityRequired: text.cartQty ?? "",
              monthlyConsumption: text.cartMonthly ?? "",
              validationRequirement: text.cartValidation ?? "",
              requiredDeliveryTime: text.cartDelivery ?? "",
            },
          }
        : {}),
      commercialInfo: {
        requirementType: pick("reqType")[0] ?? "",
        expectedOrderQty: text.expQty ?? "",
        expectedOrderValue: text.expValue ?? "",
        purchaseTimeline: pick("timeline")[0] ?? "",
        decisionMaker,
        techApprovalRequired: pick("techApproval")[0] ?? "",
        sampleRequired: pick("sampleRequired")[0] ?? "",
        sampleDetails: sampleRequired ? text.sampleDetails ?? "" : "",
        followUpDate: text.followUp ?? "",
        competitorBrandInUse: text.competitorBrand ?? "",
      },
    };
  }, [choices, decisionMaker, sampleRequired, selectedProducts, text]);

  const reset = () => {
    setText({});
    setChoices({});
    setDecisionMaker(EMPTY_DM);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(isEdit ? `/api/forms/${submission!.id}` : "/api/forms", {
        method: isEdit ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to save form");

      if (!isEdit) reset();
      setMessage({
        type: "success",
        text: isEdit
          ? "Form updated successfully."
          : `Form submitted successfully. Lead No. ${json.data?.leadNo ?? ""}`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save form." });
    } finally {
      setSubmitting(false);
    }
  };

  const otherInput = (show: boolean, key: string, placeholder = "Please specify") =>
    show ? (
      <div className="mt-2">
        <TextBox value={text[key] ?? ""} onChange={set(key)} placeholder={placeholder} />
      </div>
    ) : null;

  const visitedDate = (() => {
    if (!submission?.visitedDate) return new Date().toLocaleDateString("en-IN");
    const parsed = new Date(submission.visitedDate);
    return Number.isNaN(parsed.getTime())
      ? submission.visitedDate
      : parsed.toLocaleDateString("en-IN");
  })();

  const leadNo = submission?.leadNo || leadPreview || "OML-...";

  return (
    <div className="min-h-screen w-full bg-slate-100 py-8">
      <form
        onSubmit={submit}
        className="mx-auto w-full max-w-[1840px] overflow-visible rounded-2xl border border-slate-200 bg-white px-8 py-8 shadow-xl shadow-slate-900/10"
      >
        <div className="flex flex-col gap-4 rounded-xl bg-[#12508C]/5 px-6 py-5 md:flex-row md:items-center">
          <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/omsons_logo.jpeg" alt="Omsons" className="h-20 w-20 rounded-full object-cover" />
            <span className="mt-1 text-[10px] font-semibold tracking-[0.25em] text-slate-600">GERMANY</span>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h1 className="text-[22px] font-extrabold" style={{ color: BLUE }}>
              OMSONS GLASSWARE PVT. LTD.
            </h1>
            <p className="text-[13px] font-medium text-slate-600">Exploring the Science...</p>
            <p className="mt-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-700">
              Filter Leads
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-slate-700">
          <div className="flex items-center gap-2">
            <span>Lead No.</span>
            <span style={{ color: BLUE }}>{leadNo}</span>
            {!submission?.leadNo ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                (Preview)
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span>Dated</span>
            <span style={{ color: BLUE }}>{visitedDate}</span>
          </div>
        </div>

        <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
          <Row label="Products">
            <MultiSelect
              name="products"
              options={PRODUCTS}
              selected={choices.products ?? []}
              onChange={choose("products")}
            />
          </Row>
          <Row label="Company Name">
            <TextBox value={text.companyName ?? ""} onChange={set("companyName")} />
          </Row>
          <Row label="Contact Person">
            <TextBox value={text.contactPerson ?? ""} onChange={set("contactPerson")} />
          </Row>
          <Row label="Department">
            <TextBox value={text.department ?? ""} onChange={set("department")} />
          </Row>
          <Row label="Designation">
            <TextBox value={text.designation ?? ""} onChange={set("designation")} />
          </Row>
          <Row label="Mobile Number">
            <TextBox value={text.mobile ?? ""} onChange={set("mobile")} />
          </Row>
          <Row label="Email ID">
            <TextBox value={text.email ?? ""} onChange={set("email")} />
          </Row>
          <Row label="Website">
            <TextBox value={text.website ?? ""} onChange={set("website")} />
          </Row>
          <Row label="Address">
            <TextBox value={text.address ?? ""} onChange={set("address")} />
          </Row>
          <Row label="City / State / Country">
            <TextBox value={text.cityState ?? ""} onChange={set("cityState")} />
          </Row>
          <Row label="Industry Type">
            <MultiSelect
              name="industry"
              options={INDUSTRY}
              selected={choices.industry ?? []}
              onChange={choose("industry")}
            />
            {otherInput((choices.industry ?? []).includes("Other"), "industryOther")}
          </Row>
          <Row label="Existing Supplier">
            <TextBox value={text.existingSupplier ?? ""} onChange={set("existingSupplier")} />
          </Row>
          <Row label="Inquiry Source">
            <MultiSelect
              name="inquirySource"
              options={INQUIRY_SOURCE}
              selected={choices.inquirySource ?? []}
              onChange={choose("inquirySource")}
            />
          </Row>
        </div>

        {selectedProducts.includes("Syringe Filter") ? (
          <>
            <SectionTitle>Syringe Filter</SectionTitle>
            <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
              <Row label="Filter Diameter">
                <MultiSelect
                  name="synDiameter"
                  options={SYRINGE_DIAMETER}
                  selected={choices.synDiameter ?? []}
                  onChange={choose("synDiameter")}
                />
              </Row>
              <Row label="Pore Size">
                <MultiSelect
                  name="synPore"
                  options={SYRINGE_PORE}
                  selected={choices.synPore ?? []}
                  onChange={choose("synPore")}
                />
                {otherInput((choices.synPore ?? []).includes("Other"), "synPoreOther")}
              </Row>
              <Row label="Membrane Type">
                <MultiSelect
                  name="synMembrane"
                  options={MEMBRANE_SYRINGE}
                  selected={choices.synMembrane ?? []}
                  onChange={choose("synMembrane")}
                />
                {otherInput((choices.synMembrane ?? []).includes("Other"), "synMembraneOther")}
              </Row>
              <Row label="Housing Material">
                <MultiSelect
                  name="synHousing"
                  options={HOUSING}
                  selected={choices.synHousing ?? []}
                  onChange={choose("synHousing")}
                  multiple={false}
                />
                {otherInput((choices.synHousing ?? []).includes("Other"), "synHousingOther")}
              </Row>
              <Row label="Individually Packed">
                <MultiSelect
                  name="synPacked"
                  options={YES_NO}
                  selected={choices.synPacked ?? []}
                  onChange={choose("synPacked")}
                  multiple={false}
                />
              </Row>
              <Row label="Application">
                <MultiSelect
                  name="synApplication"
                  options={APPLICATION_SYRINGE}
                  selected={choices.synApplication ?? []}
                  onChange={choose("synApplication")}
                />
                {otherInput((choices.synApplication ?? []).includes("Other"), "synApplicationOther")}
              </Row>
              <Row label="Sample Type">
                <MultiSelect
                  name="synSample"
                  options={SAMPLE_TYPE}
                  selected={choices.synSample ?? []}
                  onChange={choose("synSample")}
                />
              </Row>
              <Row label="Quantity Required">
                <TextBox value={text.synQty ?? ""} onChange={set("synQty")} />
              </Row>
              <Row label="Monthly Consumption">
                <TextBox value={text.synMonthly ?? ""} onChange={set("synMonthly")} />
              </Row>
              <Row label="Sterile or Non-Sterile">
                <MultiSelect
                  name="synSterile"
                  options={STERILE}
                  selected={choices.synSterile ?? []}
                  onChange={choose("synSterile")}
                  multiple={false}
                />
              </Row>
              <Row label="Target Price">
                <TextBox value={text.synPrice ?? ""} onChange={set("synPrice")} />
              </Row>
              <Row label="Required Delivery Time">
                <TextBox value={text.synDelivery ?? ""} onChange={set("synDelivery")} />
              </Row>
            </div>
          </>
        ) : null}

        {selectedProducts.includes("Capsule") ? (
          <>
            <SectionTitle>Capsule</SectionTitle>
            <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
              <Row label="Capsule Size">
                <MultiSelect
                  name="capSize"
                  options={CAPSULE_SIZE}
                  selected={choices.capSize ?? []}
                  onChange={choose("capSize")}
                />
              </Row>
              <Row label="Membrane Type">
                <MultiSelect
                  name="capMembrane"
                  options={MEMBRANE_CAPSULE}
                  selected={choices.capMembrane ?? []}
                  onChange={choose("capMembrane")}
                />
                {otherInput((choices.capMembrane ?? []).includes("Other"), "capMembraneOther")}
              </Row>
              <Row label="Pore Size">
                <MultiSelect
                  name="capPore"
                  options={PORE_CAPSULE}
                  selected={choices.capPore ?? []}
                  onChange={choose("capPore")}
                />
                {otherInput((choices.capPore ?? []).includes("Other"), "capPoreOther")}
              </Row>
              <Row label="Connection Type">
                <MultiSelect
                  name="capConnection"
                  options={CONNECTION_TYPE}
                  selected={choices.capConnection ?? []}
                  onChange={choose("capConnection")}
                />
                {otherInput((choices.capConnection ?? []).includes("Other"), "capConnectionOther")}
              </Row>
              <Row label="Flow Rate Requirement">
                <TextBox value={text.capFlow ?? ""} onChange={set("capFlow")} />
              </Row>
              <Row label="Operating Pressure">
                <TextBox value={text.capPressure ?? ""} onChange={set("capPressure")} />
              </Row>
              <Row label="Application (Filtration)">
                <MultiSelect
                  name="capApplication"
                  options={APPLICATION_CAPSULE}
                  selected={choices.capApplication ?? []}
                  onChange={choose("capApplication")}
                />
              </Row>
              <Row label="Sterile or Non-Sterile">
                <MultiSelect
                  name="capSterile"
                  options={STERILE}
                  selected={choices.capSterile ?? []}
                  onChange={choose("capSterile")}
                  multiple={false}
                />
              </Row>
              <Row label="Validation Requirement">
                <TextBox value={text.capValidation ?? ""} onChange={set("capValidation")} />
              </Row>
              <Row label="Quantity Required">
                <TextBox value={text.capQty ?? ""} onChange={set("capQty")} />
              </Row>
              <Row label="Monthly Consumption">
                <TextBox value={text.capMonthly ?? ""} onChange={set("capMonthly")} />
              </Row>
              <Row label="Required Delivery Time">
                <TextBox value={text.capDelivery ?? ""} onChange={set("capDelivery")} />
              </Row>
            </div>
          </>
        ) : null}

        {selectedProducts.includes("Cartridge Filter") ? (
          <>
            <SectionTitle>Cartridge Filter</SectionTitle>
            <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
              <Row label="Cartridge Length">
                <MultiSelect
                  name="cartLength"
                  options={CARTRIDGE_LENGTH}
                  selected={choices.cartLength ?? []}
                  onChange={choose("cartLength")}
                />
              </Row>
              <Row label="Membrane / Media">
                <MultiSelect
                  name="cartMedia"
                  options={MEMBRANE_CAPSULE}
                  selected={choices.cartMedia ?? []}
                  onChange={choose("cartMedia")}
                />
                {otherInput((choices.cartMedia ?? []).includes("Other"), "cartMediaOther")}
              </Row>
              <Row label="Micron Rating">
                <MultiSelect
                  name="cartMicron"
                  options={PORE_CAPSULE}
                  selected={choices.cartMicron ?? []}
                  onChange={choose("cartMicron")}
                />
                {otherInput((choices.cartMicron ?? []).includes("Other"), "cartMicronOther")}
              </Row>
              <Row label="End Connection">
                <MultiSelect
                  name="cartEnd"
                  options={END_CONNECTION}
                  selected={choices.cartEnd ?? []}
                  onChange={choose("cartEnd")}
                  multiple={false}
                />
                {otherInput((choices.cartEnd ?? []).includes("Other"), "cartEndOther")}
              </Row>
              <Row label="Seal Material">
                <MultiSelect
                  name="cartSeal"
                  options={SEAL_MATERIAL}
                  selected={choices.cartSeal ?? []}
                  onChange={choose("cartSeal")}
                  multiple={false}
                />
              </Row>
              <Row label="Application">
                <MultiSelect
                  name="cartApplication"
                  options={APPLICATION_CARTRIDGE}
                  selected={choices.cartApplication ?? []}
                  onChange={choose("cartApplication")}
                />
              </Row>
              <Row label="Operating Temperature">
                <TextBox value={text.cartTemp ?? ""} onChange={set("cartTemp")} />
              </Row>
              <Row label="Operating Pressure">
                <TextBox value={text.cartPressure ?? ""} onChange={set("cartPressure")} />
              </Row>
              <Row label="Flow Rate Requirement">
                <TextBox value={text.cartFlow ?? ""} onChange={set("cartFlow")} />
              </Row>
              <Row label="Quantity Required">
                <TextBox value={text.cartQty ?? ""} onChange={set("cartQty")} />
              </Row>
              <Row label="Monthly Consumption">
                <TextBox value={text.cartMonthly ?? ""} onChange={set("cartMonthly")} />
              </Row>
              <Row label="Validation Requirement">
                <TextBox value={text.cartValidation ?? ""} onChange={set("cartValidation")} />
              </Row>
              <Row label="Required Delivery Time">
                <TextBox value={text.cartDelivery ?? ""} onChange={set("cartDelivery")} />
              </Row>
            </div>
          </>
        ) : null}

        <SectionTitle>Commercial Information</SectionTitle>
        <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
          <Row label="Requirement Type">
            <MultiSelect
              name="reqType"
              options={REQUIREMENT_TYPE}
              selected={choices.reqType ?? []}
              onChange={choose("reqType")}
              multiple={false}
            />
          </Row>
          <Row label="Expected Order Qty.">
            <TextBox value={text.expQty ?? ""} onChange={set("expQty")} />
          </Row>
          <Row label="Expected Order Value">
            <TextBox value={text.expValue ?? ""} onChange={set("expValue")} />
          </Row>
          <Row label="Purchase Timeline">
            <MultiSelect
              name="timeline"
              options={PURCHASE_TIMELINE}
              selected={choices.timeline ?? []}
              onChange={choose("timeline")}
              multiple={false}
            />
          </Row>
          <Row label="Decision Maker">
            <div className="grid gap-2 md:grid-cols-2">
              <TextBox
                value={decisionMaker.name}
                onChange={(value) => setDecisionMaker((prev) => ({ ...prev, name: value }))}
                placeholder="Name"
              />
              <TextBox
                value={decisionMaker.designation}
                onChange={(value) => setDecisionMaker((prev) => ({ ...prev, designation: value }))}
                placeholder="Designation"
              />
              <TextBox
                value={decisionMaker.phone}
                onChange={(value) => setDecisionMaker((prev) => ({ ...prev, phone: value }))}
                placeholder="Phone Number"
              />
              <TextBox
                value={decisionMaker.email}
                onChange={(value) => setDecisionMaker((prev) => ({ ...prev, email: value }))}
                placeholder="Email"
              />
            </div>
          </Row>
          <Row label="Tech. Approval Req.">
            <MultiSelect
              name="techApproval"
              options={YES_NO}
              selected={choices.techApproval ?? []}
              onChange={choose("techApproval")}
              multiple={false}
            />
          </Row>
          <Row label="Sample Required">
            <MultiSelect
              name="sampleRequired"
              options={YES_NO}
              selected={choices.sampleRequired ?? []}
              onChange={choose("sampleRequired")}
              multiple={false}
            />
            {otherInput(sampleRequired, "sampleDetails", "Sample details")}
          </Row>
          <Row label="Follow-up Date">
            <TextBox value={text.followUp ?? ""} onChange={set("followUp")} />
          </Row>
          <Row label="Competitor Brand in Use">
            <TextBox value={text.competitorBrand ?? ""} onChange={set("competitorBrand")} />
          </Row>
        </div>

        {message ? (
          <div
            className={`mt-4 rounded border px-3 py-2 text-[13px] font-semibold ${
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <div className="mt-8 h-[3px] rounded" style={{ background: BLUE }} />
        <div className="flex items-center justify-between px-1 py-6 text-[13px] font-semibold text-slate-700">
          <span>Customer Sign.</span>
          <span>Sales Manager Sign.</span>
        </div>
        <div className="h-[3px] rounded" style={{ background: BLUE }} />

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded bg-[#12508C] px-5 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              "Saving..."
            ) : isEdit ? (
              "Save Changes"
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Submit Form
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
