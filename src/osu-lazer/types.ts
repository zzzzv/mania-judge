import type {
  HitWindows,
  HoldNote,
  Action,
  TapJudgement,
  HitResult,
  HitResultTable,
} from '../types'
import { difficultyRange } from '../utils'

// ── Hold judgement types (lazer-style) ──────────────────────────────

export interface HoldJudgementV2 {
  note: HoldNote
  headEnter: number
  headExit: number
  tailEnter: number
  tailExit: number
  actions: Action[]
  headResult: HitResult
  tailResult: HitResult
  breakTime?: number
}

export type JudgementV2 = TapJudgement | HoldJudgementV2

export function isHoldV2(judgement: JudgementV2): judgement is HoldJudgementV2 {
  return 'headResult' in judgement
}

/** Extract the statistics result from a judgement (head result for holds). */
export function getResult(judgement: JudgementV2): HitResult {
  return isHoldV2(judgement) ? judgement.headResult : judgement.result
}

// ── Constants ────────────────────────────────────────────────────────

/** Accuracy weights matching lazer's mania scoring (Perfect=305, Great=300, etc.). */
export const accTable: Readonly<HitResultTable<number>> = [
  305 / 305,
  300 / 305,
  200 / 305,
  100 / 305,
  50 / 305,
  0,
]

// ── Timing windows ───────────────────────────────────────────────────

export function baseWindows(od: number): HitWindows {
  return [
    difficultyRange(od, 22.4, 19.4, 13.9),
    difficultyRange(od, 64,   49,   34  ),
    difficultyRange(od, 97,   82,   67  ),
    difficultyRange(od, 127,  112,  97  ),
    difficultyRange(od, 151,  136,  121 ),
    difficultyRange(od, 188,  173,  158 ),
  ]
}

/**
 * Build 1.5× expanded windows for hold tail judgement.
 * Matches lazer's CheckForResult which divides timeOffset by 1.5
 * before comparing against the base (floor+0.5) windows:
 *   |delta| / 1.5 <= floor(base) + 0.5
 *   ⇔ |delta| <= (floor(base) + 0.5) * 1.5
 */
const RELEASE_WINDOW_LENIENCE = 1.5

export function tailWindows(headWindows: Readonly<HitWindows>): HitWindows {
  return headWindows.map(w => (w + 0.5) * RELEASE_WINDOW_LENIENCE) as HitWindows
}
