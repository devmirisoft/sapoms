"use client"

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { useCatalogueProducts } from "@/hooks/useCatalogueProducts";
import { compactCategoryList, matchesCategory } from "@/lib/categories";

// Every category label is a SIDEBAR_CATEGORIES key, so /Products?cat= resolves it.
const NAV_GROUPS: { label: string; categories: string[]; image?: string; shopHref?: string }[] = [
  {
    label: "Glassware",
    categories: ["Beakers", "Flasks", "Bottles", "Tubes", "Cylinders", "Funnels", "Dishes", "Condensers", "Columns", "Joints & Stopcocks"],
    image: "/volumetric flask.png",
    shopHref: "/Products?cat=Glassware",
  },
  { label: "Measuring & Volumetric", categories: ["Volumetric Flasks", "Pipettes", "Burettes", "Cylinders", "Hydrometers", "Petroleum Measurement", "Viscometers"] },
  { label: "Instruments", categories: ["Lab Instruments", "Thermometers", "Hygrometers"], image: "/hot plate.png" },
  { label: "Liquid Handling", categories: ["Liquid Handling", "Pipettes", "Burettes", "Bottles"] },
  { label: "Distillation", categories: ["Distillation", "Condensers", "Columns", "Adapters", "Kjeldahl"] },
  { label: "Filtration", categories: ["Filters", "Funnels", "Sintered Glassware", "Crucibles"], image: "/cartridge.png" },
  { label: "Extraction", categories: ["Extraction", "Kjeldahl", "Desiccators"] },
  { label: "Lab Accessories", categories: ["Accessories", "Plasticware", "Rubberware", "Metalware", "Porcelain", "Brushes"] },
  { label: "More", categories: ["Education", "Desiccators", "Crucibles", "Hygrometers"] },
];

// ponytail: new releases have no data source yet, so it opens the full listing.
const QUICK_LINKS = [
  { label: "Today's Deals", href: "/home#todays-sale" },
  { label: "Best Sellers", href: "/home#hot-right-now" },
  { label: "New Releases", href: "/Products" },
];
const catHref = (label: string) => `/Products?cat=${encodeURIComponent(label)}`;

type CategoryPreview = { image?: string; products: { sku: string; name: string }[] };

export default function CategoryNav() {
  const { products } = useCatalogueProducts();
  const [open, setOpen] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const group = NAV_GROUPS.find((item) => item.label === open);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Only the open group is scanned; the catalogue is cached by loadCatalogueProducts.
  const previews = useMemo(() => {
    const map: Record<string, CategoryPreview> = {};
    for (const label of group?.categories ?? []) {
      const matches = products.filter((product) =>
        matchesCategory(compactCategoryList([product.category, ...(product.categories ?? [])]), label)
      );
      const seen = new Set<string>();
      map[label] = {
        image: matches.find((product) => product.images?.[0])?.images?.[0],
        products: matches
          .filter((product) => !seen.has(product.name) && seen.add(product.name))
          .slice(0, 4)
          .map(({ sku, name }) => ({ sku, name })),
      };
    }
    return map;
  }, [group, products]);

  const openGroup = (label: string) => {
    setOpen(label);
    setActiveCategory(NAV_GROUPS.find((item) => item.label === label)?.categories[0] ?? null);
  };
  const close = () => setOpen(null);

  return (
    <nav className="relative bg-[#242424] text-white" onMouseLeave={close}>
      <div className="flex min-h-12 flex-wrap items-stretch justify-between px-2 text-sm xl:text-[15px]">
          {NAV_GROUPS.map((item) => {
            const isOpen = open === item.label;
            return (
              <button
                key={item.label}
                type="button"
                onMouseEnter={() => openGroup(item.label)}
                onClick={() => (isOpen ? close() : openGroup(item.label))}
                aria-expanded={isOpen}
                className={`flex items-center gap-1 whitespace-nowrap px-2 py-3 font-medium transition-colors xl:px-3 ${
                  isOpen ? "bg-brand-600 text-white" : "text-white/90 hover:text-white"
                }`}
              >
                {item.label}
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
            );
          })}

          <span className="my-3 w-px bg-white/25" aria-hidden />
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onMouseEnter={close}
              onClick={close}
              className="flex items-center whitespace-nowrap px-2 py-3 font-medium text-white/90 hover:text-white xl:px-3"
            >
              {link.label}
            </Link>
          ))}
      </div>

      {group && (
        <div className="absolute inset-x-4 top-full z-50 flex max-h-[75vh] overflow-hidden rounded-b-xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 p-5">
            <h3 className="mb-4 flex items-center gap-3 text-xl font-semibold text-[#0b2a5b]">
              <FlaskConical className="h-6 w-6" />
              {group.label}
            </h3>
            <ul className="space-y-0.5">
              {group.categories.map((label) => (
                <li key={label}>
                  <Link
                    href={catHref(label)}
                    onClick={close}
                    onMouseEnter={() => setActiveCategory(label)}
                    className={`flex items-center justify-between rounded-md px-3 py-1.5 text-[15px] ${
                      activeCategory === label ? "bg-brand-50 font-medium text-brand-600" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-x-6 gap-y-8 overflow-y-auto p-6 lg:grid-cols-3 xl:grid-cols-4">
            {group.categories.map((label) => {
              const preview = previews[label];
              return (
                <div
                  key={label}
                  className={`flex gap-4 rounded-lg p-2 transition-colors ${activeCategory === label ? "bg-blue-50/60" : ""}`}
                  onMouseEnter={() => setActiveCategory(label)}
                >
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center">
                    {preview?.image && <img src={preview.image} alt="" className="max-h-full max-w-full object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={catHref(label)} onClick={close} className="font-semibold text-slate-900 hover:text-brand-500">
                      {label}
                    </Link>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {preview?.products.map((product) => (
                        <li key={product.sku}>
                          <Link
                            href={`/Products/${encodeURIComponent(product.sku)}`}
                            onClick={close}
                            title={product.name}
                            className="block truncate text-slate-500 hover:text-brand-500"
                          >
                            {product.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={catHref(label)}
                      onClick={close}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-500 hover:underline"
                    >
                      View All {label} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="m-4 hidden w-72 shrink-0 flex-col rounded-lg bg-gradient-to-b from-blue-50 to-slate-100 p-6 xl:flex">
            <h3 className="text-2xl font-bold leading-tight text-[#0b2a5b]">Premium Laboratory {group.label}</h3>
            <p className="mt-2 text-[#0b2a5b]/80">Precision. Durability. Reliability.</p>
            <div className="flex min-h-0 flex-1 items-center justify-center py-4">
              {(group.image ?? previews[group.categories[0]]?.image) && (
                <img src={group.image ?? previews[group.categories[0]]?.image} alt="" className="max-h-56 object-contain" />
              )}
            </div>
            <Link
              href={group.shopHref ?? "/categories"}
              onClick={close}
              className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
            >
              Shop {group.label} <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      )}
    </nav>
  );
}
