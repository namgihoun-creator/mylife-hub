"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { initPwaInstallCapture } from "@/shared/hooks/use-pwa-install";

// Attach the install-event listeners as early as possible: `beforeinstallprompt` can fire before the header mounts.
initPwaInstallCapture();

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session (created lazily, stable across re-renders).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
