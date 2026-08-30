"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
type Role = "admin" | "dealer" | "staff" | "accountant";

export interface SearchResult {
  id: string | number;
  label: string;
  sublabel?: string;
  route: string;
  category: string;
  badge?: string;
}

interface UserContext {
  role: Role;
  id?: string | number;
}

const roleRouteMap: Record<Role, Record<string, string>> = {
  admin: {
    dealer: "/dashboard/admin/dealer/DealerList",
    dealers: "/dashboard/admin/dealer/DealerList",
    "add dealer": "/dashboard/admin/dealer/AddDealerForm",
    "dealer detail": "/dashboard/admin/dealer/[id]",
    staff: "/dashboard/admin/staff/stafflist",
    "add staff": "/dashboard/admin/staff/addstaff",
    "staff detail": "/dashboard/admin/staff/[id]",
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
    "my orders": "/dashboard/dealer",
    products: "/Products",
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
    "staff list": "/Pages/staffmanagement/stafflist",
    "add staff": "/Pages/staffmanagement/addstaff",
    invoices: "/orders",
    dashboard: "/dashboard/staff",
  },
  accountant: {
    orders: "/dashboard/accountant",
    dashboard: "/dashboard/accountant",
  },
};

function mapDashboardResults(raw: any[], role: Role): SearchResult[] {
  return raw
    .slice(0, 12)
    .map((item) => ({
      id: item.id ?? "",
      label: item.title ?? "Result",
      sublabel: item.subtitle ?? item.metadata ?? "",
      route: item.href ?? roleRouteMap[role].dashboard,
      category: `${item.type ?? "results"}${item.type === "staff" ? "" : "s"}`,
      badge: item.type ?? "result",
    }))
    .filter((item) => Boolean(item.id && item.route));
}

async function callGemini(
  query: string,
  role: Role,
  apiResults: SearchResult[]
): Promise<{ intent: string; route?: string; confidence: number }> {
  const routeMap = roleRouteMap[role];
  const prompt = `
You are a navigation assistant for a dealer management system.
Role: ${role}
User query: "${query}"

Available routes for this role:
${Object.entries(routeMap)
  .map(([k, v]) => `- "${k}" -> ${v}`)
  .join("\n")}

Live search results found:
${apiResults.slice(0, 3).map((r) => `- [${r.category}] ${r.label} -> ${r.route}`).join("\n") || "none"}

Task: Determine the user's navigation intent. Reply ONLY as JSON:
{
  "intent": "<short description>",
  "route": "<best matching route or null>",
  "confidence": <0.0-1.0>
}

Rules:
- If live results exist and match the query, prefer their specific routes
- If query is a page name like "dealers", "staff", "orders" etc., use the route map
- If no match found, set route to null and confidence below 0.5
`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { intent: query, route: undefined, confidence: 0 };
  }
}

export function useSmartSearch(userCtx: UserContext) {
  const router = useRouter();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [geminiSuggestion, setGeminiSuggestion] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const timer = window.setTimeout(() => {
      setResults([]);
      setGeminiSuggestion(null);
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userCtx.id, userCtx.role]);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults([]);
        setGeminiSuggestion(null);
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const response = await fetch(`/api/dashboard-search?q=${encodeURIComponent(query)}`, {
            cache: "no-store",
          });
          const json = response.ok ? await response.json() : { results: [] };
          const mappedResults = mapDashboardResults(Array.isArray(json.results) ? json.results : [], userCtx.role);
          setResults(mappedResults);

          const gemini = await callGemini(query, userCtx.role, mappedResults);
          setGeminiSuggestion(gemini.route ?? null);
        } finally {
          setLoading(false);
        }
      }, 350);
    },
    [userCtx]
  );

  const navigate = useCallback(
    (route: string) => {
      setResults([]);
      setGeminiSuggestion(null);
      router.push(route);
    },
    [router]
  );

  const navigateToGeminiSuggestion = useCallback(() => {
    if (geminiSuggestion) navigate(geminiSuggestion);
  }, [geminiSuggestion, navigate]);

  return {
    results,
    loading,
    geminiSuggestion,
    search,
    navigate,
    navigateToGeminiSuggestion,
  };
}
