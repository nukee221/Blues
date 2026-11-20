/**
 * Screens already restyled in the poster look: they draw straight on the dark background. Every
 * other screen still sits on a light card until it is restyled (roadmap step 13).
 */
const DARK = ['/', '/login', '/standings', '/me'];

export function isDarkPage(path: string): boolean {
  return DARK.includes(path.split('?')[0]!.replace(/\/$/, '') || '/');
}
