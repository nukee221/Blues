import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  'not-on-roster': 'Ask a commissioner to add you.',
  'invalid-link': 'That sign-in link is invalid or expired. Request a new one.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="space-y-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand art */}
      <img src="/brand/shield-2027-transparent.png" alt="" width={512} height={504} className="mx-auto h-auto w-44 drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]" />
      <div className="text-center">
        <p className="eyebrow text-gold-400">Official 2027 season</p>
        <h1 className="display mt-2 text-5xl text-white">
          Sign <span className="text-gold-grad pr-1">in</span>
        </h1>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border-2 border-brandred-500 bg-brandred-700/30 p-3 font-semibold text-white">
          {ERRORS[error] ?? 'Something went wrong.'}
        </p>
      )}
      <LoginForm />
      <p className="text-center text-silver-300">
        Scoring a round?{' '}
        <a href="/c" className="font-semibold text-gold-400 underline">Enter your group code</a> — no sign-in needed.
      </p>
    </div>
  );
}
