import GoogleProvider from 'next-auth/providers/google';

const allowed = (process.env.ALLOWED_DOMAINS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Hint Google to the primary Workspace domain; still enforced in signIn below.
      authorization: { params: { hd: allowed[0] || '', prompt: 'select_account' } },
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email = String((user && user.email) || (profile && profile.email) || '').toLowerCase();
      const domain = email.split('@')[1];
      if (allowed.length === 0) return true; // no restriction configured
      return !!domain && allowed.includes(domain);
    },
    async session({ session }) {
      return session;
    },
  },
  pages: { signIn: '/signin' },
};
