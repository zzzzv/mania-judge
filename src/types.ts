export interface TapNote {
  column: number
  start: number
  end?: undefined
}

export interface HoldNote {
  column: number
  start: number
  end: number
}

export type Note = TapNote | HoldNote

export interface Action {
  column: number
  press: number
  release: number
}

export type Columns<T> = T[][]

export interface OsuData {
  od: number
  hp: number
  speedRate: number
  windowScale: number
  noteColumns: Columns<Note>
  actionColumns: Columns<Action>
  /**
   * 回放原始帧时间（毫秒，升序）。
   *
   * 判定是在这些帧上推进的，必须有：每个物件的结算时刻是「不早于边界的第一帧」，
   * 少了帧表就只能按边界本身结算，结果会差档。用 `replayToFrameTimes` 从回放帧里取。
   */
  frameTimes: readonly number[]
}

export const HIT_RESULTS = {
  Perfect: 0,
  Great: 1,
  Good: 2,
  Ok: 3,
  Meh: 4,
  Miss: 5,
} as const

export type HitResult = typeof HIT_RESULTS[keyof typeof HIT_RESULTS]
export type HitResultTable<T> = [T, T, T, T, T, T]
export type HitWindows = HitResultTable<number>

export interface TapJudgement {
  note: TapNote
  enter: number
  exit: number
  action?: Action
  result: HitResult
}

export interface TimeLineFrame {
  time: number
  combo: number
  maxCombo: number
  resultCounts: HitResultTable<number>
  life: number
  /** ScoreV1（0 ~ 1,000,000）；只有 osu-v1 时间轴会填 */
  score?: number
}