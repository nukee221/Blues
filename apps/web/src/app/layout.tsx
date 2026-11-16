import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TabBar } from '@/components/TabBar';
import { getCurrentPlayer } from '@/lib/auth';

export const metadata: Metadata = { title: 'Huntsville Golf Tour' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentPlayer();
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-xl px-4 pb-24 pt-6">{children}</main>
        {current?.player && <TabBar isCommissioner={current.player.is_commissioner} />}
      </body>
    </html>
  );
}
