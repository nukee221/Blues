import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import PinForm from './PinForm';

export const dynamic = 'force-dynamic';

export default async function PinPage() {
  const { player } = await requireUser();
  const hasPin = player.has_pin;
  return (
    <div className="space-y-4">
      <Link href="/me" className="inline-flex min-h-[44px] items-center text-green-800">
        ← Me
      </Link>
      <h1 className="text-2xl font-bold">{hasPin ? 'Change your PIN' : 'Set your PIN'}</h1>
      <p className="text-lg">
        You sign scorecards with this 4-digit PIN, on your phone or the scorer&apos;s. Keep it to yourself: it proves the
        signature is yours.
      </p>
      <PinForm hasPin={hasPin} />
    </div>
  );
}
