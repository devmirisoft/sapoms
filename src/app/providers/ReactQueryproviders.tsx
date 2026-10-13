// providers/ReactQueryProvider.tsx
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { getQueryClient } from "@/lib/queryClient";

export default function ReactQueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(getQueryClient);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
