import bcrypt from 'bcryptjs';
import { ActionError } from '@/lib/actionResult';
import { SG } from '@/lib/signingCodes';
import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

export const NO_PIN = 'Set your PIN in the app (Me → PIN). The commissioner can also sign for you.';

/**
 * Check a player's 4-digit PIN with the shared lockout (signing and "Take over scoring").
 * Throws ActionError: no_pin (none set), pin_locked (five wrong in ten minutes, even for a
 * correct PIN), wrong_pin. The attempt is reserved (recorded as a failure) before comparing,
 * so parallel guesses all count, and marked successful afterwards.
 */
export async function verifyPlayerPin(admin: Admin, playerId: string, pin: string): Promise<void> {
  const { data: who, error: whoError } = await admin.from('players').select('pin_hash').eq('id', playerId).maybeSingle();
  if (whoError) throw new Error(whoError.message);
  const hash = (who as { pin_hash: string | null } | null)?.pin_hash;
  if (!hash) throw new ActionError(SG.noPin, NO_PIN);

  const { data: attempt, error: beginError } = await admin.rpc('pin_attempt_begin', { p_player: playerId });
  if (beginError) throw new Error(beginError.message);
  if (!attempt) throw new ActionError(SG.pinLocked, 'Too many wrong PINs. Try again later.');
  if (!(await bcrypt.compare(pin, hash).catch(() => false))) throw new ActionError(SG.wrongPin, 'Wrong PIN');
  const { error: okError } = await admin.rpc('pin_attempt_succeeded', { p_attempt: attempt });
  if (okError) throw new Error(okError.message);
}
