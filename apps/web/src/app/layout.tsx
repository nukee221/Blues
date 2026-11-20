import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TabBar } from '@/components/TabBar';
import { Icon } from '@/components/Icons';
import { getCurrentPlayer } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Huntsville Golf Tour',
  icons: { icon: '/brand/flag-icon.png', apple: '/brand/flag-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0a1838' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The scorecard (/c/<code>) is cached offline by a service worker, so it must not carry the
  // signed-in tab bar (or anything else about the account). Middleware sets x-hgt-path on every request.
  const onScorecard = ((await headers()).get('x-hgt-path') ?? '').startsWith('/c/');
  const current = onScorecard ? null : await getCurrentPlayer();
  return (
    <html lang="en">
      <body>
        <header className="border-b-2 border-brandred-600 bg-navy-900">
          <div className="mx-auto flex max-w-xl items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
            <Link href="/" className="flex min-h-[52px] items-center gap-3 font-display text-lg font-bold text-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static mark, no optimizer needed */}
              <img src="/brand/flag-icon.png" alt="" width={36} height={36} className="h-9 w-9" />
              Huntsville Golf Tour
            </Link>
            {current?.player && (
              <Link href="/" aria-label="Home" className="flex h-11 w-11 items-center justify-center rounded-full text-silver-300 hover:text-gold-400">
                <Icon name="home" className="h-7 w-7" />
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
          <div className="card p-4">{children}</div>
        </main>
        {current?.player && <TabBar isCommissioner={current.player.is_commissioner} />}
      </body>
    </html>
  );
}
