"use client";

// Last-resort error page when the root layout itself fails; it renders without the app's CSS.
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ alignItems: "center", background: "#f2f5f8", color: "#2f3137", display: "flex", fontFamily: "Sarabun, 'Noto Sans Thai', sans-serif", justifyContent: "center", margin: 0, minHeight: "100vh", padding: 16 }}>
        <main style={{ background: "#fff", border: "1px solid #f3c6cb", borderRadius: 16, maxWidth: 440, padding: 32, textAlign: "center" }}>
          <h1 style={{ color: "#722257", fontSize: 22, margin: 0 }}>เกิดข้อผิดพลาดชั่วคราว</h1>
          <p style={{ color: "#6b6475", fontSize: 14, lineHeight: 1.8 }}>ระบบโหลดหน้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังเป็นอยู่กรุณาแจ้งผู้ดูแลระบบ</p>
          <button onClick={() => unstable_retry()} style={{ background: "#722257", border: 0, borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, height: 44, padding: "0 20px" }} type="button">
            ลองใหม่อีกครั้ง
          </button>
        </main>
      </body>
    </html>
  );
}
