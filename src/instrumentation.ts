// Runs once when a Next.js server starts.
export async function register() {
  // Node server only, never while `next build` collects pages, and only where explicitly enabled (the EC2 container).
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.BIZCARD_EMAILS_ENABLED !== "true") return;

  const { startBizcardEmailListener } = await import("@/server/notify/bizcard-email");
  startBizcardEmailListener();
}
