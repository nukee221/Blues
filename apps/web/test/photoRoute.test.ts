import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeDb';

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>, getCurrentPlayer: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentPlayer: h.getCurrentPlayer }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => h.db.from(t) }) }));

import { GET } from '@/app/photo/[id]/route';

const ID = '44444444-4444-4444-8444-000000000001';
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const get = (id: string) => GET(new Request(`http://x/photo/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.db = createFakeDb({ player_photos: [{ player_id: ID, jpeg_base64: bytes.toString('base64') }] });
  h.getCurrentPlayer.mockResolvedValue({ userId: 'u', player: { id: 'someone' } });
});

describe('/photo/<id>', () => {
  it('serves the JPEG to a signed-in player, cacheable', async () => {
    const r = await get(ID);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toMatch(/private/);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes);
  });
  it('401 when signed out; 404 for no photo or a bad id', async () => {
    h.getCurrentPlayer.mockResolvedValueOnce(null);
    expect((await get(ID)).status).toBe(401);
    expect((await get('44444444-4444-4444-8444-000000000009')).status).toBe(404);
    expect((await get('nope')).status).toBe(404);
  });
});
