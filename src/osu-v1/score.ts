import { HIT_RESULTS } from '../types'
import type { HitResult } from '../types'
import type { JudgementV1 } from './types'
import { isHoldJudgement } from './types'

/**
 * ScoreV1（mania）逐次判定累加模型，对应 stable 的 `ManiaScoreSubmission.onJudgment`。
 *
 * 每次判定贡献两项，合计再乘 `mult / 320`：
 *   - 判定值 `num`：MAX 320 / 300 / 200 / 100 / 50 / MISS 0
 *   - 手感项 `w * sqrt(health)`：MAX 32 / 300 32 / 200 16 / 100 8 / 50 4 / MISS 0
 *
 * `mult = 500000 / 物件数 * 倍率`（倍率只受 NF / EZ / HT 影响，各 ×0.5）。
 *
 * `health` 初始 100、夹在 [0, 100]，**每次判定前**如果当前连击是 384 的倍数就重置回 100。
 * 长条 tick（值为 7）与提前松手（-1048576）不加分也不改 health，但 tick 会 +1 连击、
 * 松手会把连击清零 —— 它们通过 384 重置间接影响分数，所以必须参与这个序列。
 */

/** 每档的 [判定值, 手感权重, health 增量]；MISS 单独处理（health 直接归零） */
const SCORE_TABLE: Readonly<Record<number, readonly [number, number, number]>> = {
  [HIT_RESULTS.Perfect]: [320, 32, 2],
  [HIT_RESULTS.Great]: [300, 32, 1],
  [HIT_RESULTS.Good]: [200, 16, -8],
  [HIT_RESULTS.Ok]: [100, 8, -24],
  [HIT_RESULTS.Meh]: [50, 4, -44],
  [HIT_RESULTS.Miss]: [0, 0, 0],
}

const MOD_MULTIPLIER: Readonly<Record<string, number>> = { NF: 0.5, EZ: 0.5, HT: 0.5 }

/** .NET 的 Math.Round 默认是中点取偶 */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

export type ScoreEventKind = 'judge' | 'tick' | 'break'

export interface ScoreAccumulator {
  /** 喂入一次事件，必须是判定产出顺序 */
  push: (kind: ScoreEventKind, result: HitResult) => void
  /** 当前 ScoreV1 原始累加值（未取整） */
  readonly raw: number
  /** 取整后的分数 */
  readonly score: number
  readonly combo: number
  readonly health: number
}

export function createScoreAccumulator(
  total: number,
  mods: readonly string[] = [],
): ScoreAccumulator {
  let modifier = 1
  for (const mod of mods) {
    modifier *= MOD_MULTIPLIER[mod] ?? 1
  }

  const unit = total > 0 ? 500_000 / total * modifier : 0
  let combo = 0
  let health = 100
  let raw = 0

  return {
    push(kind, result) {
      // ① 先算这次判定的 health 增量
      let nextHealth = health
      if (kind === 'judge') {
        nextHealth = result === HIT_RESULTS.Miss
          ? -56
          : nextHealth + SCORE_TABLE[result]![2]
      }

      // ② 再按「这一次之前」的连击决定是否重置（stable 在这里直接覆盖成 100）
      if (combo !== 0 && combo % 384 === 0) {
        nextHealth = 100
      }

      health = Math.min(100, Math.max(0, nextHealth))

      if (kind === 'judge') {
        const [value, weight] = SCORE_TABLE[result]!
        raw += unit / 320 * (weight * Math.sqrt(health) + value)
      }

      // ② 再推进连击：tick 也算 +1，break / miss 清零
      if (kind === 'break' || (kind === 'judge' && result === HIT_RESULTS.Miss)) {
        combo = 0
      } else {
        combo++
      }
    },
    get raw() {
      return raw
    },
    get score() {
      const score = roundHalfEven(raw)
      return score === 999_999 ? 1_000_000 : score
    },
    get combo() {
      return combo
    },
    get health() {
      return health
    },
  }
}

interface ScoreEvent {
  time: number
  exit: number
  column: number
  kind: ScoreEventKind
  result: HitResult
}

function buildEvents(judgements: readonly JudgementV1[]): ScoreEvent[] {
  const events: ScoreEvent[] = []

  for (const judgement of judgements) {
    const base = {
      exit: judgement.exit,
      column: judgement.note.column,
    }

    if (isHoldJudgement(judgement)) {
      for (const tick of judgement.ticks) {
        events.push({ ...base, time: tick, kind: 'tick', result: HIT_RESULTS.Great })
      }
      for (const breakTime of judgement.breakTimes
        ?? (judgement.breakTime !== undefined ? [judgement.breakTime] : [])) {
        events.push({ ...base, time: breakTime, kind: 'break', result: HIT_RESULTS.Miss })
      }
    }

    events.push({
      ...base,
      time: judgement.exit,
      kind: 'judge',
      result: judgement.result,
    })
  }

  return events.sort(
    (left, right) => left.time - right.time
      || left.column - right.column
      || left.exit - right.exit,
  )
}

/** ScoreV1（0 ~ 1,000,000） */
export function calculateScoreV1(
  judgements: readonly JudgementV1[],
  mods: readonly string[] = [],
): number {
  const accumulator = createScoreAccumulator(judgements.length, mods)
  for (const event of buildEvents(judgements)) {
    accumulator.push(event.kind, event.result)
  }
  return accumulator.score
}
