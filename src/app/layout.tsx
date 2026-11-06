import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  display: "swap",
  subsets: ["thai", "latin"],
  variable: "--font-sarabun",
  weight: ["400", "500", "600", "700"],
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
