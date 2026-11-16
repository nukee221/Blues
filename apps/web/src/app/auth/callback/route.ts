import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { linkPlayerByEmail } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, origin));

  const code = searchParams.get('code');
  if (!code) return fail('invalid-link');

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail('invalid-link');

  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail('invalid-link');

  const result = await linkPlayerByEmail(createAdminClient(), data.user);
  if (!result.ok) {
    await supabase.auth.signOut();
    return fail(result.reason);
  }
  return NextResponse.redirect(new URL('/', origin));
}
