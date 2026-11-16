'use client';
import { useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { saveCourse } from '@/actions/courses';
import { courseSchema, type CourseInput } from '@/lib/courseSchema';

export type CourseFormValue = CourseInput;
type Tee = CourseInput['tees'][number];

const DEFAULT_PARS = [5, 4, 4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 4, 3, 5, 4, 3, 5]; // 72
const blankTee = (): Tee => ({
  name: '',
  rating: 72,
  slope: 113,
  par: 72,
  holes: DEFAULT_PARS.map((par, i) => ({ number: i + 1, par, strokeIndex: i + 1 })),
});

const input = 'min-h-[44px] w-full rounded border px-3 text-base';

function num(v: string): number {
  return v.trim() === '' ? NaN : Number(v);
}

export default function CourseForm({ initial }: { initial: CourseFormValue }) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseFormValue>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  /** Tee names the server says have signed cards; set while the confirm step is showing. */
  const [confirmTees, setConfirmTees] = useState<string[] | null>(null);
  // Raw text being typed, keyed by field; lets "71." survive a re-render. Cleared on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /** Props for a numeric text input: shows the draft while focused, commits the parsed number on every change. */
  const numField = (key: string, value: number, commit: (n: number) => void) => ({
    value: drafts[key] ?? (Number.isNaN(value) ? '' : String(value)),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setDrafts((d) => ({ ...d, [key]: raw }));
      commit(num(raw));
    },
    onBlur: () =>
      setDrafts((d) => {
        const { [key]: _drop, ...rest } = d;
        return rest;
      }),
  });

  const setTee = (i: number, patch: Partial<Tee>) => {
    setConfirmTees(null);
    setCourse((c) => ({ ...c, tees: c.tees.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  };
  const setHole = (i: number, k: number, patch: Partial<Tee['holes'][number]>) => {
    setConfirmTees(null);
    setCourse((c) => ({
      ...c,
      tees: c.tees.map((t, j) =>
        j === i ? { ...t, holes: t.holes.map((h, n) => (n === k ? { ...h, ...patch } : h)) } : t,
      ),
    }));
  };

  function submit(confirmResultsChange = false) {
    const parsed = courseSchema.safeParse(course);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((is) => is.message));
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        const result = await saveCourse(confirmResultsChange ? { ...parsed.data, confirmResultsChange: true } : parsed.data);
        if (!result.ok) {
          if (result.code === 'needs_confirm') {
            setConfirmTees(result.fields ?? []);
            return;
          }
          setConfirmTees(null);
          setErrors([result.error]);
          return;
        }
        setConfirmTees(null);
        const { id, teeIds } = result.data;
        // Adopt server ids so a second save updates instead of inserting duplicates.
        setCourse((c) => ({ ...c, id, tees: c.tees.map((t, i) => ({ ...t, id: teeIds[i] ?? t.id })) }));
        router.replace(`/admin/courses/${id}`);
        router.refresh();
      } catch (e) {
        setErrors([e instanceof Error ? e.message : 'Save failed']);
      }
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{course.id ? 'Edit course' : 'New course'}</h1>
      <label className="block">
        <span className="text-sm font-medium">Course name</span>
        <input className={input} value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} />
      </label>

      {course.tees.map((tee, i) => {
        const sum = tee.holes.reduce((s, h) => s + (h.par || 0), 0);
        return (
          <section key={tee.id ?? `new-${i}`} className="space-y-3 rounded border p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className="text-sm font-medium">Tee name</span>
                <input className={input} aria-label="Tee name" value={tee.name} onChange={(e) => setTee(i, { name: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Rating</span>
                <input className={input} inputMode="decimal" aria-label="Rating" {...numField(`${i}.rating`, tee.rating, (n) => setTee(i, { rating: n }))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Slope</span>
                <input className={input} inputMode="numeric" aria-label="Slope" {...numField(`${i}.slope`, tee.slope, (n) => setTee(i, { slope: n }))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Par</span>
                <input className={input} inputMode="numeric" aria-label="Par" {...numField(`${i}.par`, tee.par, (n) => setTee(i, { par: n }))} />
              </label>
              <div className="flex items-end pb-2 text-sm text-gray-600">Hole pars total {sum}</div>
            </div>
            <div className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2 text-sm font-medium">
              <span>Hole</span><span>Par</span><span>SI</span>
            </div>
            {tee.holes.map((h, k) => (
              <div key={h.number} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
                <span className="font-semibold">{h.number}</span>
                <input className={input} inputMode="numeric" aria-label={`Hole ${h.number} par`}
                  {...numField(`${i}.${k}.par`, h.par, (n) => setHole(i, k, { par: n }))} />
                <input className={input} inputMode="numeric" aria-label={`Hole ${h.number} stroke index`}
                  {...numField(`${i}.${k}.si`, h.strokeIndex, (n) => setHole(i, k, { strokeIndex: n }))} />
              </div>
            ))}
          </section>
        );
      })}

      <button type="button" className="min-h-[44px] w-full rounded border px-4 font-semibold"
        onClick={() => setCourse({ ...course, tees: [...course.tees, blankTee()] })}>
        Add tee
      </button>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {errors.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      {confirmTees && (
        <section role="alertdialog" aria-label="Confirm results change" className="space-y-3 rounded border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            This changes results already recorded for events played on {confirmTees.length ? confirmTees.join(', ') : 'this tee'} (leaderboard,
            cut, match results, points). Handicaps already locked in on sent tee sheets stay as they were. Continue?
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={pending} onClick={() => submit(true)}
              className="min-h-[44px] rounded bg-green-700 px-4 font-semibold text-white disabled:opacity-50">
              Continue
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmTees(null)}
              className="min-h-[44px] rounded border px-4 font-semibold">
              Cancel
            </button>
          </div>
        </section>
      )}
      <button type="button" disabled={pending} onClick={() => submit()}
        className="min-h-[44px] w-full rounded bg-green-700 px-4 font-semibold text-white disabled:opacity-50">
        {pending ? 'Saving…' : 'Save course'}
      </button>
    </div>
  );
}
