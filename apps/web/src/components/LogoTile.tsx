/** An event logo on a small white tile, framed in gold with a red outer trim, sitting on navy. */
export function LogoTile({ src, size = 56 }: { src: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-gold-400 bg-white p-1 shadow-[0_0_0_2px_#0b2154,0_0_0_4px_#b5152b,0_4px_12px_rgba(0,0,0,0.45)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
      <img src={src} alt="" width={size} height={size} className="h-full w-full object-contain" />
    </span>
  );
}
