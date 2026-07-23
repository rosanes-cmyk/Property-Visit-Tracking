export { default } from 'next-auth/middleware';

// Protect everything except the auth endpoints, the sign-in page, and static assets.
export const config = {
  matcher: ['/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)'],
};
