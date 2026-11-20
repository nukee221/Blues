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
  // course lookup (GolfCourseAPI)
  /** No GOLFCOURSE_API_KEY on the server: lookup is simply not set up. */
  lookupNotConfigured: 'lookup_not_configured',
  lookupRateLimited: 'lookup_rate_limited',
  lookupUnavailable: 'lookup_unavailable',
  lookupNotFound: 'lookup_not_found',
  // players
  lastCommissioner: 'last_commissioner',
  // events
  invalidTransition: 'invalid_transition',
  statusConflict: 'status_conflict',
  /** setEventStatus(..., 'final'): finalize through finalizeEvent, which awards points. */
  useFinalize: 'use_finalize',
  /** saveEvent: a round the form removes or renumbers already has groups; remove the groups first. */
  roundHasGroups: 'round_has_groups',
  /** saveEvent / saveCourse: the change affects results already recorded; resend with confirmResultsChange: true. */
  needsConfirm: 'needs_confirm',
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
  /** sendTeeSheet: groups and codes are saved but the email send failed; retry the send. */
  emailFailed: 'email_failed',
  /** sendRoundReminderNow: already sent; send again only with resend: true. */
  alreadySent: 'already_sent',
  /** sendRoundReminderNow: no registered or grouped players (or the match is decided). */
  nobodyToRemind: 'nobody_to_remind',
  // pairing rules
  /** addPairingRule: both sides are the same player. */
  samePlayer: 'same_player',
  // points
  /** finalizeEvent: the match-play bracket is not drawn or its final has no winner. */
  bracketIncomplete: 'bracket_incomplete',
  /** finalizeEvent: a stroke-play card with a player still in is not signed (locked). */
  cardsUnsigned: 'cards_unsigned',
} as const;
