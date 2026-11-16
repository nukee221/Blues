'use server';
import { courseSchema, type CourseInput } from '@/lib/courseSchema';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { lockedTeeIds } from '@/lib/editLocks';

type Admin = ReturnType<typeof createAdminClient>;
type TeeRow = { id: string; course_id: string; name: string; rating: number | string; slope: number; par: number };
type HoleRow = { tee_id: string; number: number; par: number; stroke_index: number };

const round1 = (n: number) => Math.round(n * 10) / 10;
const holeKey = (holes: { number: number; par: number; strokeIndex: number }[]) =>
  [...holes].sort((a, b) => a.number - b.number).map((h) => `${h.number}:${h.par}:${h.strokeIndex}`).join(',');

async function audit(admin: Admin, actor: string, entity: string, entityId: string, before: unknown, after: unknown) {
  const { error } = await admin.from('audit_log').insert({ actor_player_id: actor, entity, entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
}

const teeAudit = (t: { name: string; rating: number; slope: number; par: number; holes: { number: number; par: number; strokeIndex: number }[] }) => ({
  name: t.name,
  rating: t.rating,
  slope: t.slope,
  par: t.par,
  holes: [...t.holes].sort((a, b) => a.number - b.number).map((h) => [h.number, h.par, h.strokeIndex]),
});

/**
 * Create or update a course with its tees; each tee's holes are replaced (upsert by tee_id, number).
 * A tee used by a round with a signed card keeps its rating, slope, par and holes (results
 * derive from them): changing them returns 'tee_locked' (add a new tee instead); renaming is
 * still allowed. Every course and tee write is audited.
 */
export async function saveCourse(input: CourseInput): Promise<ActionResult<{ id: string; teeIds: string[] }>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const course = courseSchema.parse(input); // validate before any DB call
    const admin = createAdminClient();

    // Read and check every existing tee before the first write.
    const existingIds = course.tees.map((t) => t.id).filter((id): id is string => !!id);
    const current = new Map<string, TeeRow & { holes: { number: number; par: number; strokeIndex: number }[] }>();
    if (existingIds.length) {
      const { data: tees, error } = await admin.from('tees').select('id, course_id, name, rating, slope, par').in('id', existingIds);
      if (error) throw new Error(error.message);
      const { data: holes, error: hErr } = await admin
        .from('holes')
        .select('tee_id, number, par, stroke_index')
        .in('tee_id', existingIds);
      if (hErr) throw new Error(hErr.message);
      for (const t of (tees ?? []) as TeeRow[]) {
        const hs = ((holes ?? []) as HoleRow[])
          .filter((h) => h.tee_id === t.id)
          .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index }));
        current.set(t.id, { ...t, holes: hs });
      }
      for (const id of existingIds) {
        const t = current.get(id);
        if (!t || !course.id || t.course_id !== course.id) {
          throw new ActionError(ACT.teeNotInCourse, `Tee ${id} does not belong to this course`);
        }
      }
      const locked = await lockedTeeIds(admin, existingIds);
      for (const tee of course.tees) {
        if (!tee.id || !locked.has(tee.id)) continue;
        const cur = current.get(tee.id)!;
        const changed =
          Number(cur.rating) !== round1(tee.rating) ||
          cur.slope !== tee.slope ||
          cur.par !== tee.par ||
          holeKey(cur.holes) !== holeKey(tee.holes);
        if (changed) {
          throw new ActionError(
            ACT.teeLocked,
            `Tee "${cur.name}" has signed cards, so its rating, slope, par and holes cannot change (past results use them). Add a new tee instead; renaming is still allowed.`,
          );
        }
      }
    }

    let courseId = course.id;
    if (courseId) {
      const { data: before, error: readErr } = await admin.from('courses').select('id, name').eq('id', courseId).maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!before) throw new ActionError(ACT.notFound, 'Course not found');
      const { error } = await admin.from('courses').update({ name: course.name }).eq('id', courseId);
      if (error) throw new Error(error.message);
      if (before.name !== course.name) await audit(admin, player.id, 'course', courseId, { name: before.name }, { name: course.name });
    } else {
      const { data, error } = await admin.from('courses').insert({ name: course.name }).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Could not create course');
      courseId = data.id as string;
      await audit(admin, player.id, 'course', courseId, null, { name: course.name });
    }

    const teeIds: string[] = [];
    for (const tee of course.tees) {
      const fields = { course_id: courseId, name: tee.name, rating: tee.rating, slope: tee.slope, par: tee.par };
      let teeId = tee.id;
      const cur = teeId ? current.get(teeId) : undefined;
      if (teeId) {
        const { data, error } = await admin
          .from('tees')
          .update(fields)
          .eq('id', teeId)
          .eq('course_id', courseId)
          .select('id')
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new ActionError(ACT.teeNotInCourse, `Tee ${teeId} does not belong to this course`);
      } else {
        const { data, error } = await admin.from('tees').insert(fields).select('id').single();
        if (error || !data) throw new Error(error?.message ?? 'Could not create tee');
        teeId = data.id as string;
      }
      const { error } = await admin.from('holes').upsert(
        tee.holes.map((h) => ({ tee_id: teeId, number: h.number, par: h.par, stroke_index: h.strokeIndex })),
        { onConflict: 'tee_id,number' },
      );
      if (error) throw new Error(error.message);
      const before = cur ? teeAudit({ ...cur, rating: Number(cur.rating) }) : null;
      const after = teeAudit({ ...tee, rating: round1(tee.rating) });
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await audit(admin, player.id, 'tee', teeId, before, after);
      }
      teeIds.push(teeId);
    }
    return { id: courseId, teeIds };
  });
}
