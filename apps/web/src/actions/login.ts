'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { originFromHeaders } from '@/lib/publicOrigin';
import { allowLoginRequest, clientIp } from '@/lib/loginLimit';

/** Supabase Auth's email rate limit / resend cooldown (429, over_email_send_rate_limit, "for security purposes ... after N seconds"). */
function isRateLimit(e: { status?: number; code?: string; message?: string }): boolean {
  return e.status === 429 || /rate_limit/i.test(e.code ?? '') || /rate limit|security purposes|after \d+ seconds/i.test(e.message ?? '');
}

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email');

/**
 * Email a magic sign-in link, but only to an email on the players roster. Any other email gets
 * the same neutral answer and no email, and no auth user is created: auth users are created
 * here, server-side, for roster emails only, and the link is requested with
 * shouldCreateUser: false (sign-ups are also disabled in Supabase Auth, see RUNBOOK).
 *
 * The OTP is requested through the cookie-session client, so @supabase/ssr stores the PKCE code
 * verifier as a cookie on THIS response, in the browser that will open the link; /auth/callback
 * exchanges the code with it and links the player by email.
 */
export async function requestSignInLink(email: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    const address = emailSchema.parse(email);
    const h = await headers();
    if (!allowLoginRequest(clientIp(h))) {
      console.warn('[login] per-IP limit hit');
      return null; // neutral: same answer as an unknown email
    }
    const admin = createAdminClient();
    const { data: player, error } = await admin.from('players').select('id, user_id').eq('email', address).maybeSingle();
    if (error) throw new Error(error.message);
    if (!player) return null; // neutral: not on the roster, nothing sent, nothing created

    if (!player.user_id) {
      const created = await admin.auth.admin.createUser({ email: address, email_confirm: true });
      if (created.error && created.error.code !== 'email_exists' && !/already|registered|exists/i.test(created.error.message)) {
        throw new Error(created.error.message);
      }
    }

    const origin = originFromHeaders(h, 'http://localhost:3000');
    const supabase = await createServerClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
    });
    if (otpError) {
      if (isRateLimit(otpError)) {
        // Neutral, like an unknown email: a distinct message would reveal that the address is on the roster.
        console.warn('[login] magic link rate limited by auth', otpError.message);
        return null;
      }
      console.error('[login] magic link send failed', otpError.message);
      throw new ActionError(ACT.emailFailed, 'Could not send the link. Try again in a minute.');
    }
    return null;
  });
}
