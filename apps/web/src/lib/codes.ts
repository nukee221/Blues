/** Group codes: no 0/O, 1/I/L so they can be read aloud and typed on a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Uniform [0, 1) from the platform CSPRNG. */
function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

/** A 6-character group code. `rng` (returns [0, 1)) is injectable for tests. */
export function generateGroupCode(rng: () => number = cryptoRandom): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const k = Math.min(CODE_ALPHABET.length - 1, Math.floor(rng() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[k];
  }
  return code;
}
