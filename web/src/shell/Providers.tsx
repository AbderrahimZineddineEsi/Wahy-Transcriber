import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./theme";
import { ToastProvider, useToasts } from "./toasts";

/** Language, theme, toasts and the server-state cache, in the order each one needs the one before it. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <QueryProvider>{children}</QueryProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

// Every failed query or mutation becomes an error toast, unless the query says `meta: { silent: true }`
// (the health poll does: the header badge already shows an unreachable server).
function QueryProvider({ children }: { children: ReactNode }) {
  const toasts = useToasts();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (!query.meta?.silent) toasts.error(error);
          },
        }),
        mutationCache: new MutationCache({ onError: (error) => toasts.error(error) }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
