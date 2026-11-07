import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sarabun = localFont({
  display: "swap",
  variable: "--font-sarabun",
  src: [
    { path: "./fonts/Sarabun-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Sarabun-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Sarabun-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Sarabun-Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "PEAGC | ระบบบริหารชมรมกอล์ฟ",
  description:
    "ระบบบริหารสมาชิก กิจกรรม การเรียนกอล์ฟ และการแข่งขันของชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`h-full antialiased ${sarabun.variable}`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
