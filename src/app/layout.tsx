import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PEAGC | Golf Club Operating System",
  description:
    "Thai-first operating system for PEA Golf Club member, event, payment, pairing, and competition workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
