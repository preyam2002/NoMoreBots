import type { Metadata } from "next";
import "./globals.css";

const metadataBase = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: "NoMoreBots - AI Tweet Filter Dashboard",
  description: "Filter AI-generated tweets on X/Twitter with advanced AI detection",
  keywords: ["AI", "Twitter", "X", "filter", "bot detection"],
  authors: [{ name: "Preyam" }],
  openGraph: {
    title: "NoMoreBots Dashboard",
    description: "Filter AI-generated tweets on X/Twitter",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="nmb-shell">{children}</body>
    </html>
  );
}
