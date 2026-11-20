/** Profile photos: small JPEGs (the browser resizes to 256x256 before upload). */
export const PHOTO_SIZE = 256;
export const MAX_PHOTO_BYTES = 120_000;

/** The decoded bytes of a base64 JPEG within the size limit, else null. */
export function decodeJpegBase64(b64: string): Buffer | null {
  if (!b64 || b64.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > MAX_PHOTO_BYTES || bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

/** Where a player's photo is served, or null without one. `v` changes with each new photo. */
export function photoUrl(playerId: string, version: number | null | undefined): string | null {
  return version && version > 0 ? `/photo/${playerId}?v=${version}` : null;
}
