import 'server-only';
import { z } from 'zod';
import { ActionError } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';

/**
 * GolfCourseAPI client (https://api.golfcourseapi.com). Server only: the key comes from the
 * GOLFCOURSE_API_KEY env var and never reaches the browser. The free plan allows about 35
 * requests a day, so this is only ever called from an explicit Search / "Load tees" tap, with
 * no automatic retries.
 */
const BASE = 'https://api.golfcourseapi.com';
const TIMEOUT_MS = 10_000;

export type LookupCourseSummary = { id: string; clubName: string; courseName: string; city: string; state: string };

export type LookupTee = {
  /** Stable key within one course: `<gender>:<tee_name>`. */
  key: string;
  /** Form tee name: male tees keep tee_name, female tees become "<tee_name> (W)". */
  name: string;
  rating: number;
  slope: number;
  par: number;
  yards: number | null;
  holes: { number: number; par: number; strokeIndex: number }[];
  /** Problems that would fail the course form's validation; empty when the tee is clean. */
  issues: string[];
};

export type LookupCourse = { id: string; clubName: string; courseName: string; city: string; state: string; tees: LookupTee[] };

const num = z.number().nullish();
const str = z.string().nullish();

const searchSchema = z.object({
  courses: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      club_name: str,
      course_name: str,
      location: z.object({ city: str, state: str }).partial().nullish(),
    }),
  ),
});

const apiTee = z.object({
  tee_name: str,
  course_rating: num,
  slope_rating: num,
  total_yards: num,
  number_of_holes: num,
  par_total: num,
  holes: z.array(z.object({ par: num, handicap: num })).nullish(),
});
const courseSchemaApi = z.object({
  course: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    club_name: str,
    course_name: str,
    location: z.object({ city: str, state: str }).partial().nullish(),
    tees: z.object({ male: z.array(apiTee).nullish(), female: z.array(apiTee).nullish() }).nullish(),
  }),
});

type ApiTee = z.infer<typeof apiTee>;

/** Map one API tee to the course form shape and list what would fail the form's validation. */
export function mapTee(raw: ApiTee, gender: 'male' | 'female'): LookupTee {
  const base = (raw.tee_name ?? '').trim() || 'Tee';
  const issues: string[] = [];
  const rating = raw.course_rating && raw.course_rating > 0 ? raw.course_rating : 0;
  if (!rating) issues.push('Missing course rating');
  const slope = raw.slope_rating ?? 0;
  if (!Number.isInteger(slope) || slope < 55 || slope > 155) issues.push(`Slope ${slope || 'missing'} is outside 55-155`);

  const src = raw.holes ?? [];
  if (src.length !== 18) issues.push(`Has ${src.length} holes, not 18`);
  const holes = Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: src[i]?.par ?? 0,
    strokeIndex: src[i]?.handicap ?? 0,
  }));
  if (src.length === 18) {
    if (holes.some((h) => !Number.isInteger(h.par) || h.par < 3 || h.par > 6)) issues.push('A hole par is missing or not 3-6');
    const sis = holes.map((h) => h.strokeIndex).sort((a, b) => a - b);
    if (!sis.every((n, i) => n === i + 1)) issues.push('Hole handicaps are not 1-18 once each');
  }
  const sum = holes.reduce((s, h) => s + h.par, 0);
  const par = raw.par_total ?? (src.length === 18 ? sum : 0);
  if (src.length === 18 && sum !== par) issues.push(`Hole pars sum to ${sum}, but tee par is ${par || 'missing'}`);

  return {
    key: `${gender}:${base}`,
    name: gender === 'female' ? `${base} (W)` : base,
    rating,
    slope,
    par,
    yards: raw.total_yards ?? null,
    holes,
    issues,
  };
}

async function call(path: string): Promise<unknown> {
  const key = process.env.GOLFCOURSE_API_KEY?.trim();
  if (!key) throw new ActionError(ACT.lookupNotConfigured, 'Course lookup is not set up.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('[courseLookup] request failed', e instanceof Error ? e.name : 'error');
    throw new ActionError(ACT.lookupUnavailable, 'Course lookup is not available right now. Enter the course by hand.');
  }
  if (res.status === 429) throw new ActionError(ACT.lookupRateLimited, 'Course lookup is out of requests for today. Try again tomorrow or enter the course by hand.');
  if (res.status === 404) throw new ActionError(ACT.lookupNotFound, 'That course was not found.');
  if (!res.ok) {
    console.error('[courseLookup] unexpected status', res.status);
    throw new ActionError(ACT.lookupUnavailable, 'Course lookup is not available right now. Enter the course by hand.');
  }
  try {
    return await res.json();
  } catch {
    throw new ActionError(ACT.lookupUnavailable, 'Course lookup is not available right now. Enter the course by hand.');
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    console.error('[courseLookup] unexpected response shape');
    throw new ActionError(ACT.lookupUnavailable, 'Course lookup returned something unexpected. Enter the course by hand.');
  }
  return r.data;
}

export async function searchCourses(query: string): Promise<LookupCourseSummary[]> {
  const body = parse(searchSchema, await call(`/v1/search?search_query=${encodeURIComponent(query)}`));
  return body.courses.map((c) => ({
    id: c.id,
    clubName: c.club_name ?? '',
    courseName: c.course_name ?? '',
    city: c.location?.city ?? '',
    state: c.location?.state ?? '',
  }));
}

export async function getCourse(id: string): Promise<LookupCourse> {
  const { course: c } = parse(courseSchemaApi, await call(`/v1/courses/${encodeURIComponent(id)}`));
  return {
    id: c.id,
    clubName: c.club_name ?? '',
    courseName: c.course_name ?? '',
    city: c.location?.city ?? '',
    state: c.location?.state ?? '',
    tees: [
      ...(c.tees?.male ?? []).map((t) => mapTee(t, 'male')),
      ...(c.tees?.female ?? []).map((t) => mapTee(t, 'female')),
    ],
  };
}
