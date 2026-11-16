import { redirect } from 'next/navigation';

/** Old tab target: the scorecard code entry now lives at /c (no login needed). */
export default function Page() {
  redirect('/c');
}
