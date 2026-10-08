export type AdditionalDiscountType = "slab" | "custom" | null;

export type OrderAmountSource = Record<string, unknown> & {
  order_amount?: string | number;
  order_discount?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
  total?: string | number;
  baseDiscountAmount?: string | number;
  base_discount_amount?: string | number;
  baseDiscountPercent?: string | number;
  base_discount_percent?: string | number;
  postBaseAmount?: string | number;
  post_base_amount?: string | number;
  additionalDiscountType?: string | null;
  additional_discount_type?: string | null;
  additionalDiscountAmount?: string | number;
  additional_discount_amount?: string | number;
  customDiscountAmount?: string | number;
  custom_discount_amount?: string | number;
  customDiscountPercent?: string | number;
  custom_discount_percent?: string | number;
  approvedDiscountAmount?: string | number;
  approved_discount_amount?: string | number;
  approvedDiscountPercent?: string | number;
  approved_discount_percent?: string | number;
  allocatedDiscountPercent?: string | number;
  allocated_discount_percent?: string | number;
  couponDiscountPercent?: string | number;
  coupon_discount_percent?: string | number;
  amountBeforeSlab?: string | number;
  amount_before_slab?: string | number;
  slabDiscountAmount?: string | number;
  slab_discount_amount?: string | number;
  slabDiscountPercent?: string | number;
  slab_discount_percent?: string | number;
};

export type ResolvedOrderAmounts = {
  gross: number;
  discountAmount: number;
  netPayable: number;
};

export type ResolvedOrderDiscountBreakdown = ResolvedOrderAmounts & {
  grossAmount: number;
  netPayableAmount: number;
  baseDiscountAmount: number;
  baseDiscountPercent?: number;
  postBaseAmount: number;
  additionalDiscountType: AdditionalDiscountType;
  slabDiscountPercent: number;
  slabDiscountAmount: number;
  customDiscountPercent?: number;
  customDiscountAmount: number;
  additionalDiscountAmount: number;
  hasSlabDiscount: boolean;
  hasCustomDiscount: boolean;
  hasKnownBaseDiscount: boolean;
  hasKnownAdditionalDiscount: boolean;
};

type ResolveOrderDiscountBreakdownOptions = {
  itemDiscountTotal?: number;
};

type DiscountSummaryRow = {
  key: "gross" | "base" | "slab" | "custom" | "total" | "net";
  label: string;
  amount: number;
};

export type CompactOrderDiscountRow = {
  key: "base" | "slab" | "custom" | "none" | "additional" | "total";
  label: string;
  amount?: number;
};

type AdditionalDiscountDisplaySource = {
  additionalDiscountType: AdditionalDiscountType;
  slabDiscountPercent: number;
  slabDiscountAmount: number;
  customDiscountAmount: number;
};

export function toMoneyNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(amount)) return undefined;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function firstMoney(...values: unknown[]) {
  for (const value of values) {
    const amount = toMoneyNumber(value);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCloseMoney(a: number, b: number) {
  return Math.abs(a - b) <= 0.01;
}

function normalizeAdditionalDiscountType(value: unknown): AdditionalDiscountType {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["slab", "flat", "flat/slab"].includes(text)) return "slab";
  if (["custom", "approved", "approved_custom"].includes(text)) return "custom";
  return null;
}

function clampMoney(value: number | undefined) {
  return roundMoney(Math.max(0, value ?? 0));
}

export function resolveOrderAmounts(
  order: OrderAmountSource,
  override?: OrderAmountSource
): ResolvedOrderAmounts {
  const gross = firstMoney(
    override?.grossAmount,
    override?.order_amount,
    order.grossAmount,
    order.order_amount,
    order.total
  ) ?? 0;

  const explicitNet = firstMoney(
    override?.netPayableAmount,
    override?.order_net_amount,
    order.netPayableAmount,
    order.order_net_amount
  );

  const explicitDiscount = firstMoney(
    override?.discountAmount,
    override?.order_discount_amount,
    order.discountAmount,
    order.order_discount_amount
  );

  const legacyPhpNet = firstMoney(
    override?.order_discount,
    order.order_discount
  );

  const netPayable = explicitNet
    ?? (explicitDiscount !== undefined ? Math.max(0, gross - explicitDiscount) : undefined)
    ?? legacyPhpNet
    ?? gross;

  const discountAmount = explicitDiscount ?? Math.max(0, gross - netPayable);

  return {
    gross,
    discountAmount: roundMoney(discountAmount),
    netPayable: roundMoney(netPayable),
  };
}

function deriveSlabPercent(amount: number, postBaseAmount: number) {
  if (!(amount > 0) || !(postBaseAmount > 0)) return 0;
  const percent = roundMoney((amount / postBaseAmount) * 100);
  if (isCloseMoney(percent, 2)) return 2;
  if (isCloseMoney(percent, 5)) return 5;
  return 0;
}

export function resolveOrderDiscountBreakdown(
  order: OrderAmountSource,
  override?: OrderAmountSource,
  options?: ResolveOrderDiscountBreakdownOptions
): ResolvedOrderDiscountBreakdown {
  const amounts = resolveOrderAmounts(order, override);
  const grossAmount = amounts.gross;
  const totalDiscountAmount = amounts.discountAmount;
  const netPayableAmount = amounts.netPayable;

  const explicitType = normalizeAdditionalDiscountType(
    override?.additionalDiscountType
    ?? override?.additional_discount_type
    ?? order.additionalDiscountType
    ?? order.additional_discount_type
  );

  const explicitBaseDiscountAmount = firstMoney(
    override?.baseDiscountAmount,
    override?.base_discount_amount,
    order.baseDiscountAmount,
    order.base_discount_amount
  );

  const explicitBaseDiscountPercent = firstMoney(
    override?.baseDiscountPercent,
    override?.base_discount_percent,
    order.baseDiscountPercent,
    order.base_discount_percent,
    override?.allocatedDiscountPercent,
    override?.allocated_discount_percent,
    order.allocatedDiscountPercent,
    order.allocated_discount_percent
  );

  const explicitPostBaseAmount = firstMoney(
    override?.postBaseAmount,
    override?.post_base_amount,
    order.postBaseAmount,
    order.post_base_amount,
    override?.amountBeforeSlab,
    override?.amount_before_slab,
    order.amountBeforeSlab,
    order.amount_before_slab
  );

  const explicitAdditionalDiscountAmount = firstMoney(
    override?.additionalDiscountAmount,
    override?.additional_discount_amount,
    order.additionalDiscountAmount,
    order.additional_discount_amount
  );

  const explicitCustomDiscountAmount = firstMoney(
    override?.customDiscountAmount,
    override?.custom_discount_amount,
    override?.approvedDiscountAmount,
    override?.approved_discount_amount,
    order.customDiscountAmount,
    order.custom_discount_amount,
    order.approvedDiscountAmount,
    order.approved_discount_amount
  );

  const explicitCustomDiscountPercent = firstMoney(
    override?.customDiscountPercent,
    override?.custom_discount_percent,
    override?.approvedDiscountPercent,
    override?.approved_discount_percent,
    order.customDiscountPercent,
    order.custom_discount_percent,
    order.approvedDiscountPercent,
    order.approved_discount_percent
  );

  const explicitSlabDiscountAmount = firstMoney(
    override?.slabDiscountAmount,
    override?.slab_discount_amount,
    order.slabDiscountAmount,
    order.slab_discount_amount
  );

  const explicitSlabDiscountPercent = firstMoney(
    override?.slabDiscountPercent,
    override?.slab_discount_percent,
    order.slabDiscountPercent,
    order.slab_discount_percent
  );

  const itemDiscountTotal = firstMoney(options?.itemDiscountTotal);

  let baseDiscountAmount = explicitBaseDiscountAmount;
  if (baseDiscountAmount === undefined && explicitPostBaseAmount !== undefined) {
    baseDiscountAmount = clampMoney(grossAmount - explicitPostBaseAmount);
  }
  if (baseDiscountAmount === undefined && explicitBaseDiscountPercent !== undefined) {
    baseDiscountAmount = clampMoney(grossAmount * (explicitBaseDiscountPercent / 100));
  }
  if (
    baseDiscountAmount === undefined &&
    itemDiscountTotal !== undefined &&
    explicitType === null &&
    explicitAdditionalDiscountAmount === undefined &&
    explicitCustomDiscountAmount === undefined &&
    explicitCustomDiscountPercent === undefined &&
    explicitSlabDiscountAmount === undefined &&
    explicitSlabDiscountPercent === undefined
  ) {
    baseDiscountAmount = clampMoney(itemDiscountTotal);
  }

  let additionalDiscountType: AdditionalDiscountType = explicitType;

  if (!additionalDiscountType) {
    const hasExplicitCustom = (explicitCustomDiscountAmount ?? 0) > 0 || (explicitCustomDiscountPercent ?? 0) > 0;
    const hasExplicitSlab = (explicitSlabDiscountAmount ?? 0) > 0 || (explicitSlabDiscountPercent ?? 0) > 0;

    if (hasExplicitCustom !== hasExplicitSlab) {
      additionalDiscountType = hasExplicitCustom ? "custom" : "slab";
    } else if ((explicitAdditionalDiscountAmount ?? 0) > 0) {
      if (hasExplicitCustom && !hasExplicitSlab) additionalDiscountType = "custom";
      if (hasExplicitSlab && !hasExplicitCustom) additionalDiscountType = "slab";
    }
  }

  if (!additionalDiscountType && baseDiscountAmount !== undefined) {
    const unresolvedAdditionalAmount = roundMoney(Math.max(0, totalDiscountAmount - baseDiscountAmount));
    if (unresolvedAdditionalAmount <= 0.01) {
      additionalDiscountType = null;
    } else if (
      explicitSlabDiscountAmount !== undefined &&
      isCloseMoney(unresolvedAdditionalAmount, explicitSlabDiscountAmount)
    ) {
      additionalDiscountType = "slab";
    } else if (
      explicitCustomDiscountAmount !== undefined &&
      isCloseMoney(unresolvedAdditionalAmount, explicitCustomDiscountAmount)
    ) {
      additionalDiscountType = "custom";
    } else if (
      explicitPostBaseAmount !== undefined &&
      explicitSlabDiscountPercent !== undefined &&
      isCloseMoney(
        unresolvedAdditionalAmount,
        clampMoney(explicitPostBaseAmount * (explicitSlabDiscountPercent / 100))
      )
    ) {
      additionalDiscountType = "slab";
    }
  }

  if (baseDiscountAmount === undefined) {
    if (!additionalDiscountType) {
      baseDiscountAmount = totalDiscountAmount;
    } else if (additionalDiscountType === "slab") {
      const slabAmount = explicitSlabDiscountAmount ?? explicitAdditionalDiscountAmount ?? 0;
      baseDiscountAmount = clampMoney(totalDiscountAmount - slabAmount);
    } else {
      const customAmount = explicitCustomDiscountAmount ?? explicitAdditionalDiscountAmount ?? 0;
      baseDiscountAmount = clampMoney(totalDiscountAmount - customAmount);
    }
  }

  const postBaseAmount = clampMoney(
    explicitPostBaseAmount
    ?? (grossAmount - baseDiscountAmount)
  );

  let slabDiscountAmount = 0;
  let customDiscountAmount = 0;

  if (additionalDiscountType === "slab") {
    slabDiscountAmount = clampMoney(
      explicitSlabDiscountAmount
      ?? explicitAdditionalDiscountAmount
      ?? (totalDiscountAmount - baseDiscountAmount)
    );
  } else if (additionalDiscountType === "custom") {
    customDiscountAmount = clampMoney(
      explicitCustomDiscountAmount
      ?? explicitAdditionalDiscountAmount
      ?? (totalDiscountAmount - baseDiscountAmount)
    );
  }

  if (!additionalDiscountType) {
    slabDiscountAmount = 0;
    customDiscountAmount = 0;
  }

  const additionalDiscountAmount = clampMoney(
    additionalDiscountType === "slab" ? slabDiscountAmount
      : additionalDiscountType === "custom" ? customDiscountAmount
        : 0
  );

  const slabDiscountPercent = clampMoney(
    explicitSlabDiscountPercent
    ?? deriveSlabPercent(slabDiscountAmount, postBaseAmount)
  );

  const customDiscountPercent = additionalDiscountType === "custom"
    ? firstMoney(
        override?.customDiscountPercent,
        override?.custom_discount_percent,
        override?.approvedDiscountPercent,
        override?.approved_discount_percent,
        order.customDiscountPercent,
        order.custom_discount_percent,
        order.approvedDiscountPercent,
        order.approved_discount_percent
      )
    : undefined;

  const baseDiscountPercent = explicitBaseDiscountPercent
    ?? (
      grossAmount > 0 && baseDiscountAmount > 0
        ? roundMoney((baseDiscountAmount / grossAmount) * 100)
        : undefined
    );

  return {
    ...amounts,
    grossAmount,
    netPayableAmount,
    baseDiscountAmount: clampMoney(baseDiscountAmount),
    baseDiscountPercent,
    postBaseAmount,
    additionalDiscountType,
    slabDiscountPercent,
    slabDiscountAmount,
    customDiscountPercent,
    customDiscountAmount,
    additionalDiscountAmount,
    hasSlabDiscount: additionalDiscountType === "slab" && slabDiscountAmount > 0,
    hasCustomDiscount: additionalDiscountType === "custom" && customDiscountAmount > 0,
    hasKnownBaseDiscount: explicitBaseDiscountAmount !== undefined
      || explicitBaseDiscountPercent !== undefined
      || explicitPostBaseAmount !== undefined
      || itemDiscountTotal !== undefined
      || !additionalDiscountType,
    hasKnownAdditionalDiscount: additionalDiscountType !== null,
  };
}

export function getOrderDiscountSummaryRows(
  breakdown: ResolvedOrderDiscountBreakdown,
  labels?: { net?: string }
): DiscountSummaryRow[] {
  const rows: DiscountSummaryRow[] = [
    { key: "gross", label: "Gross Amount", amount: breakdown.grossAmount },
    {
      key: "base",
      label: breakdown.baseDiscountPercent !== undefined
        ? `Base Discount (${breakdown.baseDiscountPercent}%)`
        : "Base Discount",
      amount: breakdown.baseDiscountAmount,
    },
  ];

  if (breakdown.additionalDiscountType === "slab" && breakdown.slabDiscountAmount > 0) {
    rows.push({
      key: "slab",
      label: breakdown.slabDiscountPercent > 0
        ? `Slab Discount (${breakdown.slabDiscountPercent}%)`
        : "Slab Discount",
      amount: breakdown.slabDiscountAmount,
    });
  }

  if (breakdown.additionalDiscountType === "custom" && breakdown.customDiscountAmount > 0) {
    rows.push({
      key: "custom",
      label: "Approved Custom Discount",
      amount: breakdown.customDiscountAmount,
    });
  }

  rows.push(
    { key: "total", label: "Total Discount", amount: breakdown.discountAmount },
    { key: "net", label: labels?.net ?? "Net Payable", amount: breakdown.netPayableAmount }
  );

  return rows;
}

export function getCompactOrderDiscountRows(
  breakdown: ResolvedOrderDiscountBreakdown
): CompactOrderDiscountRow[] {
  const rows: CompactOrderDiscountRow[] = [
    {
      key: "base",
      label: breakdown.baseDiscountPercent !== undefined
        ? `Base ${breakdown.baseDiscountPercent}%`
        : "Base",
      amount: breakdown.baseDiscountAmount,
    },
  ];

  if (breakdown.additionalDiscountType === "slab" && breakdown.slabDiscountAmount > 0) {
    rows.push({
      key: "slab",
      label: breakdown.slabDiscountPercent > 0
        ? `Slab ${breakdown.slabDiscountPercent}%`
        : "Slab",
      amount: breakdown.slabDiscountAmount,
    });
  } else if (breakdown.additionalDiscountType === "custom" && breakdown.customDiscountAmount > 0) {
    rows.push({
      key: "custom",
      label: "Approved Custom",
      amount: breakdown.customDiscountAmount,
    });
  } else if (
    breakdown.hasKnownBaseDiscount &&
    !breakdown.hasKnownAdditionalDiscount &&
    breakdown.discountAmount > breakdown.baseDiscountAmount + 0.01
  ) {
    rows.push({
      key: "additional",
      label: "Additional Discount",
      amount: roundMoney(breakdown.discountAmount - breakdown.baseDiscountAmount),
    });
  } else {
    rows.push({ key: "none", label: "No Additional Discount" });
  }

  rows.push({
    key: "total",
    label: "Total",
    amount: breakdown.discountAmount,
  });

  return rows;
}

export function formatAdditionalDiscountBadge(breakdown: AdditionalDiscountDisplaySource): string | null {
  if (breakdown.additionalDiscountType === "slab" && breakdown.slabDiscountAmount > 0) {
    const percentText = breakdown.slabDiscountPercent > 0
      ? `${breakdown.slabDiscountPercent}%`
      : "";
    return `slab ${percentText}`.trim() + ` · ${formatCurrency(breakdown.slabDiscountAmount)}`;
  }

  if (breakdown.additionalDiscountType === "custom" && breakdown.customDiscountAmount > 0) {
    return `Custom · ${formatCurrency(breakdown.customDiscountAmount)}`;
  }

  return null;
}

export function getReadableAdditionalDiscountText(
  breakdown: AdditionalDiscountDisplaySource
): string | null {
  if (breakdown.additionalDiscountType === "slab" && breakdown.slabDiscountAmount > 0) {
    const percentText = breakdown.slabDiscountPercent > 0
      ? `${breakdown.slabDiscountPercent}%`
      : "flat";
    return `slab discount applied: ${percentText} (Rs. ${formatAmountText(breakdown.slabDiscountAmount)})`;
  }

  if (breakdown.additionalDiscountType === "custom" && breakdown.customDiscountAmount > 0) {
    return `Approved custom discount applied: Rs. ${formatAmountText(breakdown.customDiscountAmount)}`;
  }

  return null;
}

function formatCurrency(amount: number) {
  return `₹${formatAmountText(amount)}`;
}

function formatAmountText(amount: number) {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function withDisplayOrderAmounts<T extends OrderAmountSource>(
  order: T,
  override?: OrderAmountSource
): T & {
  order_amount: string;
  order_discount: string;
  order_discount_amount: string;
  order_net_amount: string;
  gross: number;
  grossAmount: number;
  discountAmount: number;
  netPayable: number;
  netPayableAmount: number;
  baseDiscountAmount: number;
  baseDiscountPercent?: number;
  postBaseAmount: number;
  additionalDiscountType: AdditionalDiscountType;
  additionalDiscountAmount: number;
  customDiscountAmount: number;
  customDiscountPercent?: number;
  slabDiscountAmount: number;
  slabDiscountPercent: number;
  hasSlabDiscount: boolean;
  hasCustomDiscount: boolean;
  hasKnownBaseDiscount: boolean;
  hasKnownAdditionalDiscount: boolean;
  priceSource: "summary_override" | "php";
} {
  const amounts = resolveOrderDiscountBreakdown(order, override);

  return {
    ...order,
    order_amount: String(amounts.grossAmount),
    order_discount: String(amounts.discountAmount),
    order_discount_amount: String(amounts.discountAmount),
    order_net_amount: String(amounts.netPayableAmount),
    gross: amounts.gross,
    grossAmount: amounts.grossAmount,
    discountAmount: amounts.discountAmount,
    netPayable: amounts.netPayable,
    netPayableAmount: amounts.netPayableAmount,
    baseDiscountAmount: amounts.baseDiscountAmount,
    baseDiscountPercent: amounts.baseDiscountPercent,
    postBaseAmount: amounts.postBaseAmount,
    additionalDiscountType: amounts.additionalDiscountType,
    additionalDiscountAmount: amounts.additionalDiscountAmount,
    customDiscountAmount: amounts.customDiscountAmount,
    customDiscountPercent: amounts.customDiscountPercent,
    slabDiscountAmount: amounts.slabDiscountAmount,
    slabDiscountPercent: amounts.slabDiscountPercent,
    hasSlabDiscount: amounts.hasSlabDiscount,
    hasCustomDiscount: amounts.hasCustomDiscount,
    hasKnownBaseDiscount: amounts.hasKnownBaseDiscount,
    hasKnownAdditionalDiscount: amounts.hasKnownAdditionalDiscount,
    priceSource: override ? "summary_override" : "php",
  };
}
