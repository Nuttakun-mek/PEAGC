import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ThaiFormValidation } from "@/components/thai-form-validation";

import "./globals.css";

// Three weights only: 400 body, 500 labels and badges, 600 headings and buttons.
const sarabun = localFont({
  display: "swap",
  variable: "--font-sarabun",
  src: [
    { path: "./fonts/Sarabun-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Sarabun-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Sarabun-SemiBold.ttf", weight: "600", style: "normal" },
  ],
});

const siteUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://peagc.vercel.app").replace(/\/$/, "");
const clubName = "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";
const description = "สมัครกิจกรรมออกรอบ จองรอบเรียนกอล์ฟ และดูผลการแข่งขันของชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";

export const metadata: Metadata = {
  applicationName: "PEAGC",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "PEAGC" },
  description,
  metadataBase: new URL(siteUrl),
  openGraph: {
    description,
    locale: "th_TH",
    siteName: clubName,
    title: clubName,
    type: "website",
  },
  title: { default: clubName, template: `%s · ${clubName}` },
};

export const viewport: Viewport = {
  themeColor: "#722257",
  // Lets the phone tab bars pad for the iPhone home indicator via env(safe-area-inset-bottom).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`h-full antialiased ${sarabun.variable}`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThaiFormValidation />
        {children}
      </body>
    </html>
  );
}
