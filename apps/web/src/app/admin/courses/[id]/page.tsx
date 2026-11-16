import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import CourseForm, { type CourseFormValue } from '@/components/CourseForm';
import { lockedTeeIds } from '@/lib/editLocks';

export const dynamic = 'force-dynamic';

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCommissioner();
  const { id } = await params;
  if (id === 'new') return <CourseForm initial={{ name: '', tees: [] }} />;

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from('courses')
    .select('id, name, tees(id, name, rating, slope, par, holes(number, par, stroke_index))')
    .eq('id', id)
    .maybeSingle();
  if (!course) notFound();

  const initial: CourseFormValue = {
    id: course.id,
    name: course.name,
    tees: course.tees.map((t) => ({
      id: t.id,
      name: t.name,
      rating: Number(t.rating),
      slope: t.slope,
      par: t.par,
      holes: [...t.holes]
        .sort((a, b) => a.number - b.number)
        .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index })),
    })),
  };
  const locked = await lockedTeeIds(supabase, initial.tees.map((t) => t.id!));
  return <CourseForm initial={initial} lockedTeeIds={[...locked]} />;
}
