import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vouch — unsecured FXRP credit lines via Flare Confidential Compute",
  description:
    "A guarantor that never burdens the chain: creditworthiness is computed inside a sealed enclave, not stored publicly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
