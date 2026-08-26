"use client";

import { GiHamburgerMenu } from "react-icons/gi";
import { useState, useEffect, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import moment from "moment";
import { ImageSlider } from "@/components/ImageSlider";
import { bottleProducts, CATEGORY_CARDS } from "@/Assets/dataset";
import { SIDEBAR_CATEGORIES } from "@/lib/categories";
import Footer from "@/components/Footer";
import Link from "next/link";
import axios from "axios";
import { OrderAmountSource, withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import { useAuthSession } from "@/hooks/useAuthSession";
// import { getRecentlyViewed, pushRecentlyViewed, type RecentlyViewedItem } from "@/components/Header";

import { getRecentlyViewed, pushRecentlyViewed, type RecentlyViewedItem } from "@/components/Header";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEHOLDER_IMAGE =
  "https://omsonslabs.com/wp-content/uploads/Pycnometers-Class-A-Individual-Work-Certificate-product-image.webp";

const HOT_BADGES = ["🔥 Bestseller", "⚡ Fast moving", "🔥 Trending", "⚡ Popular", "🔥 Top rated", "⚡ Hot pick"];

const HOME_NAV_LINKS = [
  { label: "Beakers", href: "/Products?cat=Beakers" },
  { label: "Flasks", href: "/Products?cat=Flasks" },
  { label: "Bottles", href: "/Products?cat=Bottles" },
  { label: "Pipettes", href: "/Products?cat=Pipettes" },
  { label: "Burettes", href: "/Products?cat=Burettes" },
  { label: "Thermometers", href: "/Products?cat=Thermometers" },
  { label: "Lab Instruments", href: "/Products?cat=Lab%20Instruments" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonProduct {
  SKU?: number | string;
  Name?: string;
  Images?: string[];
  sku?: number | string;
  name?: string;
  images?: string[];
  Categories?: string[];
  variants?: Array<{
    SKU?: number | string;
    sku?: number | string;
    name?: string;
    Name?: string;
    images?: string[];
    Images?: string[];
  }>;
}

interface CategoryCardItem {
  label: string;
  imageUrl: string;
}

interface CategoryCard {
  title: string;
  items: CategoryCardItem[];
  link: string;
}

interface RelatedProductDisplay {
  name: string;
  image: string;
  routeSku: string;
}

interface HotItemDisplay {
  SKU: string;
  Name: string;
  image: string;
  badge: string;
}

type PublishedHotItem = { id: string; SKU: string; name: string; image: string; badge: string; active: boolean };

type Order = {
  order_id: string;
  order_date: string;
  order_amount: string | number;
  order_discount: string | number;
  Dealer_Name: string;
  orderdata_item_quantity: string;
  mtstatus: string;
  outstandingDate: string;
  reason?: string;
  order_dealer?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
};

type OrderSummaryOverride = OrderAmountSource & { orderId?: string; order_id?: string };

type ApiResponse = {
  msg: string;
  count: number;
  status: boolean;
  data: Order[];
};

type CatalogRouteResolver = {
  findRouteSku: (skuOrName: string) => string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchOrders(id: string): Promise<ApiResponse> {
  const r = await fetch(`/api/orders-data?page=1&limit=10&search=`);
  if (!r.ok) throw new Error("Failed to fetch orders");
  return r.json();
}

function firstImage(item: { images?: string[]; Images?: string[] } | null | undefined): string {
  return (item?.images ?? item?.Images ?? []).find(Boolean) ?? "";
}

function productSku(product: JsonProduct): string {
  return String(product.sku ?? product.SKU ?? "").trim();
}

function productName(product: JsonProduct): string {
  return String(product.name ?? product.Name ?? "").trim();
}

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCatalogLookups(products: JsonProduct[]) {
  const imageMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  const routeMap = new Map<string, string>();
  const fallbackProducts: HotItemDisplay[] = [];

  for (const product of products) {
    const sku = productSku(product);
    const name = productName(product);
    const image = firstImage(product);
    if (!sku || !name) continue;

    imageMap.set(sku.toLowerCase(), image);
    nameMap.set(sku.toLowerCase(), name);
    routeMap.set(sku.toLowerCase(), sku);
    routeMap.set(normalizeLookupKey(name), sku);
    if (image) {
      fallbackProducts.push({
        SKU: sku,
        Name: name,
        image,
        badge: HOT_BADGES[fallbackProducts.length % HOT_BADGES.length],
      });
    }

    for (const variant of product.variants ?? []) {
      const variantSku = String(variant.sku ?? variant.SKU ?? "").trim();
      const variantName = String(variant.name ?? variant.Name ?? name).trim() || name;
      if (!variantSku) continue;
      imageMap.set(variantSku.toLowerCase(), firstImage(variant) || image);
      nameMap.set(variantSku.toLowerCase(), variantName);
      routeMap.set(variantSku.toLowerCase(), variantSku);
      routeMap.set(normalizeLookupKey(variantName), variantSku);
    }
  }

  const resolver: CatalogRouteResolver = {
    findRouteSku(skuOrName: string) {
      const raw = String(skuOrName ?? "").trim();
      if (!raw) return null;

      return (
        routeMap.get(raw.toLowerCase()) ||
        routeMap.get(normalizeLookupKey(raw)) ||
        null
      );
    },
  };

  return { imageMap, nameMap, fallbackProducts, resolver };
}

function buildRelatedProducts(products: typeof bottleProducts, resolver: CatalogRouteResolver): RelatedProductDisplay[] {
  return products
    .map((product) => {
      const routeSku = resolver.findRouteSku(product.name);
      if (!routeSku) return null;

      return {
        name: product.name,
        image: product.image,
        routeSku,
      } satisfies RelatedProductDisplay;
    })
    .filter((product): product is RelatedProductDisplay => product !== null);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const statusConf: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  inprocess: { label: "In Process", dot: "bg-amber-400", text: "text-amber-800", bg: "bg-amber-50 border-amber-200" },
  processing: { label: "Processing", dot: "bg-blue-400", text: "text-blue-800", bg: "bg-blue-50 border-blue-200" },
  dispatched: { label: "Dispatched", dot: "bg-indigo-400", text: "text-indigo-800", bg: "bg-indigo-50 border-indigo-200" },
  successful: { label: "Successful", dot: "bg-emerald-400", text: "text-emerald-800", bg: "bg-emerald-50 border-emerald-200" },
  cancelled: { label: "Cancelled", dot: "bg-red-400", text: "text-red-800", bg: "bg-red-50 border-red-200" },
};

function MtStatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase().replace(/\s/g, "") ?? "";
  const s = statusConf[key] ?? { label: status || "—", dot: "bg-gray-300", text: "text-gray-700", bg: "bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({
  title,
  subtitle,
  action,
  badge,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  badge?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title} </h2>
            {badge && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && (
        <Link
          href={action.href}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition-colors"
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function OrderCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="h-36 bg-gray-100" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
        <div className="flex justify-between mt-1">
          <div className="h-4 bg-gray-100 rounded w-16" />
          <div className="h-4 bg-gray-100 rounded w-20" />
        </div>
        <div className="flex gap-2 mt-2">
          <div className="flex-1 h-7 bg-gray-100 rounded" />
          <div className="flex-1 h-7 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-gray-100" />
      <div className="p-2 flex flex-col gap-1.5">
        <div className="h-3 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const router = useRouter();
  const auth = useAuthSession();
  const [navOpen, setNavOpen] = useState(false);
  const [hotItems, setHotItems] = useState<HotItemDisplay[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<RelatedProductDisplay[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const dealerId = !auth.loading && auth.session.status === "authenticated" && auth.session.role === "dealer"
    ? String(auth.session.user.Dealer_Id ?? "").trim()
    : "";
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);
  const [catalogResolver, setCatalogResolver] = useState<CatalogRouteResolver | null>(null);
  const year = new Date().getFullYear();

  // Read recently viewed (initial + on update events from Header)
  useEffect(() => {
    const refresh = () => setRecentlyViewed(getRecentlyViewed());
    refresh();
    window.addEventListener("recentlyViewedUpdated", refresh);
    return () => window.removeEventListener("recentlyViewedUpdated", refresh);
  }, []);

  // Fetch products for "Hot Right Now" section
  // Priority: admin-managed MongoDB hot items with catalog images
  // Fallback: first 6 products that have images in the local catalog
  useEffect(() => {
    Promise.all([
      axios.get<JsonProduct[]>("/data/omsons_products_from_excel_with_images.json"),
      fetch("/api/hot-items", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ success: false, data: { items: [] } })),
    ])
      .then(([catalogRes, hotJson]) => {
        const { imageMap, nameMap, fallbackProducts, resolver } = buildCatalogLookups(catalogRes.data);
        setCatalogResolver(resolver);
        setRelatedProducts(buildRelatedProducts(bottleProducts, resolver));
        const publishedItems = ((hotJson.success ? hotJson.data?.items : []) ?? []) as PublishedHotItem[];
        const adminItems = publishedItems.filter((item) => item.active);
        const hasConfiguredHotItems = hotJson.success && !hotJson.data?.isDefault && publishedItems.length > 0;

        if (adminItems.length > 0) {
          setHotItems(
            adminItems.slice(0, 6).map((item: PublishedHotItem) => {
              const key = item.SKU.trim().toLowerCase();
              return {
                SKU: item.SKU,
                Name: nameMap.get(key) || item.name,
                badge: item.badge,
                image: imageMap.get(key) || (item.image && item.image !== PLACEHOLDER_IMAGE ? item.image : ""),
              };
            })
          );
        } else if (hasConfiguredHotItems) {
          setHotItems([]);
        } else {
          setHotItems(fallbackProducts.slice(0, 6));
        }
        setHotLoading(false);
      })
      .catch(() => {
        setCatalogResolver(null);
        setRelatedProducts([]);
        setHotLoading(false);
      });
  }, []);

  // Fetch real orders
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["orders-home", "dealer", dealerId],
    queryFn: () => fetchOrders(dealerId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: !auth.loading && auth.session.status === "authenticated" && auth.session.role === "dealer" && !!dealerId,
  });

  useEffect(() => {
    const orderIds = Array.from(new Set((ordersData?.data ?? [])
      .map(order => String(order.order_id || "").trim())
      .filter(Boolean)
    ));
    if (orderIds.length === 0) {
      return;
    }

    let active = true;
    fetch(`/api/order-summary-overrides?dealer_id=${encodeURIComponent(dealerId)}&order_ids=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (!active) return;
        const map: Record<string, OrderSummaryOverride> = {};
        for (const row of Array.isArray(json.data) ? json.data : []) {
          const id = String(row.orderId || row.order_id || "").trim();
          if (id) map[id] = row;
        }
        setSummaryOverrides(map);
      })
      .catch(() => {
        if (active) setSummaryOverrides({});
      });

    return () => { active = false; };
  }, [dealerId, ordersData?.data]);

  const recentOrders = useMemo(() => {
    return (ordersData?.data ?? [])
      .slice(0, 4)
      .map(order => withDisplayOrderAmounts(order, summaryOverrides[order.order_id]));
  }, [ordersData?.data, summaryOverrides]);

  // Navigate to product detail and also record a recently viewed entry
  const goToProduct = (skuOrName: string, name: string, image?: string) => {
    const routeSku = catalogResolver?.findRouteSku(skuOrName) ?? skuOrName;
    pushRecentlyViewed({ SKU: routeSku, Name: name, image });
    router.push(`/Products/${encodeURIComponent(routeSku)}`);
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 text-black">

      {/* ── Categories Nav ── */}
      <nav className="bg-[#032e66] relative min-h-10 flex items-center text-white text-sm w-full px-4">
        <button
          onClick={() => setNavOpen(!navOpen)}
          className="flex shrink-0 items-center gap-2 px-3 py-1.5 rounded hover:bg-[#054080] transition-colors font-medium"
        >
          <GiHamburgerMenu className="h-4 w-4" />
          All Categories
          <svg
            className="h-3 w-3 transition-transform duration-200"
            style={{ transform: navOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {HOME_NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded px-3 py-1.5 text-sm font-medium text-white/90 transition-colors hover:bg-[#054080] hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Backdrop */}
        {navOpen && (
          <div className="fixed inset-0 z-40" onClick={() => setNavOpen(false)} />
        )}

        {/* Dropdown panel */}
        <div
          className="absolute top-10 left-0 z-50 bg-white text-gray-800 shadow-2xl rounded-b-xl overflow-hidden"
          style={{
            width: 680,
            maxHeight: navOpen ? 480 : 0,
            opacity: navOpen ? 1 : 0,
            transition: "max-height 0.25s ease, opacity 0.2s ease",
            pointerEvents: navOpen ? "auto" : "none",
          }}
        >
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 480 }}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Browse by Category</p>
            <div className="grid grid-cols-3 gap-1">
              {Object.keys(SIDEBAR_CATEGORIES).map(label => (
                <Link
                  key={label}
                  href={`/Products?cat=${encodeURIComponent(label)}`}
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  {label}
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <Link
                href="/Products"
                onClick={() => setNavOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                View all products →
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero Slider ── */}
      <div className="relative w-full bg-gradient-to-b from-slate-800 to-gray-50">
        <ImageSlider />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1 — Shop by Category
      ══════════════════════════════════════════════════════════════════ */}
      <section id="categories" className="max-w-[1840px] mx-auto px-4 py-12">
        <SectionHeading
          title="Shop by Category"
          subtitle="Browse our full range of laboratory equipment"
          action={{ label: "All categories", href: "/Products" }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {CATEGORY_CARDS.map((cat: CategoryCard) => (
            <Link key={cat.title} href={cat.link}
              className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 flex flex-col hover:shadow-md hover:border-indigo-200 transition-all group"
              style={{ textDecoration: "none" }}>
              <h3 className="text-base font-bold text-slate-800 mb-3 group-hover:text-indigo-700 transition-colors">{cat.title}</h3>
              <div className="grid grid-cols-2 gap-2 flex-1">
                {cat.items.map((item) => (
                  <div key={item.label}>
                    <img src={item.imageUrl} alt={item.label} loading="lazy"
                      className="w-full aspect-square object-cover rounded group-hover:opacity-90 transition-opacity" />
                    <span className="text-[11px] mt-1 block text-slate-600 leading-tight line-clamp-2">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
              <span className="mt-4 text-sm font-medium text-indigo-600 group-hover:text-indigo-800 group-hover:underline transition-colors">
                See all →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2 — Recent Orders
      ══════════════════════════════════════════════════════════════════ */}
      <section id="order-history" className="max-w-[1840px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Recent Orders"
          subtitle={ordersData ? `${ordersData.count} total orders · showing last 4` : "Your latest purchases"}
          action={{ label: "View all orders", href: "/orders" }}
        />

        {ordersError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-lg border border-gray-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
            </svg>
            <p className="text-sm text-gray-500">Could not load orders. Please try again later.</p>
          </div>
        )}

        {!ordersLoading && !ordersError && recentOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-lg border border-gray-100">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            <p className="text-sm text-gray-500">No orders yet.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ordersLoading && Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)}
          {!ordersLoading && !ordersError && recentOrders.map((order) => {
            const net = Number(order.order_amount) - Number(order.order_discount);
            const isDeleted = !!order.reason;
            return (
              <div key={order.order_id}
                className={`bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow ${isDeleted ? "opacity-60" : ""}`}>
                <div className="bg-gray-50 flex flex-col items-center justify-center p-4 h-36 gap-2">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h4"/>
                  </svg>
                  <span className="font-mono text-[11px] text-slate-400">{formatDisplayOrderNumber(order.order_id)}</span>
                </div>
                <div className="p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-mono text-[13px] font-bold text-indigo-700">{formatDisplayOrderNumber(order.order_id)}</p>
                    {isDeleted && (
                      <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded text-[10px] font-bold">DELETED</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{moment(order.order_date).format("DD MMM YYYY · hh:mm A")}</p>
                  <div className="flex items-center justify-between mt-1">
                    <div>
                      <span className="text-sm font-bold text-slate-900">₹{net.toLocaleString("en-IN")}</span>
                      {Number(order.order_discount) > 0 && (
                        <span className="ml-1.5 text-xs line-through text-slate-400">
                          ₹{Number(order.order_amount).toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                    <MtStatusBadge status={order.mtstatus} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {order.orderdata_item_quantity} unit{Number(order.orderdata_item_quantity) !== 1 ? "s" : ""}
                    {order.Dealer_Name ? ` · ${order.Dealer_Name}` : ""}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => router.push(`/orders/${order.order_id}`)}
                      className="flex-1 text-center text-xs py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors">
                      View
                    </button>
                    <button onClick={() => router.push("/orders")}
                      className="flex-1 text-center text-xs py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 transition-colors">
                      Reorder
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3 — Related Products
      ══════════════════════════════════════════════════════════════════ */}
      <section id="related-products" className="max-w-[1840px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Related Products"
          subtitle="Recommended based on your purchases and browsing"
          action={{ label: "Browse all", href: "/Products" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {relatedProducts.map((product) => (
            <button key={product.routeSku} onClick={() => goToProduct(product.routeSku, product.name, product.image)}
              className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow text-left w-full">
              <div className="bg-gray-50 flex items-center justify-center p-3 aspect-square">
                <img src={product.image} alt={product.name}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{product.name}</p>
                <span className="mt-1.5 inline-block text-xs text-slate-500 group-hover:text-slate-900 transition-colors">View →</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4 — Recently Viewed (from localStorage)
      ══════════════════════════════════════════════════════════════════ */}
      {recentlyViewed.length > 0 && (
        <section id="recently-viewed" className="max-w-[1840px] mx-auto px-4 py-12 border-t border-gray-200">
          <SectionHeading
            title="Recently Viewed"
            subtitle="Pick up where you left off"
            action={{ label: "Clear history", href: "#" }}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recentlyViewed.slice(0, 6).map((item) => (
              <button
                key={item.SKU}
                onClick={() => goToProduct(item.SKU, item.Name, item.image)}
                className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow text-left w-full"
              >
                <div className="bg-gray-50 flex items-center justify-center p-3 aspect-square relative">
                  <img
                    src={item.image ?? PLACEHOLDER_IMAGE}
                    alt={item.Name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* "Recently viewed" eye indicator */}
                  <span className="absolute top-1.5 left-1.5 bg-white border border-gray-200 rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </span>
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{item.Name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{item.SKU}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {moment(item.viewedAt).fromNow()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5 — Hot Right Now
      ══════════════════════════════════════════════════════════════════ */}
      <section id="hot-right-now" className="max-w-[1840px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Hot Right Now"
          subtitle="Top picks flying off the shelves"
          badge="🔥 Trending"
          action={{ label: "Shop all", href: "/Products" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {hotLoading
            ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
            : hotItems.map((product) => (
            <button
              key={product.SKU}
              onClick={() => goToProduct(product.SKU, product.Name, product.image || undefined)}
              className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5 text-left w-full"
            >
              <div className="relative bg-gray-50 flex items-center justify-center p-3 aspect-square">
                {product.image ? (
                  <img
                    src={product.image}
                    alt={product.Name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span className="text-4xl">📦</span>
                )}
                <span className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white shadow-sm">
                  {product.badge}
                </span>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{product.Name}</p>
                <span className="mt-1.5 inline-block text-xs text-rose-500 font-semibold group-hover:text-rose-600 transition-colors">
                  Shop now →
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
