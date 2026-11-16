import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/publicPaths';
import { publicOrigin } from '@/lib/publicOrigin';

export async function middleware(request: NextRequest) {
  // Tell the root layout which path this is (it cannot see the URL); always overwritten, so a client cannot set it.
  // Built per use, so refreshed session cookies set on `request` below are forwarded too.
  const forwarded = () => {
    const h = new Headers(request.headers);
    h.set('x-hgt-path', request.nextUrl.pathname);
    return { headers: h };
  };
  let response = NextResponse.next({ request: forwarded() });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: forwarded() });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser(); // refreshes the session cookie
  const path = request.nextUrl.pathname;
  const isPublic = isPublicPath(path);
  if (!data.user && !isPublic) {
    const redirect = NextResponse.redirect(new URL('/login', publicOrigin(request)));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
