'use client';

import { useState } from 'react';
import { requestSignInLink } from '@/actions/login';

export const LINK_SENT = 'If that email is on the roster, a link is on its way.';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const result = await requestSignInLink(email);
      if (result.ok) {
        setStatus('sent');
        return;
      }
      setMessage(result.code === 'invalid' ? result.error : 'Could not send the link. Try again.');
    } catch {
      setMessage('Could not send the link. Try again.');
    }
    setStatus('error');
  }

  if (status === 'sent') {
    return <p role="status" className="card-dark p-4 text-lg">{LINK_SENT}</p>;
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="eyebrow block text-silver-300" htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-h-[52px] w-full rounded-lg border-2 border-white/20 bg-navy-800/80 px-3 text-lg text-white placeholder:text-silver-400 focus:border-gold-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-red w-full disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending...' : 'Email me a sign-in link'}
      </button>
      {status === 'error' && <p role="alert" className="font-semibold text-brandred-500">{message}</p>}
    </form>
  );
}
