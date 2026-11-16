export type HoleInfo = { number: number; par: number; strokeIndex: number };
export type TeeInfo = { rating: number; slope: number; par: number; holes: HoleInfo[] };
export type RankedRow<T> = { item: T; position: number; tied: boolean };
export type Placing = { playerId: string; position: number; tied: boolean };
