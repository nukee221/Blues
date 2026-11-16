/** Stable failure codes returned by the signing actions; clients branch on these, never on text. */
export const SG = {
  invalid: 'invalid',
  notFound: 'not_found',
  /** The card is already signed (locked). */
  locked: 'locked',
  notInGroup: 'not_in_group',
  /** Role 'scorer' by a player who is not the group's scorer. */
  notGroupScorer: 'not_group_scorer',
  /** The group has no scorer yet, so nobody can sign as scorer. */
  noScorer: 'no_scorer',
  /** The attester is the scorer (one player cannot sign both roles). */
  sameAsScorer: 'same_as_scorer',
  /** Match round: the attester must be the scorer's opponent. */
  notOpponent: 'not_opponent',
  /** Not every score is in (stroke) or the match is not decided. */
  incomplete: 'incomplete',
  /** Match all square after 18: play extra holes before signing. */
  allSquare: 'all_square',
  /** The player has not set a PIN (Me → PIN); the commissioner can sign for them. */
  noPin: 'no_pin',
  wrongPin: 'wrong_pin',
  /** Five wrong PINs in ten minutes: this player's signing is blocked for ten minutes. */
  pinLocked: 'pin_locked',
  /** That role was signed by another player. */
  alreadySigned: 'already_signed',
  /** reopenCard on a card with no signatures. */
  notSigned: 'not_signed',
  /** The player withdrew (WD): cannot sign as scorer or attester. */
  withdrawn: 'withdrawn',
  /** Reopening a match card whose winner already plays (or won) the next bracket match. */
  nextMatchStarted: 'next_match_started',
  /** adminEditScore on a match card whose bracket result came from it: reopen the card instead. */
  matchDecided: 'match_decided',
} as const;

export type SignRole = 'scorer' | 'attest';
