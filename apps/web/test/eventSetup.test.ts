import { describe, expect, it } from 'vitest';
import { eventSetupSteps, type SetupInput, type SetupRound } from '@/lib/eventSetup';

const r1: SetupRound = { id: 'r1', roundNumber: 1, hasCourse: true, hasDate: false, groupCount: 0 };
const base: SetupInput = {
  eventId: 'EVENT',
  status: 'draft',
  format: 'stroke',
  rounds: [r1],
  registeredCount: 0,
  bracketDrawn: false,
};

const view = (input: SetupInput) => eventSetupSteps(input).map((s) => `${s.key}:${s.state}`);

describe('guided event setup', () => {
  it('a new draft: details done, courses and dates is the current step', () => {
    expect(view(base)).toEqual([
      'details:done',
      'courses:current',
      'publish:todo',
      'players:todo',
      'close:todo',
      'groups:todo',
      'start:todo',
      'finalize:todo',
    ]);
  });

  it('every round needs a course and a date', () => {
    const rounds = [
      { id: 'r1', roundNumber: 1, hasCourse: true, hasDate: true, groupCount: 0 },
      { id: 'r2', roundNumber: 2, hasCourse: true, hasDate: false, groupCount: 0 },
    ];
    const courses = eventSetupSteps({ ...base, rounds }).find((s) => s.key === 'courses')!;
    expect(courses.state).toBe('current');
    expect(courses.detail).toBe('Round 2 needs a date');
  });

  it('published with sign-ups: players done, close registration is next', () => {
    const steps = eventSetupSteps({
      ...base,
      status: 'published',
      rounds: [{ ...r1, hasDate: true }],
      registeredCount: 12,
    });
    expect(steps.map((s) => s.state).slice(0, 5)).toEqual(['done', 'done', 'done', 'done', 'current']);
    expect(steps.find((s) => s.key === 'players')!.detail).toBe('12 signed up');
  });

  it('stroke play: groups step points at the first round without groups', () => {
    const rounds = [
      { id: 'r1', roundNumber: 1, hasCourse: true, hasDate: true, groupCount: 3 },
      { id: 'r2', roundNumber: 2, hasCourse: true, hasDate: true, groupCount: 0 },
    ];
    const groups = eventSetupSteps({ ...base, status: 'registration_closed', rounds, registeredCount: 9 }).find(
      (s) => s.key === 'groups',
    )!;
    expect(groups.state).toBe('current');
    expect(groups.detail).toBe('Round 2 has no groups yet');
    expect(groups.href).toBe('/admin/events/EVENT/rounds/r2');
  });

  it('match play: play-in groups, then the bracket after the event starts', () => {
    const p1: SetupRound = { id: 'p1', roundNumber: 1, hasCourse: true, hasDate: false, groupCount: 0 };
    const playIn = [p1];
    const draft = eventSetupSteps({ ...base, format: 'match_play', rounds: playIn });
    expect(draft.map((s) => s.key)).toEqual(['details', 'courses', 'publish', 'players', 'close', 'groups', 'start', 'bracket', 'finalize']);
    expect(draft.find((s) => s.key === 'courses')!.detail).toBe('The play-in needs a date');
    expect(draft.find((s) => s.key === 'groups')!.label).toBe('Play-in groups');

    const started = eventSetupSteps({
      ...base,
      format: 'match_play',
      status: 'in_progress',
      rounds: [{ ...p1, hasDate: true, groupCount: 4 }],
      registeredCount: 16,
    });
    const bracket = started.find((s) => s.key === 'bracket')!;
    expect(bracket.state).toBe('current');
    expect(bracket.href).toBe('/admin/events/EVENT/bracket');
    expect(eventSetupSteps({ ...base, format: 'stroke' }).some((s) => s.key === 'bracket')).toBe(false);
  });

  it('a final event has every step checked', () => {
    const steps = eventSetupSteps({
      ...base,
      status: 'final',
      rounds: [{ id: 'r1', roundNumber: 1, hasCourse: true, hasDate: true, groupCount: 4 }],
      registeredCount: 16,
    });
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('status already moved on counts the earlier status steps as done', () => {
    // e.g. the event was started before groups were made: start is done, groups stays current
    const steps = eventSetupSteps({ ...base, status: 'in_progress', rounds: [{ ...r1, hasDate: true }], registeredCount: 4 });
    expect(steps.find((s) => s.key === 'start')!.state).toBe('done');
    expect(steps.find((s) => s.key === 'groups')!.state).toBe('current');
  });
});
