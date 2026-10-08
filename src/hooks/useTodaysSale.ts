"use client";

import { useCallback, useEffect, useState } from "react";
import { loadCatalogueProducts } from "@/lib/catalogueClient";
import type { SaleItem } from "@/lib/todaysSale";

// Today's Sale percent by SKU, empty unless the sale is live. A sale on a product
// SKU covers all its variants (the cart only knows variant SKUs); a variant's own
// entry wins over its product's.
export function useTodaysSale() {
  const [percents, setPercents] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/todays-sale", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (payload) => {
        if (!payload?.data?.live) return;
        const map: Record<string, number> = {};
        for (const item of payload.data.items as SaleItem[]) {
          if (item.active) map[item.SKU.trim().toLowerCase()] = item.discountPercent;
        }
        for (const product of await loadCatalogueProducts()) {
          const percent = map[product.sku.toLowerCase()];
          if (!percent) continue;
          for (const variant of product.variants ?? []) map[variant.sku.toLowerCase()] ??= percent;
        }
        if (!cancelled) setPercents(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return useCallback((sku?: string | null) => percents[String(sku ?? "").trim().toLowerCase()] ?? 0, [percents]);
}
