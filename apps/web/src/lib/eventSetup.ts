import type { EventStatus } from '@/lib/eventStatus';

export type SetupRound = { id: string; roundNumber: number; hasCourse: boolean; hasDate: boolean; groupCount: number };

export type SetupInput = {
  eventId: string;
  status: EventStatus;
  format: 'stroke' | 'match_play';
  /** The event's own rounds (not per-match bracket rounds). */
  rounds: SetupRound[];
  registeredCount: number;
  bracketDrawn: boolean;
};

export type SetupStep = {
  key: 'details' | 'courses' | 'publish' | 'players' | 'close' | 'groups' | 'start' | 'bracket' | 'finalize';
  label: string;
  /** What is still missing, or a short status once done. */
  detail?: string;
  state: 'done' | 'current' | 'todo';
  /** Where to go to do it: a page, or an anchor on the event page. */
  href: string;
};

const ORDER: EventStatus[] = ['draft', 'published', 'registration_closed', 'in_progress', 'final'];
const reached = (status: EventStatus, at: EventStatus) => ORDER.indexOf(status) >= ORDER.indexOf(at);

/**
 * The guided setup checklist on the admin event page: each step with a check mark once done.
 * The first step not yet done is the "current" one; the rest are still to do.
 */
export function eventSetupSteps(input: SetupInput): SetupStep[] {
  const { eventId, status, format, registeredCount } = input;
  const rounds = [...input.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const matchPlay = format === 'match_play';

  const missingCourse = rounds.find((r) => !r.hasCourse);
  const missingDate = rounds.find((r) => !r.hasDate);
  const coursesDone = rounds.length > 0 && !missingCourse && !missingDate;
  const noGroups = rounds.find((r) => r.groupCount === 0);
  const groupsDone = rounds.length > 0 && !noGroups;
  // Match play: the stroke play-in is the event's round 1; the bracket is drawn once it is closed.
  const roundName = (n: number) => (matchPlay && n === 1 ? 'The play-in' : `Round ${n}`);

  const raw: Omit<SetupStep, 'state'>[] = [
    { key: 'details', label: 'Event details', detail: 'Name, format and handicaps', href: '#event-form' },
    {
      key: 'courses',
      label: 'Courses and dates',
      detail: missingCourse
          ? `${roundName(missingCourse.roundNumber)} needs a course`
          : missingDate
            ? `${roundName(missingDate.roundNumber)} needs a date`
            : rounds.length === 1
              ? '1 round set'
              : `${rounds.length} rounds set`,
      href: '#event-rounds',
    },
    { key: 'publish', label: 'Publish', detail: 'Players can see it and sign up', href: '#event-status' },
    {
      key: 'players',
      label: 'Players sign up',
      detail: registeredCount === 0 ? 'No one yet' : `${registeredCount} signed up`,
      href: '#registrations',
    },
    { key: 'close', label: 'Close registration', detail: 'Locks the field', href: '#event-status' },
    {
      key: 'groups',
      label: matchPlay ? 'Play-in groups' : 'Groups and tee times',
      detail: noGroups ? `${roundName(noGroups.roundNumber)} has no groups yet` : matchPlay ? 'Groups made' : 'Every round has groups',
      href: noGroups ? `/admin/events/${eventId}/rounds/${noGroups.id}` : '#event-groups',
    },
    { key: 'start', label: 'Start the event', detail: 'Scoring opens', href: '#event-status' },
    ...(matchPlay
      ? [
          {
            key: 'bracket' as const,
            label: 'Close the play-in and draw the bracket',
            detail: input.bracketDrawn ? 'Bracket drawn' : 'After every play-in card is signed',
            href: `/admin/events/${eventId}/bracket`,
          },
        ]
      : []),
    { key: 'finalize', label: 'Finalize', detail: 'Points go on the standings', href: '#event-status' },
  ];

  const done: Record<SetupStep['key'], boolean> = {
    details: true,
    courses: coursesDone,
    publish: reached(status, 'published'),
    players: registeredCount > 0,
    close: reached(status, 'registration_closed'),
    groups: groupsDone,
    start: reached(status, 'in_progress'),
    bracket: input.bracketDrawn,
    finalize: status === 'final',
  };

  let currentSet = false;
  return raw.map((s) => {
    if (done[s.key]) return { ...s, state: 'done' as const };
    if (!currentSet) {
      currentSet = true;
      return { ...s, state: 'current' as const };
    }
    return { ...s, state: 'todo' as const };
  });
}
