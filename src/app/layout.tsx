import type { Metadata } from "next";
import "./globals.css";

import ReactQueryProvider from "@/app/providers/ReactQueryproviders";
import DealerTermsGate from "@/components/terms/DealerTermsGate";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Omsons",
  description: "Omsons Germany",
  icons: {
    icon: "/omsons_logo.jpeg",
    shortcut: "/omsons_logo.jpeg",
    apple: "/omsons_logo.jpeg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="antialiased">
        <ReactQueryProvider>
          <Toaster>
            <DealerTermsGate />
            {children}
          </Toaster>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
