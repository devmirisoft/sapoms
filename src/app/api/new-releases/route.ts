import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

// Only products added via Pages/products on/after this date count as new releases.
const NEW_RELEASES_SINCE = new Date("2026-10-08T00:00:00+05:30");

// Public: the newest active products, for the homepage and header "New Releases".
// SKU follows the hot-items convention so /Products/[sku] resolves it.
export async function GET() {
  try {
    const products = await prisma.product.findMany({
      where: { active: true, createdAt: { gte: NEW_RELEASES_SINCE } },
      include: { variants: { where: { active: true }, orderBy: { id: "asc" }, take: 1 } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Catalogue rows repeat a name per size, so over-fetch and keep one per name.
      take: 200,
    });
    const seen = new Set<string>();
    const items = products
      .map((product) => {
        const variant = product.variants[0];
        return {
          SKU: variant?.sku || variant?.catalogueNumber || product.productCode || "",
          name: product.name,
          image: product.imageUrl || "",
          badge: "New",
        };
      })
      .filter((item) => item.SKU && !seen.has(item.name) && seen.add(item.name))
      .slice(0, 6);
    return NextResponse.json({ success: true, data: { items } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/new-releases]", error);
    return NextResponse.json({ success: false, message: "Unable to load new releases" }, { status: 500 });
  }
}
