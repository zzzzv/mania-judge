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
}