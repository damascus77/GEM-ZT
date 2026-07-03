import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'GEM-ZT',
  description: 'Self-hosted ZeroTier network controller',
};

// Runs before paint (no theme flash): default to dark, honor a stored 'light' choice.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark');}else{document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="bg-canvas-soft text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
