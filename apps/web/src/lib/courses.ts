import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeeInfo } from '@hgt/scoring';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Rating/slope/par and the 18 holes (sorted by number) for a tee. Reads with the
 * signed-in user's client unless given one (the scorecard passes the service role,
 * since code holders are anonymous).
 */
export async function getTeeInfo(teeId: string, client?: SupabaseClient): Promise<TeeInfo> {
  const supabase = client ?? (await createServerClient());
  const { data: tee, error } = await supabase
    .from('tees')
    .select('rating, slope, par, holes(number, par, stroke_index)')
    .eq('id', teeId)
    .single();
  if (error || !tee) throw new Error(`Tee not found: ${teeId}`);
  const holes = (tee.holes as { number: number; par: number; stroke_index: number }[])
    .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index }))
    .sort((a, b) => a.number - b.number);
  return { rating: Number(tee.rating), slope: tee.slope, par: tee.par, holes };
}
