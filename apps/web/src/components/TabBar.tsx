'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BASE_TABS = [
  { href: '/events', label: 'Events' },
  { href: '/standings', label: 'Standings' },
  { href: '/enter-code', label: 'Enter Code' },
  { href: '/me', label: 'Me' },
];

export function TabBar({ isCommissioner }: { isCommissioner: boolean }) {
  const pathname = usePathname();
  const tabs = isCommissioner ? [...BASE_TABS, { href: '/admin', label: 'Admin' }] : BASE_TABS;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-slate-900 bg-white">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[48px] items-center justify-center px-1 text-sm font-semibold ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-900'
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
