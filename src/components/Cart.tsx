"use client";
import { useCartStore } from "@/Store/store";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";
import { SalePrice, salePaise } from "@/components/SalePrice";
import { useTodaysSale } from "@/hooks/useTodaysSale";

// Types
type ProductMeta = {
  image: string | null;
  productName: string;
  packSize: number;
  specSummary: string;
};

// Build a variant-SKU meta lookup from nested_products.json
function buildVariantLookup(data: any[]): Record<string, ProductMeta> {
  const map: Record<string, ProductMeta> = {};

  for (const product of data) {
    const image = (product.images ?? product.Images ?? []).find(Boolean) ?? null;
    const productName = product.name ?? product.Name ?? "";
    const desc = product.Description ?? "";

    // Parse the description table to get per-variant pack sizes and specs
    const packMap = parsePackSizes(desc);
    const specMap = parseSpecSummaries(desc);

    for (const variant of product.variants ?? []) {
      const sku = variant.SKU ?? variant.sku;
      const variantImage = (variant.images ?? variant.Images ?? []).find(Boolean) ?? image;
      map[sku] = {
        image: variantImage,
        productName,
        packSize: packMap[sku] ?? 1,
        specSummary: specMap[sku] ?? "",
      };
    }
  }
  return map;
}

// Parse PACK OF column from description HTML table: returns { catNo -> packSize }
function parsePackSizes(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!html) return result;

  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return result;
  const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .map(m => m[1].replace(/<[^>]*>/g, "").trim());
  const packIdx = headers.findIndex(h => /pack|qty|quantity/i.test(h));
  if (packIdx === -1) return result;

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return result;

  [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach(tr => {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const catNo = cells[0];
    const packStr = cells[packIdx] ?? "1";
    const n = parseInt(packStr, 10);
    if (catNo) result[catNo] = isNaN(n) ? 1 : n;
  });
  return result;
}

function parseSpecSummaries(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!html) return result;

  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!theadMatch || !tbodyMatch) return result;

  const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  if (headers.length < 2) return result;

  const specHeaders = headers
    .slice(1)
    .filter((header) => !/pack\s*of|pack|qty|quantity/i.test(header));
  if (specHeaders.length === 0) return result;

  [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach((tr) => {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
      .map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    const catNo = cells[0];
    if (!catNo) return;

    const specParts = specHeaders
      .map((header, index) => {
        const value = cells[index + 1];
        if (!value) return "";
        return `${header}: ${value}`;
      })
      .filter(Boolean);

    if (specParts.length > 0) {
      result[catNo] = specParts.join(" - ");
    }
  });

  return result;
}

/** Format paise to rupees */
function fmt(paise: number): string {
  return ` ₹ ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Main Cart Component
export default function Cart() {
  const cart      = useCartStore((s) => s.cart);
  const increment = useCartStore((s) => s.incrementQty);
  const decrement = useCartStore((s) => s.decrementQty);
  const setQty    = useCartStore((s) => s.setQty);
  const remove    = useCartStore((s) => s.removeFromCart);
  const togglePriority = useCartStore((s) => s.togglePriority);
  const clearCart = useCartStore((s) => s.clearCart);
  const router    = useRouter();

  const [lookup, setLookup] = useState<Record<string, ProductMeta>>({});
  const saleOf = useTodaysSale();

  // Load product meta once
  useEffect(() => {
    axios.get("/data/products.json")
      .then(res => setLookup(buildVariantLookup(res.data)))
      .catch(() => {});
  }, []);

  // Prices are in paise; quantity = number of packs
  const subtotalPaise = cart.reduce((acc, item) => {
  const ps = lookup[item.id]?.packSize ?? item.packSize ?? 1;
  return acc + item.price * item.quantity * ps;
}, 0);
  const saleSubtotalPaise = cart.reduce((acc, item) => {
    const ps = lookup[item.id]?.packSize ?? item.packSize ?? 1;
    return acc + salePaise(item.price * item.quantity * ps, saleOf(item.id));
  }, 0);
  const subtotalText = saleSubtotalPaise < subtotalPaise ? (
    <>
      <s className="text-xs font-normal text-[#565959] mr-1">{fmt(subtotalPaise)}</s>
      <span className="text-emerald-600">{fmt(saleSubtotalPaise)}</span>
    </>
  ) : fmt(subtotalPaise);
  const totalPacks    = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalUnits    = cart.reduce((acc, item) => {
    const ps = lookup[item.id]?.packSize ?? item.packSize ?? 1;
    return acc + item.quantity * ps;
  }, 0);

  return (
    <div className="min-h-60 bg-[#EAEDED] font-[Arial,sans-serif]">
      <div className="max-w-4xl mx-auto px-1 py-1">
        <div className="flex gap-3 items-start flex-col lg:flex-col">

          {/* Cart Items */}
          <div className="flex-1 w-full bg-white border border-gray-300 rounded px-2 py-2">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-0">
              <h2 className="text-xl font-normal p-1 text-[#0F1111]">Shopping Cart</h2>
              <div className="flex items-center gap-4">
                {cart.length > 0 && (
                  <button
                    onClick={clearCart}
                    className="text-sm text-[#de0000] hover:text-[#C7511F] hover:underline font-medium"
                  >
                    Delete All
                  </button>
                )}
                <span className="text-sm text-[#565959]">Price</span>
              </div>
            </div>

            {/* Scrollable list */}
            <div className="max-h-[250px] overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <p className="text-center py-10 text-[#565959] mt-6">Your cart is empty.</p>
              ) : (
                cart.map((item) => {
                  const meta      = lookup[item.id];
                  const packSize  = meta?.packSize ?? item.packSize ?? 1;
                  const unitPrice = item.price;                        // paise per piece
                  const lineTotal = unitPrice * item.quantity * packSize;         // paise total
                  const totalUnitCount = item.quantity * packSize;

                  // Split name into product and variant.
                  const nameParts   = item.name.split(" - ");
                  const productName = nameParts[0] ?? item.name;
                  const variantCode = nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id;
                  const image = item.image || meta?.image;
                  const sale = saleOf(item.id);

                  return (
                    <div
                      key={item.id}
                      className="flex gap-4 py-4 px-3 border-b border-gray-200 last:border-0 rounded-lg
                                 transition-all duration-200 ease-in-out
                                 hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] hover:-translate-y-0.5 hover:border-transparent hover:bg-white hover:z-10 relative"
                    >
                      {/* Product Image */}
                      <div className="w-20 h-20 bg-[#F0F2F2] rounded flex items-center justify-center shrink-0 overflow-hidden">
                        {image ? (
                          <img
                            src={image}
                            alt={productName}
                            className="w-full h-full object-contain p-1"
                          />
                        ) : (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.2">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <path d="m21 15-5-5L5 21"/>
                          </svg>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        {/* Product name */}
                        <p className="text-[#007185] hover:text-[#C7511F] hover:underline cursor-pointer leading-snug mb-1 text-sm font-medium truncate">
                          {productName}
                        </p>

                        {/* Variant / Cat No */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[11px] font-mono font-semibold">
                            <span>Cat. No: {variantCode}</span>
                            {meta?.specSummary && (
                              <span className="text-amber-600 font-sans font-medium not-italic">
                                {meta.specSummary}
                              </span>
                            )}
                          </span>
                          {packSize > 1 && (
                            <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded text-[11px] font-semibold">
                              Pack of {packSize}
                            </span>
                          )}
                          {item.isPriority && (
                            <span className="inline-flex items-center px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded text-[11px] font-bold">
                              Priority
                            </span>
                          )}
                          {sale > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 bg-emerald-600 text-white rounded text-[11px] font-bold">
                              Today&apos;s Deal: {sale}% OFF
                            </span>
                          )}
                        </div>

                        {/* Quantity controls */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center rounded bg-[#F0F2F2] overflow-hidden">
                            <button
                              onClick={() => decrement(item.id)}
                              className="w-6 h-7 flex items-center justify-center text-white rounded-l bg-yellow-400 hover:bg-yellow-500 transition-colors font-bold text-sm"
                            >-</button>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val > 0) setQty(item.id, val);
                              }}
                              className="px-2 h-7 text-sm font-semibold text-[#0F1111] text-center bg-white min-w-[40px] w-[40px] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              min={1}
                            />
                            <button
                              onClick={() => increment(item.id)}
                              className="w-6 h-7 flex items-center justify-center text-white rounded-r bg-yellow-400 hover:bg-yellow-500 transition-colors font-bold text-sm"
                            >+</button>
                          </div>
                          <span className="text-gray-300 text-sm">|</span>
                          <button
                            onClick={() => remove(item.id)}
                            className="text-sm text-[#de0000] hover:text-[#C7511F] hover:underline"
                          >Delete</button>
                          <button
                            onClick={() => togglePriority(item.id)}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                              item.isPriority
                                ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                            title="Mark this product as priority"
                          >
                            {item.isPriority ? "Priority on" : "Priority"}
                          </button>
                        </div>

                        {/* Pack units breakdown */}
                        {packSize > 1 && (
                          <p className="text-[11px] text-[#565959] mt-1.5 font-mono">
                            {item.quantity} pack{item.quantity !== 1 ? "s" : ""} x {packSize} = {totalUnitCount} units
                          </p>
                        )}
                      </div>

                      {/* Price column */}
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <p className="text-sm font-bold text-[#0F1111]">
                          <SalePrice paise={lineTotal} percent={sale} />
                        </p>
                        {item.quantity > 1 && (
                          <p className="text-xs text-[#565959]">
                            {fmt(salePaise(unitPrice * packSize, sale))} / pack
                          </p>
                        )}
                        {packSize > 1 && (
                          <p className="text-xs text-[#565959]">
                            {fmt(salePaise(unitPrice, sale))} / unit
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Subtotal bottom row */}
            {cart.length > 0 && (
              <div className="pt-3 border-t border-gray-200 mt-2">
                <div className="flex justify-between items-center text-xs text-[#565959] mb-1">
                  <span>{totalPacks} pack{totalPacks !== 1 ? "s" : ""}</span>
                  {totalUnits !== totalPacks && (
                    <span>{totalUnits} total units</span>
                  )}
                </div>
                <div className="text-right text-base text-[#0F1111]">
                  Subtotal ({cart.length} item{cart.length !== 1 ? "s" : ""}):{" "}
                  <span className="font-bold text-lg">
                    {subtotalText}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar / Proceed */}
          <div className="w-full bg-white border border-gray-300 rounded p-5 sticky top-4
                          transition-all duration-200 ease-in-out
                          hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)] hover:-translate-y-0.5">
            <p className="text-base text-[#0F1111] mb-1">
              Subtotal ({cart.length} item{cart.length !== 1 ? "s" : ""}):{" "}
              <span className="font-bold text-lg">{subtotalText}</span>
            </p>
            {totalUnits !== totalPacks && (
              <p className="text-xs text-[#565959] mb-3">{totalUnits} units across {totalPacks} packs</p>
            )}
            <button
              onClick={() => router.push("/dashboard/dealer/AddOrderForm?from=cart")}
              className="w-full bg-gradient-to-b from-[#6A5ACD] to-[#6A5ACD] border border-[#f0f0f0] rounded-full py-2 text-sm text-white hover:from-[#594cad] hover:to-[#6A5ACD] transition-colors mt-2"
            >
              Proceed to Buy
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
