"use client";

import { useState } from "react";

export default function AddDealerPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    staff: "",
    whatsapp: "",
    address: "",
    pincode: "",
    discount: "",
    password: "",
    dealerCode: "",
    gst: "",
    city: "",
    creditDays: "",
    annualTarget: "",
    currentLimit: "",
    notes: "",
  });

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
   
  };

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <h1 className="text-xl font-semibold mb-6 text-black">Add Dealer</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-black">
            {/* LEFT COLUMN */}

            <Input
              label="Name"
              name="name"
              value={form.name}
              onChange={handleChange}
            />

            <Input
              label="Email Address"
              name="email"
              value={form.email}
              onChange={handleChange}
            />

            <Select
              label="Select Staff"
              name="staff"
              value={form.staff}
              onChange={handleChange}
              options={["Staff 1", "Staff 2", "Staff 3"]}
            />

            <Input
              label="Whatsapp Number"
              name="whatsapp"
              value={form.whatsapp}
              onChange={handleChange}
            />

            <Input
              label="Bill to Address"
              name="address"
              value={form.address}
              onChange={handleChange}
            />

            <Input
              label="Pin Code"
              name="pincode"
              value={form.pincode}
              onChange={handleChange}
            />

            <Input
              label="Discount %"
              name="discount"
              value={form.discount}
              onChange={handleChange}
            />

            <Input
              label="Password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
            />

            <Input
              label="Dealer Code"
              name="dealerCode"
              value={form.dealerCode}
              onChange={handleChange}
            />

            <Input
              label="GST No"
              name="gst"
              value={form.gst}
              onChange={handleChange}
            />

            <Input
              label="City"
              name="city"
              value={form.city}
              onChange={handleChange}
            />

            <Input
              label="Credit Days"
              name="creditDays"
              value={form.creditDays}
              onChange={handleChange}
            />

            <Input
              label="Annual Target"
              name="annualTarget"
              value={form.annualTarget}
              onChange={handleChange}
            />

            <Input
              label="Current Limit"
              name="currentLimit"
              value={form.currentLimit}
              onChange={handleChange}
            />
          </div>

          {/* Notes Full Width */}
          <div>
            <label className="block text-sm text-black font-medium mb-2">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              className="w-full border border-black rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              rows={3}
            />
          </div>

          {/* Submit */}
          <div>
            <button
              type="submit"
              className="bg-brand-600 text-gray-700 px-6 py-2 rounded-md hover:bg-brand-500 transition"
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* Reusable Components */

function Input({
  label,
  name,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  onChange: any;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}

function Select({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: any;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <option value="">Select</option>
        {options.map((opt) => (
          <option key={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
