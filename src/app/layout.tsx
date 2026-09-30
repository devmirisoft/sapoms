import type { Metadata } from "next";
import "./globals.css";

import ReactQueryProvider from "@/app/providers/ReactQueryproviders";
import DealerTermsGate from "@/components/terms/DealerTermsGate";
import DealerPasswordGate from "@/components/password/DealerPasswordGate";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Omsons",
  description: "Omsons Germany",
  icons: {
    icon: "/Omsons_Logo.png",
    shortcut: "/Omsons_Logo.png",
    apple: "/Omsons_Logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" className={cn("font-sans", geist.variable)}>
      <body className="antialiased">
        <ReactQueryProvider>
          <Toaster limit={5}>
            <DealerTermsGate />
            <DealerPasswordGate />
            {children}
          </Toaster>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
