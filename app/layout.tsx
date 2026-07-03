import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'GEM-ZT',
  description: 'Self-hosted ZeroTier network controller',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-canvas-soft text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
