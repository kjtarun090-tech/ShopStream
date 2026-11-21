import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ShopStream — Real-Time Retail & Inventory Platform",
  description: "Next.js 14 storefront connected to FastAPI, PostgreSQL 16, Kafka 3.7, and OpenSearch 2.x.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`}>
      <body className="bg-[#F1F5F9] text-[#0F172A] antialiased">{children}</body>
    </html>
  );
}
