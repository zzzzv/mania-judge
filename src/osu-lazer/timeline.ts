import { HIT_RESULTS } from '../types'
import type {
  Columns,
  HitResult,
  HitResultTable,
  TimeLineFrame,
} from '../types'
import type { JudgementV2 } from './types'

export { isHoldV2, getResult } from './types'

// ── Events ───────────────────────────────────────────────────────────

interface TimeLineEvent {
  time: number
  judgement: JudgementV2
  result: HitResult
  affectsResultCounts: boolean
}

function createEvents(judgement: JudgementV2): TimeLineEvent[] {
  // Use inline type narrowing for better TS support
  if (!('headResult' in judgement)) {
    // Tap note: single event
    return [{
      time: judgement.exit,
      judgement,
      result: judgement.result,
      affectsResultCounts: true,
    }]
  }

  // 长条在 lazer 里拆成 HeadNote / TailNote 两个对象，各自一定产出一个结果
  return [
    {
      time: judgement.headExit,
      judgement,
      result: judgement.headResult,
      affectsResultCounts: true,
    },
    {
      time: judgement.tailEnter,
      judgement,
      result: judgement.tailResult,
      affectsResultCounts: true,
    },
  ]
}

function compareEvents(left: TimeLineEvent, right: TimeLineEvent): number {
  if (left.time !== right.time) {
    return left.time - right.time
  }
  // Same time: process in column order (0 → K-1).
  // In osu-framework, the leftmost column receives input first.
  if (left.judgement.note.column !== right.judgement.note.column) {
    return left.judgement.note.column - right.judgement.note.column
  }
  return left.judgement.note.start - right.judgement.note.start
}

// ── Frame generation (no health/life) ────────────────────────────────

/**
 * Generate timeline frames from judgement columns.
 *
 * Tracks combo, max combo, and result counts over time.
 * Health/life simulation is not included (use the osu-v1 variant for that).
 */
export function generateFrames(
  judgementColumns: Columns<JudgementV2>,
): TimeLineFrame[] {
  const sorted = judgementColumns
    .flat()
    .flatMap(createEvents)
    .sort(compareEvents)

  const frames: TimeLineFrame[] = []
  const last = {
    time: 0,
    combo: 0,
    maxCombo: 0,
    resultCounts: [0, 0, 0, 0, 0, 0] as HitResultTable<number>,
    life: 1,
  }

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i]

    last.time = event.time

    if (event.result < HIT_RESULTS.Miss) {
      last.combo++
      if (last.combo > last.maxCombo) {
        last.maxCombo = last.combo
      }
    } else {
      last.combo = 0
    }

    if (event.affectsResultCounts) {
      last.resultCounts[event.result]++
    }

    const nextEvent = sorted[i + 1]
    if (nextEvent?.time === event.time) {
      continue
    }

    frames.push({
      time: last.time,
      combo: last.combo,
      maxCombo: last.maxCombo,
      resultCounts: [...last.resultCounts],
      life: last.life,
    })
  }

  return frames
}
