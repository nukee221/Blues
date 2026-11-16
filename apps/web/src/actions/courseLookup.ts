'use server';
import { requireCommissioner } from '@/lib/auth';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { getCourse, searchCourses, type LookupCourse, type LookupCourseSummary } from '@/lib/golfCourseApi';

/** Search GolfCourseAPI by course or club name (commissioner only; 3+ characters). */
export async function searchCourseLookup(query: string): Promise<ActionResult<LookupCourseSummary[]>> {
  await requireCommissioner();
  return toResult(async () => {
    const q = String(query ?? '').trim();
    if (q.length < 3) throw new ActionError(ACT.invalid, 'Type at least 3 letters to search.');
    if (q.length > 100) throw new ActionError(ACT.invalid, 'Search text is too long.');
    return searchCourses(q);
  });
}

/** Load one course's tees (mapped to the course form shape, with per-tee `issues`). */
export async function loadCourseLookup(id: string): Promise<ActionResult<LookupCourse>> {
  await requireCommissioner();
  return toResult(async () => {
    const courseId = String(id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(courseId)) throw new ActionError(ACT.invalid, 'Pick a course from the search results.');
    return getCourse(courseId);
  });
}
