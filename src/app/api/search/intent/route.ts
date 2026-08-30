import { NextRequest, NextResponse } from "next/server";

const roleRouteMap = {
  admin: {
    dealer: "/dashboard/admin/dealer/DealerList",
    dealers: "/dashboard/admin/dealer/DealerList",
    "add dealer": "/dashboard/admin/dealer/AddDealerForm",
    staff: "/dashboard/admin/staff/stafflist",
    "add staff": "/dashboard/admin/staff/addstaff",
    orders: "/orders",
    "outstanding orders": "/Pages/Ordermanagement/outstandingorders",
    products: "/Pages/products",
    "add product": "/Pages/products/addproducts",
    cart: "/Pages/Cart",
    invoices: "/orders",
    slider: "/dashboard/admin/slider",
    dashboard: "/dashboard/admin",
  },
  dealer: {
    orders: "/dashboard/dealer",
    "add order": "/dashboard/dealer/AddOrderForm",
    products: "/Pages/products",
    cart: "/Pages/Cart",
    invoices: "/orders",
    dashboard: "/dashboard/dealer",
  },
  staff: {
    orders: "/dashboard/staff",
    "order status": "/dashboard/staff/orderstatus",
    "pdf post": "/dashboard/staff/staffpdfpost",
    products: "/Pages/products",
    "staff management": "/Pages/staffmanagement",
    invoices: "/orders",
    dashboard: "/dashboard/staff",
  },
};

export async function POST(req: NextRequest) {
  const { query, role, apiResults } = await req.json();
  const routeMap = roleRouteMap[role as keyof typeof roleRouteMap] ?? {};

  const prompt = `
You are a navigation assistant for a dealer management system.
Role: ${role}
User query: "${query}"

Available routes:
${Object.entries(routeMap).map(([k, v]) => `- "${k}" → ${v}`).join("\n")}

Live results found:
${apiResults.slice(0, 3).map((r: any) => `- [${r.category}] ${r.label} → ${r.route}`).join("\n") || "none"}

Reply ONLY as JSON:
{"intent":"","route":"","confidence":<0.0-1.0>}

Rules:
- If live results match query, prefer their specific routes
- If query is a page name, use the route map
- If no match, set route to null and confidence below 0.5`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
      }),
    }
  );

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return NextResponse.json(JSON.parse(text.replace(/```json|```/g, "").trim()));
  } catch {
    return NextResponse.json({ intent: query, route: null, confidence: 0 });
  }
}