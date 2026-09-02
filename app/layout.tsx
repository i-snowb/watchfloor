import type { Metadata } from "next";
import "./globals.css";
import "./workbench.css";
import "./convergence.css";
import "./causal-field.css";
import "./demo-path.css";
import "./graph-readability.css";

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const metadataBase = new URL(
  configuredSiteUrl ??
    "https://watchfloor-sandbox.watchfloor-webmcp.workers.dev",
);

export const metadata: Metadata = {
  metadataBase,
  title: "WATCH//FLOOR · Agentic security investigations",
  description:
    "Bring your own WebMCP agent or harness. Investigate bounded evidence while analysts retain every consequential decision.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "WATCH//FLOOR",
    description:
      "Bring your own WebMCP agent or harness. Agents investigate; analysts decide.",
    type: "website",
    images: [
      {
        url: "/og.jpg",
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
      "Bring your own WebMCP agent or harness. Agents investigate; analysts decide.",
    images: ["/og.jpg"],
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
