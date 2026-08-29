import type { Metadata } from "next";
import "./globals.css";
import "./workbench.css";
import "./convergence.css";
import "./causal-field.css";

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ??
    "https://tracelab-webmcp.keegansnowbarger.chatgpt.site",
);

export const metadata: Metadata = {
  metadataBase,
  title: "TRACE//LAB · Shared security investigation",
  description:
    "A deterministic WebMCP security investigation workbench for analysts and agents.",
  openGraph: {
    title: "TRACE//LAB",
    description: "Human-led. Agent-speed incident response.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "TRACE//LAB interactive security investigation graph",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TRACE//LAB",
    description: "Human-led. Agent-speed incident response.",
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
