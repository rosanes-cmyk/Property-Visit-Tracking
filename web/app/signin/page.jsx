'use client';
import { signIn } from 'next-auth/react';

export default function SignIn() {
  return (
    <div className="center">
      <h1 style={{ color: '#1f4e79' }}>🏠 Twin Visit Logger</h1>
      <p style={{ color: '#555', maxWidth: 380 }}>
        Sign in with your Twin Home Buyer / Equity Track Google account to view and update the
        property pipeline. The Google Sheet remains the system of record.
      </p>
      <button className="btn p" onClick={() => signIn('google', { callbackUrl: '/' })}>
        Sign in with Google
      </button>
    </div>
  );
}
