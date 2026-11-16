'use client';

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/browser';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    const { error } = await createBrowserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    setStatus(error ? 'error' : 'sent');
  }

  if (status === 'sent') {
    return <p role="status" className="text-lg">Check your email for a sign-in link.</p>;
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-lg font-semibold" htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-h-[48px] w-full rounded border-2 border-slate-900 px-3 text-lg"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="min-h-[48px] w-full rounded bg-slate-900 px-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending...' : 'Email me a sign-in link'}
      </button>
      {status === 'error' && <p role="alert" className="font-semibold text-red-700">Could not send the link. Try again.</p>}
    </form>
  );
}
