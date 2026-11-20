'use server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { decodeJpegBase64 } from '@/lib/photo';

const clubSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(60, 'Keep the club name under 60 characters'));

/** Set (or clear, when blank) the signed-in player's home club, on their own row via their own client. */
export async function saveHomeClub(club: string): Promise<ActionResult<null>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const value = clubSchema.parse(club) || null;
    const supabase = await createServerClient();
    const { data, error } = await supabase.from('players').update({ home_club: value }).eq('id', player.id).select('id');
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== 1) throw new ActionError(ACT.notFound, 'Your player record was not found');
    return null;
  });
}

/**
 * Save the signed-in player's profile photo (a base64 JPEG already resized in the browser).
 * player_photos has no client access, so this writes with the service role, for the caller only.
 */
export async function savePhoto(jpegBase64: string): Promise<ActionResult<null>> {
  const { player } = await requireUser();
  return toResult(async () => {
    if (typeof jpegBase64 !== 'string' || !decodeJpegBase64(jpegBase64)) {
      throw new ActionError(ACT.invalid, 'That photo could not be used. Try another picture.');
    }
    const admin = createAdminClient();
    const { error } = await admin
      .from('player_photos')
      .upsert({ player_id: player.id, jpeg_base64: jpegBase64, updated_at: new Date().toISOString() }, { onConflict: 'player_id' });
    if (error) throw new Error(error.message);
    const { data: row, error: rErr } = await admin.from('players').select('photo_version').eq('id', player.id).single();
    if (rErr) throw new Error(rErr.message);
    // Upload time in seconds (never reused, even after a removal), and always above the last one.
    const version = Math.max(Number(row.photo_version ?? 0) + 1, Math.floor(Date.now() / 1000));
    const { error: uErr } = await admin.from('players').update({ photo_version: version }).eq('id', player.id);
    if (uErr) throw new Error(uErr.message);
    return null;
  });
}

/** Remove the signed-in player's photo. */
export async function removePhoto(): Promise<ActionResult<null>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const admin = createAdminClient();
    const { error } = await admin.from('player_photos').delete().eq('player_id', player.id);
    if (error) throw new Error(error.message);
    const { error: uErr } = await admin.from('players').update({ photo_version: 0 }).eq('id', player.id);
    if (uErr) throw new Error(uErr.message);
    return null;
  });
}
