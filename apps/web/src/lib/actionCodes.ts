/**
 * Stable failure codes returned by the admin and player server actions (courses, players,
 * events, registration, teeSheet). Clients and tests branch on these, never on message text.
 * Zod validation failures are returned by `toResult` with code 'invalid'.
 */
export const ACT = {
  invalid: 'invalid',
  notFound: 'not_found',
  // courses
  teeNotInCourse: 'tee_not_in_course',
  // players
  lastCommissioner: 'last_commissioner',
  // events
  invalidTransition: 'invalid_transition',
  statusConflict: 'status_conflict',
  /** setEventStatus(..., 'final'): finalize through finalizeEvent, which awards points. */
  useFinalize: 'use_finalize',
  // registration
  registrationClosed: 'registration_closed',
  eventFinal: 'event_final',
  // tee sheet
  duplicatePlayer: 'duplicate_player',
  scorerNotInGroup: 'scorer_not_in_group',
  notRegistered: 'not_registered',
  groupsLocked: 'groups_locked',
  scoresEntered: 'scores_entered',
  wrongStatus: 'wrong_status',
  noGroups: 'no_groups',
  playerMissing: 'player_missing',
  noHandicap: 'no_handicap',
  codeUnavailable: 'code_unavailable',
  // points
  /** finalizeEvent: the match-play bracket is not drawn or its final has no winner. */
  bracketIncomplete: 'bracket_incomplete',
  /** finalizeEvent: a stroke-play card with a player still in is not signed (locked). */
  cardsUnsigned: 'cards_unsigned',
} as const;
