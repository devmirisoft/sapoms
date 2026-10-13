import { QueryClient, isServer } from "@tanstack/react-query";

let browserQueryClient: QueryClient | undefined;

// One client per browser tab, so code outside React (logout, cross-tab sync, plain
// helpers) reaches the same cache the components use. The server gets a fresh one
// per render so no user's data is shared between requests.
export function getQueryClient() {
  if (isServer) return new QueryClient();
  browserQueryClient ??= new QueryClient();
  return browserQueryClient;
}
