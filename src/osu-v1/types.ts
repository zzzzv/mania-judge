import type {
  HitWindows,
  HoldNote,
  Action,
  TapJudgement,
  HitResultTable,
  HitResult,
} from '../types'

export interface HoldJudgementV1 {
  note: HoldNote
  enter: number
  exit: number
  actions: Action[]
  result: HitResult
  breakTime?: number
  ticks: number[]
}

export type JudgementV1 = TapJudgement | HoldJudgementV1

export function isHoldJudgement(judgement: JudgementV1): judgement is HoldJudgementV1 {
  return judgement.note.end !== undefined
}

export function countResults(judgements: JudgementV1[]): HitResultTable<number> {
  return judgements.reduce((sum, j) => {
    sum[j.result] += 1;
    return sum;
  }, [0, 0, 0, 0, 0, 0] as HitResultTable<number>);
}

export const accTable: Readonly<HitResultTable<number>> = [1.0, 1.0, 2 / 3, 1 / 3, 1 / 6, 0.0]

export function baseWindows(od: number): HitWindows {
  return [
    16,
    64 - 3 * od,
    97 - 3 * od,
    127 - 3 * od,
    151 - 3 * od,
    188 - 3 * od,
  ]
}
