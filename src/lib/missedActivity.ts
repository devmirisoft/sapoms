// What happened in the order flow while a user was logged out. Deliberately
// free of imports so the node test can transpile and load it on its own.
//   Dealer -> RSM:  a dealer placed an order          (RSM sees it)
//   RSM -> Staff:   the RSM approved/declined an order (Staff/ASM see it)
//   Staff -> Dealer: staff accepted/declined/dispatched (Dealer sees it)

export type MissedActivityOrder = {
  id: string;
  orderNumber: string;
  dealerName: string;
  createdAt: Date;
  rsmApprovalStatus: string;
  rsmReviewedAt: Date | null;
  rsmReviewedByName: string | null;
  acceptanceStatus: string;
  acceptanceReviewedAt: Date | null;
  acceptanceReviewedByName: string | null;
  dispatchedAt: Date | null;
};

export type MissedActivity = {
  at: string;
  orderId: string;
  type: "success" | "error" | "info";
  title: string;
  description: string;
};

export function buildMissedActivity(role: string, orders: MissedActivityOrder[], since: Date, until: Date): MissedActivity[] {
  const inWindow = (at: Date | null): at is Date => !!at && at > since && at <= until;
  const items: MissedActivity[] = [];
  const push = (order: MissedActivityOrder, at: Date, type: MissedActivity["type"], title: string, description: string) =>
    items.push({ at: at.toISOString(), orderId: order.id, type, title, description });

  for (const order of orders) {
    if (role === "RSM" && inWindow(order.createdAt)) {
      push(order, order.createdAt, "info", `New order ${order.orderNumber}`, `${order.dealerName} placed an order`);
    }

    if ((role === "STAFF" || role === "ASM") && inWindow(order.rsmReviewedAt) && order.rsmApprovalStatus !== "AWAITING") {
      const approved = order.rsmApprovalStatus === "ACCEPTED";
      push(order, order.rsmReviewedAt, approved ? "success" : "error",
        `Order ${order.orderNumber} ${approved ? "approved" : "declined"} by RSM`,
        [order.rsmReviewedByName, order.dealerName].filter(Boolean).join(" · "));
    }

    if (role === "DEALER") {
      if (inWindow(order.acceptanceReviewedAt) && order.acceptanceStatus !== "AWAITING") {
        const accepted = order.acceptanceStatus === "ACCEPTED";
        push(order, order.acceptanceReviewedAt, accepted ? "success" : "error",
          `Order ${order.orderNumber} ${accepted ? "accepted" : "declined"}`,
          order.acceptanceReviewedByName ? `by ${order.acceptanceReviewedByName}` : "");
      }
      if (inWindow(order.dispatchedAt)) {
        push(order, order.dispatchedAt, "success", `Order ${order.orderNumber} dispatched`, "Your order is on its way");
      }
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}
