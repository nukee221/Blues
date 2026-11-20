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
      <img src="/brand/shield-2027.png" alt="" width={1024} height={1008} className="mx-auto h-auto w-48" />
      <h1 className="text-center text-2xl font-bold">Sign in to the Huntsville Golf Tour</h1>
      {error && (
        <p role="alert" className="rounded border-2 border-red-700 p-3 font-semibold text-red-700">
          {ERRORS[error] ?? 'Something went wrong.'}
        </p>
      )}
      <LoginForm />
      <p className="text-center text-gray-700">
        Scoring a round?{' '}
        <a href="/c" className="font-semibold text-navy-900 underline">Enter your group code</a> — no sign-in needed.
      </p>
    </div>
  );
}
