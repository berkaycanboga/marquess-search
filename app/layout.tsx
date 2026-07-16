import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Esans Fiyat Karşılaştırma",
  description: "esans.com.tr, Felicita Fragrances ve Shopier üzerinden esans fiyat/gram karşılaştırma.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
