import type { Metadata } from "next";

export const metadata: Metadata = {
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
      <body className="min-h-screen bg-gray-100">{children}</body>
    </html>
  );
}
