import { type NextRequest, NextResponse } from 'next/server'

/**
 * Server-side auth gate via the PRESENCE cookie only — never the JWT
 * (UI-ARCHITECTURE.md §15). Unauthenticated users are sent to /login;
 * authenticated users are kept out of the auth routes.
 */
const AUTH_COOKIE = 'perduraflow_auth'
const AUTH_ROUTES = [
  '/login',
  '/register',
  '/onboarding',
  '/verify-otp',
  '/forgot-password',
  '/reset-password',
]

export function middleware(request: NextRequest): NextResponse {
  const isAuthenticated = request.cookies.has(AUTH_COOKIE)
  const { pathname } = request.nextUrl
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))

  if (!isAuthenticated && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (isAuthenticated && isAuthRoute) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
