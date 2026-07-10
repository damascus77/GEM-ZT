import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'GEM-ZT',
  description: 'Self-hosted ZeroTier network controller',
};

// Runs before paint (no theme flash): default to dark, honor a stored 'light' choice.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark');}else{document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the CSP nonce passed from middleware via x-csp-nonce header
  const headersList = await headers();
  const nonce = headersList.get('x-csp-nonce') ?? '';
  if (!nonce && process.env.NODE_ENV === 'development') {
    console.warn(
      '[CSP] No nonce received from middleware — inline theme script may be blocked by CSP'
    );
  }
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="bg-canvas-soft font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
