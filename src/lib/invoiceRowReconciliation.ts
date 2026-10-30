import type { ResolvedOrderAmounts, ResolvedOrderDiscountBreakdown } from "@/lib/orderAmounts";

export type InvoiceRowStage = {
    grossAmount: number;
    stagedDiscountAmount: number;
    stagedNetAmount: number;
    quantity: number;
    packSize: number;
    pieces: number;
    description: string;
    productUnit: string;
};

export type InvoiceRowReconciled = InvoiceRowStage & {
    discountAmount: number;
    netAmount: number;
    discountAdjustmentAmount: number;
};

export type ReconcileInvoiceRowAmountsInput = {
    rows: InvoiceRowStage[];
    amounts: ResolvedOrderAmounts;
    discountBreakdown: ResolvedOrderDiscountBreakdown;
    useAuthoritativeTotals: boolean;
};

export type ReconcileInvoiceRowAmountsResult = {
    rows: InvoiceRowReconciled[];
    totals: {
        grossAmount: number;
        discountAmount: number;
        netAmount: number;
    };
    stageTotals: {
        grossAmount: number;
        discountAmount: number;
        netAmount: number;
    };
    reconciled: boolean;
};

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toPaise(value: number): number {
    return Math.round(roundMoney(value) * 100);
}

function fromPaise(value: number): number {
    return roundMoney(value / 100);
}

function sumPaise(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0);
}

export function reconcileInvoiceRowAmounts({
    rows,
    amounts,
    discountBreakdown,
    useAuthoritativeTotals,
}: ReconcileInvoiceRowAmountsInput): ReconcileInvoiceRowAmountsResult {
    const stageTotals = rows.reduce(
        (acc, row) => {
            acc.grossAmount += row.grossAmount;
            acc.discountAmount += row.stagedDiscountAmount;
            acc.netAmount += row.stagedNetAmount;
            return acc;
        },
        {
            grossAmount: 0,
            discountAmount: 0,
            netAmount: 0,
        }
    );
    const normalizedStageTotals = {
        grossAmount: roundMoney(stageTotals.grossAmount),
        discountAmount: roundMoney(stageTotals.discountAmount),
        netAmount: roundMoney(stageTotals.netAmount),
    };

    const authoritativeTotals = {
        grossAmount: roundMoney(amounts.gross),
        discountAmount: roundMoney(amounts.discountAmount),
        netAmount: roundMoney(amounts.netPayable),
    };

    // Every discount (base, slab, custom) comes off gross, so the lines' gross always
    // adds up to the order's. A gap means a line was priced from the wrong fields, and
    // its printed discount would be wrong too, so refuse rather than print it.
    const grossGapPaise = Math.abs(toPaise(stageTotals.grossAmount) - toPaise(authoritativeTotals.grossAmount));
    if (rows.length > 0 && authoritativeTotals.grossAmount > 0 && grossGapPaise > rows.length) {
        throw new Error("Invoice lines don't add up to the order's gross total, so the invoice was not generated.");
    }

    if (!useAuthoritativeTotals || rows.length === 0) {
        return {
            rows: rows.map((row) => ({
                ...row,
                discountAmount: roundMoney(row.stagedDiscountAmount),
                netAmount: roundMoney(row.stagedNetAmount),
                discountAdjustmentAmount: 0,
            })),
            totals: normalizedStageTotals,
            stageTotals: normalizedStageTotals,
            reconciled: false,
        };
    }

    const stageDiscountPaise = toPaise(stageTotals.discountAmount);
    const targetDiscountPaise = toPaise(authoritativeTotals.discountAmount);
    const stagedMatchesBase = stageDiscountPaise === toPaise(discountBreakdown.baseDiscountAmount);
    const stagedMatchesFull = stageDiscountPaise === targetDiscountPaise;
    const deltaPaise = stagedMatchesBase
        ? toPaise(discountBreakdown.additionalDiscountAmount)
        : targetDiscountPaise - stageDiscountPaise;

    if (
        deltaPaise === 0 ||
        stagedMatchesFull ||
        stageDiscountPaise === toPaise(discountBreakdown.discountAmount)
    ) {
        const normalizedRows = rows.map((row) => ({
            ...row,
            discountAmount: roundMoney(row.stagedDiscountAmount),
            netAmount: roundMoney(row.stagedNetAmount),
            discountAdjustmentAmount: 0,
        }));

        return {
            rows: normalizedRows,
            totals: authoritativeTotals,
            stageTotals: normalizedStageTotals,
            reconciled: false,
        };
    }

    const adjustmentWeights = rows.map((row) => {
        if (deltaPaise > 0) {
            return Math.max(0, toPaise(row.stagedNetAmount));
        }
        return Math.max(0, toPaise(row.stagedDiscountAmount));
    });

    const totalWeight = sumPaise(adjustmentWeights);
    const rowAdjustments = new Array(rows.length).fill(0);
    let remainingDelta = deltaPaise;

    rows.forEach((_, index) => {
        if (index === rows.length - 1) {
            rowAdjustments[index] = remainingDelta;
            return;
        }

        const weight = adjustmentWeights[index];
        const rawAdjustment = totalWeight > 0 ? (deltaPaise * weight) / totalWeight : 0;
        const adjustment = deltaPaise > 0
            ? Math.floor(rawAdjustment)
            : Math.ceil(rawAdjustment);
        rowAdjustments[index] = adjustment;
        remainingDelta -= adjustment;
    });

    const reconciledRows = rows.map((row, index) => {
        const stagedDiscountPaise = toPaise(row.stagedDiscountAmount);
        const grossPaise = toPaise(row.grossAmount);
        const discountPaise = Math.min(
            grossPaise,
            Math.max(0, stagedDiscountPaise + rowAdjustments[index])
        );
        const netPaise = Math.max(0, grossPaise - discountPaise);

        return {
            ...row,
            discountAmount: fromPaise(discountPaise),
            netAmount: fromPaise(netPaise),
            discountAdjustmentAmount: fromPaise(discountPaise - stagedDiscountPaise),
        };
    });

    const finalTotals = {
        grossAmount: authoritativeTotals.grossAmount,
        discountAmount: authoritativeTotals.discountAmount,
        netAmount: authoritativeTotals.netAmount,
    };

    return {
        rows: reconciledRows,
        totals: finalTotals,
        stageTotals: normalizedStageTotals,
        reconciled: true,
    };
}
