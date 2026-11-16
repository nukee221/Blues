import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';

export type PlayerRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  name: string;
  email: string;
  handicap_index: number | null;
  handicap_source: 'GHIN' | 'TheGrint' | '18Birdies' | 'Other' | null;
  is_commissioner: boolean;
  pin_hash: string | null;
};

/** Current session's user and own player row (RLS lets a player read only their own row). Null when signed out. */
export async function getCurrentPlayer(): Promise<{ userId: string; player: PlayerRow | null } | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: player } = await supabase.from('players').select('*').eq('user_id', data.user.id).maybeSingle();
  return { userId: data.user.id, player: (player as PlayerRow | null) ?? null };
}

export async function requireUser(): Promise<{ userId: string; player: PlayerRow }> {
  const current = await getCurrentPlayer();
  if (!current) redirect('/login');
  if (!current.player) redirect('/login?error=not-on-roster');
  return { userId: current.userId, player: current.player };
}

export async function requireCommissioner(): Promise<{ userId: string; player: PlayerRow }> {
  const result = await requireUser();
  if (!result.player.is_commissioner) redirect('/forbidden');
  return result;
}

export type LinkResult = { ok: true } | { ok: false; reason: 'not-on-roster' };

/**
 * Link an auth user to the players row with the same email. Must be given the
 * service-role client: players.user_id is not writable by the browser role.
 */
export async function linkPlayerByEmail(
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<LinkResult> {
  if (!user.email) return { ok: false, reason: 'not-on-roster' };
  const { data: row } = await admin.from('players').select('id, user_id').eq('email', user.email).maybeSingle();
  if (!row) return { ok: false, reason: 'not-on-roster' };
  if (row.user_id === user.id) return { ok: true };
  if (row.user_id) return { ok: false, reason: 'not-on-roster' };
  const { error } = await admin.from('players').update({ user_id: user.id }).eq('id', row.id).is('user_id', null);
  if (error) return { ok: false, reason: 'not-on-roster' };
  return { ok: true };
}
