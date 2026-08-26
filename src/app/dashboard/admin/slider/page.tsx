"use client";


import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";


type SliderImage = {
  id: string;
  imageUrl: string;
  image_url?: string;
  title?: string;
  created_at?: string;
  createdAt?: string;
};


type SliderManagerProps = {
  /** Optional heading shown at the top of the component */
  title?: string;
};

export default function SliderManager({
  title = "Slider Images",
}: SliderManagerProps) {
  const [images, setImages] = useState<SliderImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchImages = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/slider", { credentials: "include", cache: "no-store" });
    const payload = await res.json();
    setImages(Array.isArray(payload?.data) ? payload.data : []);
    setLoading(false);
  };
  const router = useRouter();


  useEffect(() => { fetchImages(); }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const clearForm = () => {
    setFile(null);
    setPreview(null);
    setLabel("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("title", label.trim());
      form.append("position", String(images.length));
      const res = await fetch("/api/admin/slider", { method: "POST", body: form, credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) throw new Error(payload?.message || "Upload failed.");

      showToast("Image uploaded and live on slider!", true);
      clearForm();
      fetchImages();
    } catch (err: any) {
      showToast(err?.message ?? "Upload failed.", false);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (img: SliderImage) => {
    if (!confirm(`Remove "${img.title || "this image"}" from the slider?`)) return;
    setDeleting(img.id);
    try {
      const res = await fetch(`/api/admin/slider/${img.id}`, { method: "DELETE", credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) throw new Error(payload?.message || "Delete failed.");
      showToast("Image removed.", true);
      fetchImages();
    } catch {
      showToast("Delete failed.", false);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5 p-8 mx-auto w-full max-w-[1840px]" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-[13px] font-semibold flex items-center gap-2 transition-all ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-500 text-white"
          }`}>
          {toast.ok
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
          }
          {toast.msg}
        </div>
      )}

      {/* Section heading */}
      <div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f1f5f9] hover:-translate-x-px"
          >Back</button>
          <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
        </div>
        <p className="text-[12px] text-gray-500 mt-0.5">Changes go live on the homepage instantly.</p>
      </div>

      {/* ── Upload area ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <p className="text-[12px] font-bold text-gray-500 uppercase tracking-widest mb-3">Add Image</p>

        {/* Drop zone */}
        <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${preview
          ? "border-indigo-300 bg-indigo-50/30"
          : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/20"
          }`}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {preview ? (
            <div className="w-full space-y-2">
              <img
                src={preview}
                alt="preview"
                className="w-full max-h-36 object-cover rounded-lg shadow-sm"
              />
              <p className="text-[11px] text-gray-500">{file?.name} · {((file?.size ?? 0) / 1024).toFixed(0)} KB · click to change</p>
            </div>
          ) : (
            <>
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <p className="text-[13px] font-semibold text-gray-700">Click to choose image</p>
              <p className="text-[11px] text-gray-400 mt-1">PNG, JPG, WEBP · Best: 1600 × 500 px</p>
            </>
          )}
        </label>

        {/* Label input */}
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Label (optional, for your reference)"
          className="mt-3 w-full px-4 py-2.5 text-[13px] text-gray-900 border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300"
        />

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            {uploading ? (
              <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Uploading…</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>Upload</>
            )}
          </button>
          {preview && (
            <button onClick={clearForm}
              className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Current images ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] font-bold text-gray-500 uppercase tracking-widest">Live Images</p>
          <span className="text-[11px] text-gray-400 font-mono">
            {loading ? "…" : `${images.length} image${images.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-xl bg-gray-100 animate-pulse" style={{ aspectRatio: "16/5" }} />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-400">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="text-[13px]">No images yet — upload one above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {images.map((img, i) => {
              const createdAt = img.created_at ?? img.createdAt;
              return (
              <div key={img.id} className="group relative rounded-xl overflow-hidden border border-gray-100">
                <img
                  src={(img.imageUrl ?? img.image_url ?? "")}
                  alt={img.title ?? `slide ${i + 1}`}
                  className="w-full object-cover"
                  style={{ aspectRatio: "16/5" }}
                />

                {/* Position number */}
                <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/50 text-white text-[11px] font-bold flex items-center justify-center">
                  {i + 1}
                </div>

                {/* Hover — delete */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleDelete(img)}
                    disabled={deleting === img.id}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-[12px] font-bold rounded-xl transition-colors shadow-lg"
                  >
                    {deleting === img.id
                      ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                      </svg>
                    }
                    {deleting === img.id ? "Removing…" : "Remove"}
                  </button>
                </div>

                {/* Title + date footer */}
                {(img.title || createdAt) && (
                  <div className="bg-white px-3 py-2 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-[12px] font-medium text-gray-700 truncate">{img.title || "—"}</p>
                    <p className="text-[10px] text-gray-400 font-mono flex-shrink-0 ml-2">
                      {createdAt ? new Date(createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
