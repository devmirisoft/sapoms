"use client";

import { useEffect, useState } from "react";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearAuthStorage, normalizeRoleFromProfile, persistAuthenticatedSession, roleTypeForRole, type AuthSession, type StoredUser } from "@/lib/roleAccess";

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

async function fetchCurrentSession(): Promise<AuthSession> {
  const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
  if (!res.ok) return { status: "unauthenticated", reason: "missing" };

  const json = await res.json();
  const data = json?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "unauthenticated", reason: "invalid" };
  }

  const user = data as StoredUser;
  const role = normalizeRoleFromProfile(user);
  if (!role) return { status: "unauthenticated", reason: "unsupported-role" };

  return {
    status: "authenticated",
    role,
    roletype: roleTypeForRole(role, user),
    user: { ...user, role },
  };
}

export function useAuthSession(): ResolvedAuth {
  const [state, setState] = useState<ResolvedAuth>({ loading: true, session: null });

  useEffect(() => {
    installAxiosSessionRefresh();
    let cancelled = false;

    const resolve = async () => {
      try {
        const session = await fetchCurrentSession();
        if (!cancelled) {
          if (session.status === "authenticated") persistAuthenticatedSession(localStorage, session.user, session.role);
          setState({ loading: false, session });
        }
      } catch {
        if (!cancelled) setState({ loading: false, session: { status: "unauthenticated", reason: "invalid" } });
      }
    };

    void resolve();

    const handleAuthChanged = () => void resolve();
    window.addEventListener("storage", handleAuthChanged);
    window.addEventListener("omsons-auth-changed", handleAuthChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleAuthChanged);
      window.removeEventListener("omsons-auth-changed", handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!state.loading && state.session.status !== "authenticated" && state.session.reason !== "missing") {
      clearAuthStorage(localStorage);
    }
  }, [state]);

  return state;
}
