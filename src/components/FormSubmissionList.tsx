"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

type Row = {
  id: string;
  leadNo: string;
  products: string[];
  customerDetails?: { companyName?: string; contactPerson?: string; mobile?: string };
  submittedBy?: { name?: string };
  visitedDate?: string;
};

const PAGE_SIZE = 20;

function formatDate(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-IN");
}

export default function FormSubmissionList({ scope }: { scope: "staff" | "admin" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const endpoint = scope === "admin" ? "/api/forms" : "/api/forms/mine";
  const basePath = scope === "admin" ? "/dashboard/admin/forms" : "/dashboard/staff/forms";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("search", query);

      const res = await fetch(`${endpoint}?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to load forms");

      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forms");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen w-full bg-slate-100 px-6 py-8">
      <div className="mx-auto max-w-[1840px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-extrabold text-[#12508C]">Filter Requirement Forms</h1>
            <p className="text-[13px] text-slate-600">
              {scope === "admin" ? "All submitted forms" : "Forms you have submitted"}
            </p>
          </div>
          {scope === "staff" ? (
            <Link
              href={`${basePath}/add`}
              className="flex items-center gap-2 rounded bg-[#12508C] px-4 py-2 text-[13px] font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              New Form
            </Link>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
          className="mb-5 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by lead no., company or staff name"
            className="w-full bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button type="submit" className="rounded bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700">
            Search
          </button>
        </form>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="px-6 py-10 text-sm text-slate-500">Loading forms...</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">No forms found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Lead No.", "Company", "Products", "Submitted By", "Date", ""].map((label) => (
                      <th
                        key={label}
                        className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-4 font-mono text-[12px] font-semibold text-[#12508C]">{row.leadNo}</td>
                      <td className="px-5 py-4 text-[13px] font-semibold text-slate-900">
                        {row.customerDetails?.companyName || "—"}
                        {row.customerDetails?.contactPerson ? (
                          <div className="text-[12px] font-normal text-slate-500">
                            {row.customerDetails.contactPerson}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-[12px] text-slate-600">
                        {row.products?.length ? row.products.join(", ") : "—"}
                      </td>
                      <td className="px-5 py-4 text-[12px] text-slate-600">{row.submittedBy?.name || "—"}</td>
                      <td className="px-5 py-4 text-[12px] text-slate-600">{formatDate(row.visitedDate)}</td>
                      <td className="px-5 py-4">
                        <Link
                          href={`${basePath}/${row.id}`}
                          className="rounded bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-[13px] text-slate-600">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => prev + 1)}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
