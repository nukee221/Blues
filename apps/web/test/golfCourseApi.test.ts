import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { courseSchema } from '@/lib/courseSchema';

const requireCommissioner = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ requireCommissioner }));

import { getCourse, mapTee, searchCourses } from '@/lib/golfCourseApi';
import { loadCourseLookup, searchCourseLookup } from '@/actions/courseLookup';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const search = fx('golfcourseapi-search.json');
const courseFx = fx('golfcourseapi-course.json');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GOLFCOURSE_API_KEY', 'test-key');
  requireCommissioner.mockResolvedValue({ player: { id: 'c1' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mapping', () => {
  it('maps the male Blue tee exactly to the seed values', async () => {
    fetchMock.mockResolvedValue(json(courseFx));
    const c = await getCourse('25bbvpqb');
    const blue = c.tees.find((t) => t.name === 'Blue')!;
    expect(blue).toMatchObject({ key: 'male:Blue', rating: 71.8, slope: 140, par: 72, yards: 6410, issues: [] });
    expect(blue.holes.map((h) => h.par)).toEqual([4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4]);
    expect(blue.holes.map((h) => h.strokeIndex)).toEqual([18, 4, 10, 8, 16, 12, 6, 14, 2, 3, 15, 11, 7, 1, 17, 5, 13, 9]);
    expect(blue.holes.map((h) => h.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(courseSchema.safeParse({ name: 'x', tees: [blue] }).success).toBe(true);
  });
  it('female tees are named "<tee> (W)" and keep their own numbers; all fixture tees are clean', async () => {
    fetchMock.mockResolvedValue(json(courseFx));
    const c = await getCourse('25bbvpqb');
    expect(c.tees).toHaveLength(10);
    const w = c.tees.find((t) => t.name === 'Blue (W)')!;
    expect(w).toMatchObject({ key: 'female:Blue', rating: 77.4, slope: 139, par: 73 });
    expect(c.tees.filter((t) => t.issues.length)).toEqual([]);
    expect(c.courseName).toBe('Cherokee Ridge Country Club');
  });
  it('a broken tee lists its issues', () => {
    const base = courseFx.course.tees.male[1];
    const holes = base.holes.map((h: { par: number; handicap: number }) => ({ ...h }));
    holes[0].handicap = 2; // duplicate handicap 2
    holes[1].par = 5; // pars no longer sum to par_total
    const t = mapTee({ ...base, slope_rating: 40, course_rating: null, holes }, 'male');
    expect(t.issues).toEqual(
      expect.arrayContaining([
        'Missing course rating',
        expect.stringMatching(/Slope 40/),
        'Hole handicaps are not 1-18 once each',
        expect.stringMatching(/sum to 73/),
      ]),
    );
    expect(mapTee({ ...base, holes: base.holes.slice(0, 9) }, 'male').issues).toContain('Has 9 holes, not 18');
  });
  it('search maps summaries', async () => {
    fetchMock.mockResolvedValue(json(search));
    const r = await searchCourses('cherokee');
    expect(r[0]).toEqual({ id: '25bbvpqb', clubName: 'Cherokee Ridge Country Club', courseName: 'Cherokee Ridge Country Club', city: 'Union Grove', state: 'AL' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.golfcourseapi.com/v1/search?search_query=cherokee');
    expect(init.headers.Authorization).toBe('Bearer test-key');
  });
});

describe('actions', () => {
  it('auth first: a non-commissioner never reaches the API', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(searchCourseLookup('cherokee')).rejects.toThrow('NEXT_REDIRECT');
    await expect(loadCourseLookup('25bbvpqb')).rejects.toThrow('NEXT_REDIRECT');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('query needs 3 characters; no request is made', async () => {
    expect(await searchCourseLookup(' ab ')).toMatchObject({ ok: false, code: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects odd course ids without a request', async () => {
    expect(await loadCourseLookup('../x?y')).toMatchObject({ ok: false, code: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('429 -> lookup_rate_limited, with no retry', async () => {
    fetchMock.mockResolvedValue(json({}, 429));
    expect(await searchCourseLookup('cherokee')).toMatchObject({ ok: false, code: 'lookup_rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('no key -> lookup_not_configured, no request', async () => {
    vi.stubEnv('GOLFCOURSE_API_KEY', '');
    expect(await searchCourseLookup('cherokee')).toMatchObject({ ok: false, code: 'lookup_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('network failure, 5xx and a bad shape -> lookup_unavailable; 404 -> lookup_not_found', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    expect(await searchCourseLookup('cherokee')).toMatchObject({ code: 'lookup_unavailable' });
    fetchMock.mockResolvedValueOnce(json({}, 503));
    expect(await searchCourseLookup('cherokee')).toMatchObject({ code: 'lookup_unavailable' });
    fetchMock.mockResolvedValueOnce(json({ nope: 1 }));
    expect(await searchCourseLookup('cherokee')).toMatchObject({ code: 'lookup_unavailable' });
    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await loadCourseLookup('zzz')).toMatchObject({ code: 'lookup_not_found' });
  });
  it('loadCourseLookup returns the mapped course', async () => {
    fetchMock.mockResolvedValue(json(courseFx));
    const r = await loadCourseLookup('25bbvpqb');
    expect(r.ok && r.data.tees[0]!.name).toBe('Black');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.golfcourseapi.com/v1/courses/25bbvpqb');
  });
});
