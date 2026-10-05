export type Audience = "dealer" | "internal";

// Dealers order through the assistant; everyone else reads reports with it.
export const COPY: Record<Audience, { title: string; subtitle: string; intro: string; suggestions: string[] }> = {
  dealer: {
    title: "Ordering assistant",
    subtitle: "Prices, products and orders",
    intro: "Ask about a product, its price, or start an order.",
    suggestions: ["What is my price for OM285-020?", "Show my recent orders", "What is my outstanding balance?"],
  },
  internal: {
    title: "Reports assistant",
    subtitle: "Sales, dealers, orders and dues",
    intro: "Ask about sales, dealers, orders or outstanding bills.",
    suggestions: ["Sales this month by region", "Which dealers are overdue?", "What's pending my approval?"],
  },
};
