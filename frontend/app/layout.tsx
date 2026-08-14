import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vouch — unterbesicherte FXRP-Kredite über Flare Confidential Compute",
  description:
    "Ein Bürge, der die Chain nicht belastet: Kreditwürdigkeit wird in einer versiegelten Enklave berechnet, nicht öffentlich gespeichert.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
