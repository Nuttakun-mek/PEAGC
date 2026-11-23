"use client";

// Last-resort error page when the root layout itself fails. It replaces the root layout, so the
// app's CSS (Tailwind tokens) and the Sarabun font are not loaded: styles are inline and the hex
// values below mirror the tokens in globals.css (canvas, line, ink, ink-muted, brand-600).
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="th">
      <head>
        <title>เกิดข้อผิดพลาดชั่วคราว</title>
      </head>
      <body style={{ alignItems: "center", background: "#f8fafc", color: "#1f2937", display: "flex", fontFamily: "Sarabun, 'Noto Sans Thai', sans-serif", justifyContent: "center", lineHeight: 1.625, margin: 0, minHeight: "100vh", padding: 16 }}>
        <main style={{ background: "#ffffff", border: "1px solid #e2e8ef", borderRadius: 16, boxShadow: "0 1px 2px rgba(16, 24, 40, 0.05)", boxSizing: "border-box", maxWidth: 448, padding: 32, width: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image needs the app shell, which failed */}
          <img alt="ตราชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค" height={52} src="/brand/peagc-crest-256.png" style={{ display: "block" }} width={52} />
          <h1 style={{ color: "#722257", fontSize: 26, fontWeight: 600, lineHeight: "34px", margin: "24px 0 0" }}>เกิดข้อผิดพลาดชั่วคราว</h1>
          <p style={{ color: "#475467", fontSize: 16, margin: "8px 0 0" }}>โหลดหน้าไม่สำเร็จ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลชมรม</p>
          {error.digest ? <p style={{ color: "#667085", fontSize: 13, margin: "8px 0 0" }}>รหัสอ้างอิง {error.digest}</p> : null}
          <button
            onClick={() => unstable_retry()}
            style={{ background: "#722257", border: 0, borderRadius: 8, color: "#ffffff", cursor: "pointer", fontFamily: "inherit", fontSize: 16, fontWeight: 600, height: 48, marginTop: 24, padding: "0 20px", width: "100%" }}
            type="button"
          >
            ลองใหม่อีกครั้ง
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load is the point when the root layout failed */}
          <a href="/" style={{ alignItems: "center", border: "1px solid #e2e8ef", borderRadius: 8, boxSizing: "border-box", color: "#722257", display: "flex", fontSize: 16, fontWeight: 600, height: 48, justifyContent: "center", marginTop: 12, textDecoration: "none", width: "100%" }}>
            กลับหน้าหลัก
          </a>
        </main>
      </body>
    </html>
  );
}
