export type StartPlan = {
  /** 'interval': groups go off one after another from hole 1; 'shotgun': all at once, one hole each. */
  mode: 'interval' | 'shotgun';
  /** HH:MM Central; '' = not set yet. */
  time: string;
  /** Minutes between groups (interval only). */
  gap: number;
};

export function addMinutes(hhmm: string, minutes: number): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const t = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Tee time and starting hole for each of `count` groups, in group order. */
export function startTimes(count: number, plan: StartPlan): { teeTime: string; startHole: number }[] {
  return Array.from({ length: count }, (_, i) =>
    plan.mode === 'shotgun'
      ? { teeTime: plan.time ? addMinutes(plan.time, 0) : '', startHole: (i % 18) + 1 }
      : { teeTime: plan.time ? addMinutes(plan.time, i * plan.gap) : '', startHole: 1 },
  );
}
