import "server-only";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

const required = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

function getEnv(name: (typeof required)[number]) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Cloudinary slider storage`);
  return value;
}

cloudinary.config({
  cloud_name: getEnv("CLOUDINARY_CLOUD_NAME"),
  api_key: getEnv("CLOUDINARY_API_KEY"),
  api_secret: getEnv("CLOUDINARY_API_SECRET"),
  secure: true,
});

export { cloudinary };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Validation errors carry status 400 so routes can tell them from upload failures.
export async function uploadImage(file: File, folder: string) {
  if (!file.type.startsWith("image/")) throw Object.assign(new Error("Only image uploads are allowed"), { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) throw Object.assign(new Error("Image must be 5 MB or smaller"), { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        // Cloudinary rejects with a plain { message, http_code } object; surface its 4xx
        // (bad format, too large for plan...) as our status-400 validation error.
        if (error || !result) {
          const status = error?.http_code && error.http_code < 500 ? 400 : undefined;
          reject(Object.assign(new Error(error?.message || "Cloudinary upload failed"), { status }));
        }
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}
