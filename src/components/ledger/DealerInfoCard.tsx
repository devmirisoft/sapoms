"use client";

import { Mail, Phone, MapPin, Wallet, History, ArrowDownLeft, ArrowUpRight, PencilLine } from "lucide-react";

interface Dealer {
  Dealer_Id: string;
  Dealer_Name: string;
  Dealer_Email: string;
  Dealer_Number: string;
  Dealer_Address: string;
  Dealer_City: string;
  Dealer_Pincode: string;
  walletBalance?: number;
}

export interface WalletTransaction {
  id: string;
  type: "credit" | "debit";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference?: string;
  note?: string;
  createdAt?: string | null;
}

interface DealerInfoCardProps {
  dealer: Dealer | null;
  isLoading: boolean;
  walletBalance?: number;
  walletTransactions?: WalletTransaction[];
  walletLoading?: boolean;
  onPayMoneyClick?: () => void;
  onAdjustWalletClick?: () => void;
  canAdjustWallet?: boolean;
  canRecordPayment?: boolean;
  /** False for credit-terms dealers: they pay against bills and have no wallet. */
  showWallet?: boolean;
}

function formatAmount(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Now" : date.toLocaleString("en-IN");
}

export default function DealerInfoCard({
  dealer,
  isLoading,
  walletBalance,
  walletTransactions = [],
  walletLoading = false,
  onPayMoneyClick,
  onAdjustWalletClick,
  canAdjustWallet = false,
  canRecordPayment = false,
  showWallet = true,
}: DealerInfoCardProps) {
  if (isLoading) {
    return (
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-3 h-8 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="h-10 w-24 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded bg-gray-200" />
              <div className="flex-1">
                <div className="mb-2 h-4 w-20 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!dealer) {
    return null;
  }

  const currentBalance = Number(walletBalance ?? dealer.walletBalance ?? 0);

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Ledger Account
          </p>
          <h1 className="text-2xl font-bold text-gray-900">{dealer.Dealer_Name}</h1>
        </div>
        <div className="flex gap-2">
          {canRecordPayment && onPayMoneyClick && (
            <button
              onClick={onPayMoneyClick}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              Pay Money
            </button>
          )}
          {showWallet && canAdjustWallet && onAdjustWalletClick && (
            <button
              onClick={onAdjustWalletClick}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-100"
            >
              <PencilLine className="h-4 w-4" />
              Adjust Wallet
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {dealer.Dealer_Number && (
          <div className="flex items-start gap-3">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Mobile
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {dealer.Dealer_Number}
              </p>
            </div>
          </div>
        )}

        {dealer.Dealer_Email && (
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Email
              </p>
              <p className="mt-1 truncate text-sm font-medium text-gray-900">
                {dealer.Dealer_Email}
              </p>
            </div>
          </div>
        )}

        {dealer.Dealer_Address && (
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Address
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {dealer.Dealer_Address}, {dealer.Dealer_City} {dealer.Dealer_Pincode}
              </p>
            </div>
          </div>
        )}

        {showWallet && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Wallet Balance
              </p>
            </div>
            <p className="mt-3 text-2xl font-bold text-emerald-700">
              {formatAmount(currentBalance)}
            </p>
            {walletLoading && (
              <p className="mt-2 text-xs text-gray-500">Refreshing wallet data...</p>
            )}
          </div>
        )}
      </div>

      {showWallet && (
      <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Wallet Transactions</h2>
        </div>

        {walletTransactions.length === 0 ? (
          <p className="text-sm text-gray-500">
            No wallet activity yet.
          </p>
        ) : (
          <div className="space-y-3">
            {walletTransactions.slice(0, 5).map((transaction) => (
              <div
                key={transaction.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${transaction.type === "credit" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                    {transaction.type === "credit" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {transaction.type === "credit" ? "Credit" : "Debit"} {formatAmount(transaction.amount)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {transaction.reference || transaction.note || "Wallet transaction"}
                    </p>
                  </div>
                </div>

                <div className="text-xs text-gray-500 sm:text-right">
                  <p>{formatDate(transaction.createdAt)}</p>
                  <p className="mt-1 font-mono text-[11px]">
                    {formatAmount(transaction.balanceBefore)} → {formatAmount(transaction.balanceAfter)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
