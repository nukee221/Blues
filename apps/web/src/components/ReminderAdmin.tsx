'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveReminderSettings, sendRoundReminderNow } from '@/actions/reminders';
import { formatCentral, formatShortDate } from '@/lib/time';

/** Quarter-hour times from noon to 10 PM, Central, as HH:MM. */
export const REMINDER_TIMES = Array.from({ length: 41 }, (_, i) => {
  const mins = 12 * 60 + i * 15;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
});
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

type RoundInfo = { id: string; roundNumber: number; playDate: string | null; sentAt: string | null };

/** Commissioner box: automatic reminders at a chosen time, or manual; plus "Send reminder now" per round. */
export default function ReminderAdmin({
  eventId,
  mode,
  time,
  rounds,
  canSend,
}: {
  eventId: string;
  mode: 'auto' | 'manual';
  time: string;
  rounds: RoundInfo[];
  canSend: boolean;
}) {
  const router = useRouter();
  const [m, setM] = useState(mode);
  const [t, setT] = useState(time.slice(0, 5));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const r = await saveReminderSettings({ eventId, mode: m, time: t });
      setMsg(r.ok ? { ok: true, text: m === 'auto' ? `Reminders will go out at ${timeLabel(t)} the evening before each round.` : 'Reminders will only go out when you tap Send.' } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: 'Could not save. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function send(r: RoundInfo) {
    if (r.sentAt && !window.confirm(`Round ${r.roundNumber}'s reminder already went out. Send it again to everyone?`)) return;
    setBusy(r.id);
    setMsg(null);
    try {
      const res = await sendRoundReminderNow(r.id, !!r.sentAt);
      setMsg(res.ok ? { ok: true, text: `Round ${r.roundNumber} reminder sent to ${res.data.sent} player${res.data.sent === 1 ? '' : 's'}.` } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: 'Could not send. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="reminders">
      <h2 id="reminders" className="text-lg font-semibold">Reminders</h2>
      <fieldset className="space-y-2">
        <legend className="sr-only">How reminders go out</legend>
        <label className="flex min-h-[44px] items-center gap-3 rounded border px-3">
          <input type="radio" name="reminder-mode" checked={m === 'auto'} onChange={() => setM('auto')} className="h-5 w-5" />
          <span>Send automatically the evening before each round</span>
        </label>
        {m === 'auto' && (
          <label className="ml-8 flex items-center gap-2">
            <span className="text-sm font-semibold">at</span>
            <select value={t} onChange={(e) => setT(e.target.value)} className="min-h-[44px] rounded border-2 border-gray-900 px-2">
              {REMINDER_TIMES.map((x) => (
                <option key={x} value={x}>
                  {timeLabel(x)}
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-600">Central</span>
          </label>
        )}
        <label className="flex min-h-[44px] items-center gap-3 rounded border px-3">
          <input type="radio" name="reminder-mode" checked={m === 'manual'} onChange={() => setM('manual')} className="h-5 w-5" />
          <span>Only when I tap Send</span>
        </label>
      </fieldset>
      <button type="button" onClick={save} disabled={busy !== null} className="min-h-[44px] rounded bg-gray-900 px-4 font-semibold text-white disabled:opacity-50">
        {busy === 'save' ? 'Saving…' : 'Save reminder setting'}
      </button>

      {canSend && rounds.length > 0 && (
        <ul className="space-y-2">
          {rounds.map((r) => (
            <li key={r.id} className="flex min-h-[44px] items-center justify-between gap-3 rounded border px-3 py-2">
              <span>
                <span className="font-semibold">
                  Round {r.roundNumber}
                  {r.playDate ? ` · ${formatShortDate(r.playDate)}` : ''}
                </span>
                <span className="block text-sm text-gray-600">{r.sentAt ? `Sent ${formatCentral(r.sentAt)}` : 'Not sent yet'}</span>
              </span>
              <button
                type="button"
                onClick={() => send(r)}
                disabled={busy !== null}
                className="min-h-[44px] shrink-0 rounded border-2 border-green-800 px-3 font-semibold text-green-800 disabled:opacity-50"
              >
                {busy === r.id ? 'Sending…' : r.sentAt ? 'Send again' : 'Send reminder now'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'font-semibold text-green-800' : 'font-semibold text-red-700'}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
