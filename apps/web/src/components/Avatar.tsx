import { photoUrl } from '@/lib/photo';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
}

/** A player's round photo, or their initials in gold on navy when they have none. Decorative: the name is always shown next to it. */
export function Avatar({ playerId, name, photoVersion, size = 40 }: { playerId: string; name: string; photoVersion: number | null | undefined; size?: number }) {
  const url = photoUrl(playerId, photoVersion);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- tiny cached avatar from our own route
    <img src={url} alt="" width={size} height={size} loading="lazy" style={style} className="shrink-0 rounded-full border-2 border-gold-400/80 object-cover" />
  ) : (
    <span aria-hidden="true" style={style} className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-gold-400/60 bg-navy-700 font-label font-semibold text-gold-300">
      {initials(name)}
    </span>
  );
}
