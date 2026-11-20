'use client';
import { useState } from 'react';
import { CODE_LENGTH, normalizeCode } from '@/lib/codes';
import RegisterServiceWorker from './RegisterServiceWorker';

export default function EnterCodePage() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeCode(value);
    if (!code) {
      setError(`Group codes are ${CODE_LENGTH} letters and numbers, like K7MPQ3`);
      return;
    }
    // A full navigation, not router.push: an RSC fetch is never cached by the service worker, a document load is.
    window.location.assign(`/c/${code}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <RegisterServiceWorker />
      <h1 className="display text-5xl">Enter <span className="text-gold-grad">group code</span></h1>
      <p className="text-lg text-silver-300">The code is in your tee sheet email. No login needed.</p>
      <label className="block">
        <span className="sr-only">Group code</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={CODE_LENGTH + 4}
          placeholder="K7MPQ3"
          aria-invalid={!!error}
          aria-describedby={error ? 'code-error' : undefined}
          className="block min-h-[64px] w-full rounded-lg border-4 border-gold-400 bg-navy-900 px-4 text-center font-mono text-4xl uppercase tracking-[0.3em] text-white placeholder:text-silver-400/60 focus:outline-none"
        />
      </label>
      {error && (
        <p id="code-error" role="alert" className="text-lg font-semibold text-brandred-500">
          {error}
        </p>
      )}
      <button type="submit" className="btn-red min-h-[56px] w-full text-xl">
        Open scorecard
      </button>
    </form>
  );
}
