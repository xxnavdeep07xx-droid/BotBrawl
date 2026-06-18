"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Wrap the app with a React Query client. Required by every component
 * that uses useQuery / useMutation.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
