import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeDb';

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  requireUser: vi.fn(),
  serverFrom: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: h.requireUser }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: (t: string) => h.serverFrom(t) }) }));

import { removePhoto, saveHomeClub, savePhoto } from '@/actions/profile';
import { decodeJpegBase64, MAX_PHOTO_BYTES } from '@/lib/photo';

const ME = '44444444-4444-4444-8444-000000000001';
const OTHER = '44444444-4444-4444-8444-000000000002';
const jpeg = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]).toString('base64');
const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);

beforeEach(() => {
  h.db = createFakeDb({
    players: [
      { id: ME, name: 'Me', home_club: null, photo_version: 0 },
      { id: OTHER, name: 'Other', home_club: null, photo_version: 0 },
    ],
    player_photos: [],
  }, { player_photos: ['player_id'] });
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue({ userId: 'u', player: { id: ME } });
  h.serverFrom.mockReset();
  h.serverFrom.mockImplementation((t: string) => h.db.from(t));
});

describe('decodeJpegBase64', () => {
  it('accepts a JPEG within the size limit', () => {
    expect(decodeJpegBase64(jpeg())?.length).toBe(104);
  });
  it('rejects non-JPEG data, bad base64 and oversize photos', () => {
    expect(decodeJpegBase64(Buffer.from('GIF89a....').toString('base64'))).toBeNull();
    expect(decodeJpegBase64('not base64!!')).toBeNull();
    expect(decodeJpegBase64('')).toBeNull();
    expect(decodeJpegBase64(jpeg(MAX_PHOTO_BYTES))).toBeNull();
  });
});

describe('saveHomeClub', () => {
  it("sets the trimmed club on the caller's own row with the user's client", async () => {
    expect(codeOf(await saveHomeClub('  Cherokee Ridge  '))).toBe('ok');
    expect(h.db.tables.players!.find((p) => p.id === ME)!.home_club).toBe('Cherokee Ridge');
    expect(h.db.tables.players!.find((p) => p.id === OTHER)!.home_club).toBeNull();
    expect(h.serverFrom).toHaveBeenCalledWith('players');
  });
  it('blank clears it; too long is invalid', async () => {
    await saveHomeClub('Cherokee Ridge');
    expect(codeOf(await saveHomeClub('   '))).toBe('ok');
    expect(h.db.tables.players!.find((p) => p.id === ME)!.home_club).toBeNull();
    expect(codeOf(await saveHomeClub('x'.repeat(61)))).toBe('invalid');
  });
});

describe('savePhoto / removePhoto', () => {
  it('stores the photo for the caller and bumps photo_version', async () => {
    expect(codeOf(await savePhoto(jpeg()))).toBe('ok');
    expect(h.db.tables.player_photos).toEqual([expect.objectContaining({ player_id: ME, jpeg_base64: jpeg() })]);
    const v1 = Number(h.db.tables.players!.find((p) => p.id === ME)!.photo_version);
    expect(v1).toBeGreaterThan(1_700_000_000); // upload time, so a later photo never reuses a number
    await savePhoto(jpeg(50));
    expect(h.db.tables.player_photos).toHaveLength(1);
    expect(Number(h.db.tables.players!.find((p) => p.id === ME)!.photo_version)).toBe(v1 + 1);
  });
  it('refuses anything that is not a small JPEG', async () => {
    expect(codeOf(await savePhoto('nope'))).toBe('invalid');
    expect(h.db.tables.player_photos).toHaveLength(0);
  });
  it('remove deletes the photo and resets the version', async () => {
    await savePhoto(jpeg());
    expect(codeOf(await removePhoto())).toBe('ok');
    expect(h.db.tables.player_photos).toHaveLength(0);
    expect(h.db.tables.players!.find((p) => p.id === ME)!.photo_version).toBe(0);
  });
  it('requires a signed-in player', async () => {
    h.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/login'));
    await expect(savePhoto(jpeg())).rejects.toThrow(/login/);
  });
});
