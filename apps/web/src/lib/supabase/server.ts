import { createServerClient as createSsrClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Cookie-session Supabase client (anon key; RLS applies as the signed-in user). */
export async function createServerClient() {
  const cookieStore = await cookies();
  return createSsrClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; middleware refreshes the session instead.
        }
      },
    },
  });
}
