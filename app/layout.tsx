import type { Metadata } from "next";
import "./globals.css";
import "./workbench.css";
import "./convergence.css";
import "./causal-field.css";
import "./demo-path.css";
import "./graph-readability.css";

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
);

export const metadata: Metadata = {
  metadataBase,
  title: "WATCH//FLOOR · Agentic security investigations",
  description:
    "TRACE investigates bounded case evidence through WebMCP. Analysts review, authorize, and close the case.",
  openGraph: {
    title: "WATCH//FLOOR",
    description:
      "TRACE investigates bounded evidence. Analysts review, authorize, and close the case.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "WATCH//FLOOR evidence and impact map for a security investigation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WATCH//FLOOR",
    description:
      "TRACE investigates bounded evidence. Analysts review, authorize, and close the case.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
