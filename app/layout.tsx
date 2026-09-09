import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "네이버 블로그 자동화",
  description: "키워드로 글감을 찾아 글을 쓰고 네이버 블로그에 발행하는 로컬 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
