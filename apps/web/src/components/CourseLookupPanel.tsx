'use client';
import { useState, useTransition } from 'react';
import { loadCourseLookup, searchCourseLookup } from '@/actions/courseLookup';
import type { LookupCourse, LookupCourseSummary, LookupTee } from '@/lib/golfCourseApi';

const input = 'min-h-[44px] w-full rounded border px-3 text-base';
const btn = 'min-h-[44px] rounded border px-4 font-semibold disabled:opacity-50';

/**
 * "Look up a course": search GolfCourseAPI by name, pick a result, tick tees, hand them to the form.
 * The API is only called from the Search and result taps (the free plan is ~35 requests a day).
 */
export default function CourseLookupPanel({
  onAdd,
}: {
  onAdd: (tees: LookupTee[], course: LookupCourse) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupCourseSummary[] | null>(null);
  const [course, setCourse] = useState<LookupCourse | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function search() {
    setError(null);
    setCourse(null);
    start(async () => {
      try {
        const r = await searchCourseLookup(query);
        if (!r.ok) {
          setResults(null);
          setError(r.error);
          return;
        }
        setResults(r.data);
      } catch {
        setError('Search failed. Try again or enter the course by hand.');
      }
    });
  }

  function pick(id: string) {
    setError(null);
    start(async () => {
      try {
        const r = await loadCourseLookup(id);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setCourse(r.data);
        setPicked(new Set());
      } catch {
        setError('Could not load that course. Try again or enter it by hand.');
      }
    });
  }

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <section aria-label="Look up a course" className="space-y-3 rounded border p-3">
      <h2 className="text-lg font-semibold">Look up a course</h2>
      <div className="flex gap-2">
        <input
          className={input}
          aria-label="Course search"
          placeholder="Course or club name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!pending) search();
            }
          }}
        />
        <button type="button" className={btn} disabled={pending} onClick={search}>
          Search
        </button>
      </div>
      <p className="text-sm text-gray-600">
        Check against the club&apos;s scorecard before saving — databases can lag behind course changes.
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {results && !course && (
        results.length === 0 ? (
          <p className="text-sm text-gray-600">No courses found.</p>
        ) : (
          <ul className="space-y-2">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={pending} onClick={() => pick(c.id)}
                  className="min-h-[44px] w-full rounded border px-3 py-2 text-left disabled:opacity-50">
                  <span className="block font-semibold">{c.clubName || c.courseName}</span>
                  <span className="block text-sm text-gray-600">
                    {c.courseName && c.courseName !== c.clubName ? `${c.courseName} · ` : ''}
                    {[c.city, c.state].filter(Boolean).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {course && (
        <div className="space-y-3">
          <p className="font-semibold">{course.clubName || course.courseName}</p>
          {course.tees.length === 0 ? (
            <p className="text-sm text-gray-600">This course has no tees listed.</p>
          ) : (
            <ul className="space-y-2">
              {course.tees.map((t) => (
                <li key={t.key} className="rounded border">
                  <label className="flex min-h-[44px] items-start gap-3 p-2">
                    <input type="checkbox" className="mt-1 h-6 w-6" checked={picked.has(t.key)} onChange={() => toggle(t.key)}
                      aria-label={`Import ${t.name}`} />
                    <span className="text-sm">
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-gray-700">
                        Rating {t.rating || '?'} · Slope {t.slope || '?'} · Par {t.par || '?'}
                        {t.yards ? ` · ${t.yards} yds` : ''}
                      </span>
                      {t.issues.length > 0 && (
                        <span className="block text-amber-800">Needs attention: {t.issues.join('; ')}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={`${btn} bg-green-700 text-white`} disabled={picked.size === 0}
              onClick={() => {
                onAdd(course.tees.filter((t) => picked.has(t.key)), course);
                setPicked(new Set());
              }}>
              Add selected tees
            </button>
            <button type="button" className={btn} onClick={() => setCourse(null)}>
              Back to results
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
