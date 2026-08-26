 'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

const ADMIN_DEALERS_URL = "/api/admin/dealers"
const DEALER_LIST_ROUTE = "/dashboard/admin/dealer/DealerList"

function splitCsv(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean)
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean)
}

function formatAmount(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return '-'
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? `₹${numeric.toLocaleString('en-IN')}` : raw
}

function ContactCard({
  heading, isPriority, name, phone, email,
}: {
  heading: string
  isPriority: boolean
  name?: string
  phone?: string
  email?: string
}) {
  return (
    <div className={`rounded-lg border p-4 ${isPriority ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 bg-gray-50/60'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide mr-10">{heading}</span>
        {isPriority && (
          <span
            title="Priority person — used for calls"
            className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
           Priority
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-2">
        <div>
          <dt className="text-xs text-gray-500">Name</dt>
          <dd className="text-sm text-gray-800">{name || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Phone</dt>
          <dd className="text-sm text-gray-800">{phone || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Email</dt>
          <dd className="text-sm text-gray-800">{email || '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

export default function DealerViewPage() {
  const params = useParams()
  const dealerId = String(params.dealerId || "")
  const router = useRouter()

  const [isLoading, setIsLoading] = useState(true)
  const [dealer, setDealer] = useState<any>(null)

  const fetchDealer = async () => {
    if (!dealerId) return
    setIsLoading(true)
    try {
      const res = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(dealerId)}`, { credentials: "include" })
      const json = await res.json()
      if (json.status) setDealer(json.data || {})
    } catch (err) {
      console.error('Failed to load dealer', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchDealer() }, [dealerId])

  if (isLoading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading dealer...</p>
      </div>
    </div>
  )

  if (!dealer) return (
    <div className="min-h-screen bg-gray-100 p-6">No dealer found</div>
  )

  const assigned = splitCsv(dealer.assignedstaff)
  const priorityPerson = dealer.priorityContact === "secondary" ? "secondary" : "primary"
  const isWalletActive = String(dealer.walletStatus || "").toLowerCase() === "active"

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="admin-page-shell">
        <div className="mb-6">
          <button onClick={() => router.push(DEALER_LIST_ROUTE)} className="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Dealer List</button>
          <h1 className="text-3xl font-bold text-gray-900 mt-3">Dealer Details</h1>
          <p className="text-sm text-gray-500 mt-1">Read-only view of dealer information</p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">Name</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Name || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Email</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Email || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">WhatsApp</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Number || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">City</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_City || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Address</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Address || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Pin Code</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Pincode || '-'}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Point of Contact</h2>
            <p className="text-xs text-gray-500 -mt-3 mb-4">
              Calls go to <span className="font-semibold text-gray-700">{priorityPerson === "secondary" ? "Contact 2" : "Contact 1"}</span>
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ContactCard
                heading="Contact 1"
                isPriority={priorityPerson === "primary"}
                name={dealer.Dealer_Name}
                phone={dealer.Dealer_Number}
                email={dealer.Dealer_Email}
              />
              <ContactCard
                heading="Contact 2"
                isPriority={priorityPerson === "secondary"}
                name={dealer.secondaryContactName}
                phone={dealer.secondaryContactPhone}
                email={dealer.secondaryContactEmail}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Account & Credentials</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">Dealer Code</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Dealercode || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Username</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Username || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Password</div>
                <div className="text-sm text-gray-800">{dealer.Dealer_Password ? '••••••••' : '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">GST</div>
                <div className="text-sm text-gray-800">{dealer.gst || '-'}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Financial</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">Payment Type</div>
                <div className="text-sm text-gray-800 flex items-center gap-2">
                  {isWalletActive ? 'Advance (Wallet)' : 'Credit'}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    isWalletActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    Wallet {isWalletActive ? 'active' : 'inactive'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Discount %</div>
                <div className="text-sm text-gray-800">{dealer.discount || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Annual Target</div>
                <div className="text-sm text-gray-800">{formatAmount(dealer.annualtarget)}</div>
              </div>
              {!isWalletActive && (
                <>
                  <div>
                    <div className="text-xs text-gray-500">Credit Days</div>
                    <div className="text-sm text-gray-800">{dealer.creditdays || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Current Limit</div>
                    <div className="text-sm text-gray-800">{formatAmount(dealer.currentlimit)}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Staff Assignment</h2>
            <div className="text-sm text-gray-800">{assigned.length > 0 ? assigned.join(', ') : (dealer.staffname || '—')}</div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Notes</h2>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{dealer.Dealer_Notes || '-'}</div>
          </div>

        </div>
      </div>
    </div>
  )
}
