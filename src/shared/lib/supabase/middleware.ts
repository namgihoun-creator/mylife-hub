import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/** URL prefixes of the (dashboard) route group. Route groups don't appear in URLs. */
const PROTECTED_PREFIXES = ["/assets", "/timeline"];
const LOGIN_PATH = "/login";
const HOME_AFTER_LOGIN = "/assets";

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Refreshes the Supabase auth session cookies and guards protected routes.
 * Public on purpose: /login, /m/[token] (Magic Link), /api/*.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser(): it validates the JWT with Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));
  const isLogin = matchesPrefix(pathname, LOGIN_PATH);

  const redirectTo = (path: string) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    const redirect = NextResponse.redirect(target);
    // Keep refreshed session cookies on the redirect response.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user && isProtected) {
    return redirectTo(LOGIN_PATH);
  }
  if (user && isLogin) {
    return redirectTo(HOME_AFTER_LOGIN);
  }

  return response;
}
