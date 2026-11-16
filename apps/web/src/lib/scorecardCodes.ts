/** Stable failure codes returned by the scorecard actions; the client branches on these, never on text. */
export const SC = {
  invalidCode: 'invalid_code',
  notFound: 'not_found',
  locked: 'locked',
  notScorer: 'not_scorer',
  otherDevice: 'other_device',
  presetScorer: 'preset_scorer',
  notInGroup: 'not_in_group',
  noDevice: 'no_device',
  invalid: 'invalid',
  conflict: 'conflict',
  /** The player withdrew (WD) from the play-in. */
  withdrawn: 'withdrawn',
} as const;

/** Per-entry rejection reasons from saveScores. */
export const REJECT = {
  invalid: 'invalid',
  badGross: 'bad_gross',
  notInGroup: 'not_in_group',
  badHole: 'bad_hole',
  noExtraHoles: 'no_extra_holes',
} as const;
