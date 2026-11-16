export const EVENT_STATUSES = ['draft', 'published', 'registration_closed', 'in_progress', 'final'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_TYPES = ['regular', 'major', 'ryder_cup', 'championship', 'match_play'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Allowed commissioner transitions; anything else is rejected. `final -> in_progress` is the audited reopen. */
const ALLOWED: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['published'],
  published: ['registration_closed'],
  registration_closed: ['published', 'in_progress'],
  in_progress: ['final'],
  final: ['in_progress'],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function nextStatuses(from: EventStatus): readonly EventStatus[] {
  return ALLOWED[from];
}

export const STATUS_ACTION_LABEL: Record<string, string> = {
  'draft>published': 'Publish',
  'published>registration_closed': 'Close registration',
  'registration_closed>published': 'Reopen registration',
  'registration_closed>in_progress': 'Start event',
  'in_progress>final': 'Finalize',
  'final>in_progress': 'Reopen (audited)',
};
