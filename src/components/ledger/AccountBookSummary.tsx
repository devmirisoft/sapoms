"use client";

export type AccountBookStats = {
  booked: number;
  bookedCount: number;
  sentAndSettled: number;
  sentAndSettledCount: number;
  supposedToGo: number;
  supposedToGoCount: number;
  awaiting: number;
  awaitingCount: number;
};

type Props = {
  stats?: AccountBookStats;
  isLoading?: boolean;
};

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AccountBookSummary({ stats, isLoading = false }: Props) {
  const safeStats: AccountBookStats = stats || {
    booked: 0,
    bookedCount: 0,
    sentAndSettled: 0,
    sentAndSettledCount: 0,
    supposedToGo: 0,
    supposedToGoCount: 0,
    awaiting: 0,
    awaitingCount: 0,
  };

  const cards = [
    {
      label: "Total Booked",
      value: safeStats.booked,
      count: safeStats.bookedCount,
      tone: "border-gray-200 bg-white text-gray-900",
      sub: "All active booked orders",
    },
    {
      label: "Sent & Settled",
      value: safeStats.sentAndSettled,
      count: safeStats.sentAndSettledCount,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      sub: "Dispatched and billed",
    },
    {
      label: "Supposed to Go",
      value: safeStats.supposedToGo,
      count: safeStats.supposedToGoCount,
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      sub: "Accepted, pending dispatch",
    },
    {
      label: "Awaiting Confirm",
      value: safeStats.awaiting,
      count: safeStats.awaitingCount,
      tone: "border-brand-200 bg-brand-50 text-brand-800",
      sub: "Pending acceptance",
    },
  ];

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-[15px] font-bold text-gray-900">Account Book & Dispatch Summary</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className={`rounded-xl border px-4 py-3 ${card.tone}`}>
            {isLoading ? (
              <>
                <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-200" />
                <div className="mb-2 h-7 w-32 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
              </>
            ) : (
              <>
                <p className="text-[10.5px] font-bold uppercase tracking-wider opacity-70">{card.label}</p>
                <p className="mt-2 font-mono text-xl font-bold">{money(card.value)}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold opacity-75">
                    {card.count} order{card.count !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[10.5px] opacity-60">{card.sub}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
