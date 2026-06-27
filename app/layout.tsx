import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  display: 'swap',
  variable: '--font-ui',
});

export const metadata: Metadata = {
  title: 'Playable Studio',
  description: 'AI playable editor for batch creative generation.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
