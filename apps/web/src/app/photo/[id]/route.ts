import { z } from 'zod';
import { getCurrentPlayer } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decodeJpegBase64 } from '@/lib/photo';

/**
 * A player's profile photo, for signed-in players only (the middleware also keeps signed-out
 * visitors away). Pages link it as /photo/<id>?v=<photo_version>, so a new photo is a new URL
 * and each one can be cached for a long time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentPlayer();
  if (!current?.player) return new Response('Sign in to see photos', { status: 401 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return new Response('Not found', { status: 404 });
  const { data } = await createAdminClient().from('player_photos').select('jpeg_base64').eq('player_id', id.data).maybeSingle();
  const bytes = data ? decodeJpegBase64(String(data.jpeg_base64)) : null;
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
