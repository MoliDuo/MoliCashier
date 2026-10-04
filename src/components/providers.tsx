"use client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QUERY } from "@/lib/constants";
import { SIGN_IN_PATH } from "@/modules/auth/constants";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    let redirectStarted = false;
    const handleError = (error: unknown) => {
      if (getErrorStatus(error) !== 401 || typeof window === "undefined" || redirectStarted) {
        return;
      }
      redirectStarted = true;
      client.clear();
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(currentUrl)}`);
    };
    const client = new QueryClient({
      queryCache: new QueryCache({
        onError: handleError,
      }),
      mutationCache: new MutationCache({ onError: handleError }),
      defaultOptions: {
        queries: {
          staleTime: QUERY.DEFAULT_STALE_TIME_MS, // 5 minutes
          gcTime: 30 * 60 * 1000,
          refetchOnWindowFocus: false,
          refetchOnMount: true,
          refetchOnReconnect: true,
          retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
        },
      },
    });
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster position="top-center" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error == null) return null;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return null;
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (typeof error !== "object" || error == null) return true;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : null;
  return status == null || status === 408 || status === 429 || status >= 500;
}
