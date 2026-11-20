/**
 * Screens already restyled in the poster look: they draw straight on the dark background. Every
 * other screen still sits on a light card until it is restyled (roadmap step 13).
 */
const DARK: RegExp[] = [/^\/$/, /^\/login$/, /^\/standings$/, /^\/me$/, /^\/events$/, /^\/events\/[^/]+$/];

export function isDarkPage(path: string): boolean {
  const p = path.split('?')[0]!.replace(/(.)\/$/, '$1') || '/';
  return DARK.some((re) => re.test(p));
}
