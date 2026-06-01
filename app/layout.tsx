import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Playable Studio',
  description: 'AI playable editor for batch creative generation.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
