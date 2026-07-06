import { HIT_RESULTS } from './types'
import type {
  BaseJudgement,
  HitResultTable,
  HitWindows,
  HoldJudgementV1,
  JudgementV1,
  Note,
} from './types'

const epsilon = 1e-6

export function truncWindows(windows: Readonly<HitWindows>, scale: number = 1): HitWindows {
  const truncated: HitWindows = [...windows]
  for (let i = 0; i < truncated.length; i++) {
    truncated[i] = Math.trunc(truncated[i] * scale + epsilon)
  }
  return truncated
}

export function calcAccuracy(
  resultCounts: Readonly<HitResultTable<number>>,
  accTable: Readonly<HitResultTable<number>>
): number {
  let total = 0
  let acc = 0
  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
    total += resultCounts[i]
    acc += resultCounts[i] * accTable[i]
  }
  return total > 0 ? acc / total : 0
}

export function compareJudgements<T extends BaseJudgement<Note>>(a: T, b: T): number {
  if (a.exit !== b.exit) {
    return a.exit - b.exit
  }
  if (a.note.start !== b.note.start) {
    return a.note.start - b.note.start
  }
  return a.note.column - b.note.column
}

export function isHoldJudgement(judgement: JudgementV1): judgement is HoldJudgementV1 {
  return judgement.note.end !== undefined
}

export function countResults(judgements: JudgementV1[]): HitResultTable<number> {
  return judgements.reduce((sum, j) => {
    sum[j.result] += 1;
    return sum;
  }, [0, 0, 0, 0, 0, 0] as HitResultTable<number>);
}
