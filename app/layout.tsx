import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Quantus 本地钱包',
  description: '在浏览器本地管理 Quantus 钱包、查询余额和签名转账。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
