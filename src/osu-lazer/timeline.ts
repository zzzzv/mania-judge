import { HIT_RESULTS } from '../types'
import type { Columns, HitResultTable, ScoreMultiplierInput, TimeLineFrame } from '../types'
import { clamp } from '../utils'
import { buildEvents } from './events'
import { computeHpMultiplierNormal, createLifeTable, type LifeTable } from './health'
import { createScoreAccumulator, scoreMultiplier, type ScoreMultiplierOptions } from './score'
import type { JudgementV2 } from './types'

/** 数字原样用，mod 列表按 mania 的倍率表换算；不传等于 1。 */
function resolveMultiplier(
  input: ScoreMultiplierInput | undefined,
  options: ScoreMultiplierOptions,
): number {
  if (input === undefined) return 1
  return typeof input === 'number' ? input : scoreMultiplier(input, options)
}

/**
 * 生成时间轴帧。
 *
 * 事件只有两类（见 `events.ts`）：`judge` 进六档计数、加连击、回血、加分；
 * `break`（长条 body 的 `ComboBreak`）只清连击。lazer 没有 tick，也没有其它清零来源。
 *
 * `multiplier` 只影响分数：给了就是带倍率的 `TotalScore`，不给就是 `TotalScoreWithoutMods`
 * （与 lazer 内部的两个字段一一对应，取整顺序也一致）。
 */
export function generateFrames(
  judgementColumns: Columns<JudgementV2>,
  lifeTable: LifeTable,
  multiplier: ScoreMultiplierInput = [],
  options: ScoreMultiplierOptions = {},
): TimeLineFrame[] {
  const judgements = judgementColumns.flat()
  const sorted = buildEvents(judgements)
  const total = sorted.reduce((sum, event) => sum + (event.kind === 'judge' ? 1 : 0), 0)
  const score = createScoreAccumulator(total)
  const factor = resolveMultiplier(multiplier, options)

  const frames: TimeLineFrame[] = []
  const last = {
    time: 0,
    combo: 0,
    maxCombo: 0,
    resultCounts: [0, 0, 0, 0, 0, 0] as HitResultTable<number>,
    life: 1,
  }

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i]!

    last.time = event.time
    score.push(event.kind, event.result)

    // 连击：命中 +1，Miss 与 body 破条清零
    if (event.kind === 'break' || event.result === HIT_RESULTS.Miss) {
      last.combo = 0
    } else {
      last.combo++
      if (last.combo > last.maxCombo) last.maxCombo = last.combo
    }

    if (event.kind === 'judge') {
      last.resultCounts[event.result]++
      last.life = clamp(
        last.life + (event.isHoldPart ? lifeTable.holdPart : lifeTable.tap)[event.result],
        0,
        1,
      )
    }

    const next = sorted[i + 1]
    if (next?.time === event.time) continue

    frames.push({
      time: last.time,
      combo: last.combo,
      maxCombo: last.maxCombo,
      resultCounts: [...last.resultCounts],
      life: last.life,
      score: Math.round(score.score * factor),
    })
  }

  return frames
}

/**
 * 从判定结果直接生成时间轴（与 `v1.generateFramesOsu` 同形：只取必需的血量参数，
 * 不依赖整个 `OsuData`）。
 *
 * `multiplier` 是分数倍率：给数字就直接乘，给 mod 缩写列表按 mania 的倍率表换算
 * （HT / DC / EZ / NF / key mod …），不传就是不含 mod 的总分。
 */
export function generateFramesOsu(
  judgementColumns: Columns<JudgementV2>,
  hp: number,
  multiplier: ScoreMultiplierInput = [],
  options: ScoreMultiplierOptions = {},
): TimeLineFrame[] {
  const hpMultiplierNormal = computeHpMultiplierNormal(judgementColumns, hp)
  return generateFrames(
    judgementColumns,
    createLifeTable(hp, hpMultiplierNormal),
    multiplier,
    options,
  )
}
