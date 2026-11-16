'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CODE_LENGTH, normalizeCode } from '@/lib/codes';

export default function EnterCodePage() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeCode(value);
    if (!code) {
      setError(`Group codes are ${CODE_LENGTH} letters and numbers, like K7MPQ3`);
      return;
    }
    router.push(`/c/${code}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-3xl font-bold">Enter group code</h1>
      <p className="text-lg">The code is in your tee sheet email. No login needed.</p>
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
          className="block min-h-[64px] w-full rounded border-4 border-slate-900 px-4 text-center font-mono text-4xl uppercase tracking-[0.3em]"
        />
      </label>
      {error && (
        <p id="code-error" role="alert" className="text-lg font-semibold text-red-800">
          {error}
        </p>
      )}
      <button type="submit" className="min-h-[56px] w-full rounded bg-slate-900 text-xl font-bold text-white">
        Open scorecard
      </button>
    </form>
  );
}
