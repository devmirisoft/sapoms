export function salePaise(paise: number, percent: number) {
  return percent > 0 ? Math.round(paise * (100 - percent) / 100) : paise;
}

const fmt = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Today's Sale is display-only: the struck price is what the order still charges.
export function SalePrice({ paise, percent }: { paise: number; percent: number }) {
  if (percent <= 0) return <>{fmt(paise)}</>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.25 }}>
      <span style={{ fontSize: "0.85em", color: "#94a3b8", textDecoration: "line-through", fontWeight: 400 }}>{fmt(paise)}</span>
      <span style={{ color: "#059669", fontWeight: 700 }}>{fmt(salePaise(paise, percent))}</span>
    </span>
  );
}
