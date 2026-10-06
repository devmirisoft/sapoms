import Link from "next/link";
import { TermsDocument } from "@/components/terms/TermsDocument";
import { getTermsBlocks } from "@/server/terms-content";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const blocks = await getTermsBlocks();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-950 px-8 py-8 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Omsons Dealer Access</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Terms & Conditions</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Dealers must accept these terms before they can continue into the ordering platform.
          </p>
        </div>

        <div className="space-y-3 px-8 py-8 text-sm leading-relaxed text-slate-700">
          <TermsDocument blocks={blocks} />
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-8 py-5 text-sm text-slate-500">
          <Link href="/auth/login" className="font-medium text-slate-900 underline underline-offset-4">
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}
