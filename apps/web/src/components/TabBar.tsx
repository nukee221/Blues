'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icons';

const BASE_TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/events', label: 'Events', icon: 'events' },
  { href: '/standings', label: 'Standings', icon: 'standings' },
  { href: '/c', label: 'Code', icon: 'code' },
  { href: '/me', label: 'Me', icon: 'me' },
];

/** Bottom tabs: an icon with a short label under it, equal widths, clear of the phone's home bar. */
export function TabBar({ isCommissioner }: { isCommissioner: boolean }) {
  const pathname = usePathname();
  const tabs = isCommissioner ? [...BASE_TABS, { href: '/admin', label: 'Admin', icon: 'admin' as IconName }] : BASE_TABS;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-brandred-600 bg-navy-900 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                  active ? 'text-gold-400' : 'text-silver-300'
                }`}
              >
                <Icon name={t.icon} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
