import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="th" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
