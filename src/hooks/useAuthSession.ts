"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthSession } from "@/lib/roleAccess";
import { CURRENT_USER_KEY, fetchCurrentSession } from "@/lib/currentUser";
import { getQueryClient } from "@/lib/queryClient";

type ResolvedAuth =
  | { loading: true; session: null }
  | { loading: false; session: AuthSession };

type RetriableAxiosConfig = InternalAxiosRequestConfig & { _sessionRefreshRetried?: boolean };

let refreshPromise: Promise<boolean> | null = null;
let axiosInterceptorInstalled = false;
let nativeFetch: typeof fetch | null = null;

async function refreshSession() {
  if (!refreshPromise) {
    const doRefresh = (): Promise<boolean> =>
      (nativeFetch ?? fetch)("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      })
        .then((response) => response.ok)
        .catch(() => false);
    // Refresh tokens rotate on use, so two tabs refreshing at once would revoke each
    // other's token. The lock makes the second tab wait and use the rotated cookie.
    refreshPromise = (navigator.locks ? navigator.locks.request("omsons-auth-refresh", doRefresh).then((ok) => ok) : doRefresh())
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function isRefreshableApiUrl(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return false;
  return url.pathname === "/api/auth/me" || !url.pathname.startsWith("/api/auth/");
}

// Pages call fetch directly and bounce to login on 401, so the refresh has to live
// under fetch itself: an expired access cookie is renewed and the call retried once.
function installFetchSessionRefresh() {
  if (nativeFetch) return;
  const original = window.fetch.bind(window);
  nativeFetch = original;

  window.fetch = async (input, init) => {
    if (!isRefreshableApiUrl(input)) return original(input, init);

    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await original(input, init);
    if (response.status !== 401) return response;
    if (!(await refreshSession())) return response;
    return original(retryInput, init);
  };
}

if (typeof window !== "undefined") installFetchSessionRefresh();

function installAxiosSessionRefresh() {
  if (axiosInterceptorInstalled) return;
  axiosInterceptorInstalled = true;

  axios.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableAxiosConfig | undefined;
      if (!config || error.response?.status !== 401 || config._sessionRefreshRetried) {
        return Promise.reject(error);
      }

      const url = String(config.url ?? "");
      if (url.includes("/api/auth/login") || url.includes("/api/auth/refresh")) {
        return Promise.reject(error);
      }

      const refreshed = await refreshSession();
      if (!refreshed) return Promise.reject(error);

      config._sessionRefreshRetried = true;
      config.withCredentials = true;
      return axios(config);
    },
  );
}

// /api/auth/me kept failing (5xx or network) and there is no earlier session to fall
// back on. RouteGuard treats it like a broken session: clears local state, goes to login.
const UNAVAILABLE: AuthSession = { status: "unauthenticated", reason: "invalid" };

export function useAuthSession(): ResolvedAuth {
  useEffect(installAxiosSessionRefresh, []);

  // Pinned to the app-wide client so pages that mount their own QueryClientProvider
  // still share one current-user entry (and one /api/auth/me request).
  const query = useQuery(
    { queryKey: CURRENT_USER_KEY, queryFn: fetchCurrentSession, staleTime: 60_000, retry: 2 },
    getQueryClient(),
  );

  if (query.data) return { loading: false, session: query.data };
  if (query.isError) return { loading: false, session: UNAVAILABLE };
  return { loading: true, session: null };
}

