'use client'

import Link from "next/link";
import type { CatalogueProduct } from "@/lib/catalogue";
import {
  getCatalogueProductDescriptor,
} from "@/lib/catalogue";
import cataloguePricing from "@/lib/cataloguePricing";

type CatalogueProductCardProps = {
  product: CatalogueProduct;
  href?: string;
  skuLabel?: string;
  descriptionOverride?: string;
};

function getProductImage(product: CatalogueProduct): string | null {
  return (product.images ?? []).find((image) => typeof image === "string" && image.length > 0) ?? null;
}

export default function CatalogueProductCard({
  product,
  href,
  skuLabel,
  descriptionOverride,
}: CatalogueProductCardProps) {
  const image = getProductImage(product);
  const cheapest = cataloguePricing.cheapestPricing(product);
  const variantCount = product.variants?.length ?? 0;
  const descriptor = descriptionOverride || getCatalogueProductDescriptor(product) || product.features?.[0] || "";
  const multiVariant = variantCount > 1;
  const inStock = product.variants?.some((variant) => variant.inStock) ?? false;
  const targetHref = href || `/Products/${encodeURIComponent(product.sku ?? "")}`;

  return (
    <Link href={targetHref} style={{ textDecoration: "none", display: "block", height: "100%" }}>
      <article
        style={{
          background: "#fff",
          borderRadius: 10,
          border: "1px solid #e8edf3",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          transition: "box-shadow .2s, transform .2s",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
        onMouseEnter={(event) => {
          const element = event.currentTarget as HTMLElement;
          element.style.boxShadow = "0 8px 28px rgba(0,0,0,0.11)";
          element.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(event) => {
          const element = event.currentTarget as HTMLElement;
          element.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
          element.style.transform = "translateY(0)";
        }}
      >
        <div
          style={{
            position: "relative",
            background: "#f8fafc",
            aspectRatio: "1/1",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {image ? (
            <img
              src={image}
              alt={product.name}
              style={{ width: "100%", height: "100%", objectFit: "contain", padding: "12px" }}
              loading="lazy"
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                color: "#cbd5e1",
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span style={{ fontSize: 11 }}>No image</span>
            </div>
          )}
          {!inStock && (
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "#94a3b8",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 4,
              }}
            >
              OUT OF STOCK
            </span>
          )}
        </div>

        <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", flex: 1, gap: 5 }}>
          {product.category && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#1e40af",
                background: "#eff6ff",
                padding: "2px 7px",
                borderRadius: 4,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                alignSelf: "flex-start",
              }}
            >
              {product.category}
            </span>
          )}

          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.4, margin: 0 }}>
            {product.name}
          </h3>

          {descriptor && (
            <p style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.45, margin: 0 }}>
              {descriptor}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <i><span className="text-sm font-medium text-gray-900 underline">SKU: {skuLabel || product.sku}</span></i>
            {multiVariant && <span style={{ fontSize: 10.5, color: "#64748b" }}>{variantCount} variants</span>}
          </div>

          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            {cheapest ? (
              <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#1e3a5f" }}>{cataloguePricing.formatPriceLine(cheapest)}</span>
                {multiVariant && <span style={{ fontSize: 10, color: "#64748b" }}>onwards</span>}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>Price on request</p>
            )}
            <div
              style={{
                background: "#6A5ACD",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                textAlign: "center",
                padding: "8px 0",
                borderRadius: 6,
                letterSpacing: ".07em",
              }}
            >
              VIEW DETAILS
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
