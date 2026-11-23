import type { MetadataRoute } from "next";

/** Lets members add the club to their home screen with the crest as the app icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    description: "สมัครกิจกรรมออกรอบ จองรอบเรียนกอล์ฟ และดูผลการแข่งขันของชมรม",
    display: "standalone",
    icons: [
      { sizes: "192x192", src: "/icons/icon-192.png", type: "image/png" },
      { sizes: "512x512", src: "/icons/icon-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/icon-maskable-512.png", type: "image/png" },
    ],
    lang: "th",
    name: "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค",
    short_name: "PEAGC",
    start_url: "/",
    theme_color: "#722257",
  };
}
