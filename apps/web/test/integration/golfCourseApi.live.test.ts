import { describe, expect, it } from 'vitest';
import { getCourse, searchCourses } from '@/lib/golfCourseApi';

/**
 * Opt-in live check against api.golfcourseapi.com (free plan, ~35 requests/day, so this makes
 * exactly 2). Run: GOLFCOURSE_LIVE=1 GOLFCOURSE_API_KEY=<key> pnpm -F web test:int golfCourseApi.live
 * Behind an HTTP proxy add NODE_USE_ENV_PROXY=1 (Node 22). Skipped unless GOLFCOURSE_LIVE=1.
 */
describe.skipIf(process.env.GOLFCOURSE_LIVE !== '1')('GolfCourseAPI (live)', () => {
  it('searches, then loads a course and maps its tees', async () => {
    const found = await searchCourses('Cherokee Ridge Country Club');
    expect(found.length).toBeGreaterThan(0);
    const hit = found.find((c) => c.state === 'AL') ?? found[0]!;
    const course = await getCourse(hit.id);
    expect(course.tees.length).toBeGreaterThan(0);
    for (const t of course.tees) expect(t.holes).toHaveLength(18);
  });
});
