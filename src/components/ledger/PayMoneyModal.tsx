'use client'

import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'

interface PayMoneyModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: PaymentData) => Promise<void>
  dealerName: string
  isLoading?: boolean
}

export interface PaymentData {
  amount: number
  paymentMode: string
  narration: string
  referenceId?: string
}

const PAYMENT_MODES = ['Cash', 'Wallet', 'Cheque', 'Bank Transfer', 'UPI']

export default function PayMoneyModal({
  isOpen,
  onClose,
  onSubmit,
  dealerName,
  isLoading = false,
}: PayMoneyModalProps) {
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [narration, setNarration] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [error, setError] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setSubmitLoading(true)
    try {
      await onSubmit({
        amount: parseFloat(amount),
        paymentMode,
        narration: narration || `Payment received - ${paymentMode}`,
        referenceId: referenceId || undefined,
      })
      // Reset form
      setAmount('')
      setPaymentMode('Cash')
      setNarration('')
      setReferenceId('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to record payment')
    } finally {
      setSubmitLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Pay Money</h2>
          <button
            onClick={onClose}
            disabled={submitLoading}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Dealer Name (display only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dealer
            </label>
            <div className="px-4 py-2.5 bg-gray-50 rounded-lg text-gray-900 font-medium border border-gray-200">
              {dealerName}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-2">
              Amount <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-medium">
                ₹
              </span>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError('')
                }}
                placeholder="0.00"
                disabled={submitLoading}
                className="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>

          {/* Payment Mode */}
          <div>
            <label htmlFor="mode" className="block text-sm font-medium text-gray-700 mb-2">
              Payment Mode
            </label>
            <select
              id="mode"
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              disabled={submitLoading}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50"
            >
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>

          {/* Reference ID (for cheque/bank transfer) */}
          {['Cheque', 'Bank Transfer', 'UPI'].includes(paymentMode) && (
            <div>
              <label
                htmlFor="reference"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Reference ID / Cheque No.
              </label>
              <input
                id="reference"
                type="text"
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="e.g., CHQ-12345 or TXN-ID"
                disabled={submitLoading}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>
          )}

          {/* Narration */}
          <div>
            <label htmlFor="narration" className="block text-sm font-medium text-gray-700 mb-2">
              Narration / Notes
            </label>
            <textarea
              id="narration"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Optional notes about this payment"
              disabled={submitLoading}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50 resize-none"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitLoading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitLoading || !amount}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitLoading ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
