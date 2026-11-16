'use server';
import { courseSchema, type CourseInput } from '@/lib/courseSchema';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

/** Create or update a course with its tees; each tee's holes are replaced (upsert by tee_id, number). */
export async function saveCourse(input: CourseInput): Promise<{ id: string }> {
  const course = courseSchema.parse(input); // validate before any auth/DB call
  await requireCommissioner();
  const admin = createAdminClient();

  let courseId = course.id;
  if (courseId) {
    const { error } = await admin.from('courses').update({ name: course.name }).eq('id', courseId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin.from('courses').insert({ name: course.name }).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create course');
    courseId = data.id as string;
  }

  for (const tee of course.tees) {
    const fields = { course_id: courseId, name: tee.name, rating: tee.rating, slope: tee.slope, par: tee.par };
    let teeId = tee.id;
    if (teeId) {
      const { error } = await admin.from('tees').update(fields).eq('id', teeId).eq('course_id', courseId);
      if (error) throw new Error(error.message);
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
  }
  return { id: courseId };
}
