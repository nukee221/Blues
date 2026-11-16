import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  'not-on-roster': 'Ask a commissioner to add you.',
  'invalid-link': 'That sign-in link is invalid or expired. Request a new one.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Huntsville Golf Tour</h1>
      {error && (
        <p role="alert" className="rounded border-2 border-red-700 p-3 font-semibold text-red-700">
          {ERRORS[error] ?? 'Something went wrong.'}
        </p>
      )}
      <LoginForm />
    </div>
  );
}
