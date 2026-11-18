import { HIT_RESULTS } from '../types'
import type { Columns, HitResult, HitResultTable } from '../types'
import { difficultyRange } from '../utils'
import type { JudgementV2 } from './types'

/**
 * lazer mania 的血量模型（`ManiaHealthProcessor : LegacyDrainingHealthProcessor`）。
 *
 * `ComputeDrainRate()` 被覆写成 0，所以**没有随时间流失**，血量只在判定时变化：
 *
 * ```
 * Miss  头部 / 尾部        -(DrainRate + 1) * 0.00375
 *       其它（tap）        -(DrainRate + 1) * 0.0075
 * Meh                      -(DrainRate + 1) * 0.0016
 * Ok                        0
 * Good                     (0.0040 - DrainRate * 0.0004) * HpMultiplierNormal
 * Great                    (0.0050 - DrainRate * 0.0005) * HpMultiplierNormal
 * Perfect                  (0.0055 - DrainRate * 0.0005) * HpMultiplierNormal
 * ```
 *
 * 注意前四档**不乘** `HpMultiplierNormal`（源码里是 `return` 直出），只有后三档乘。
 */

/** 一个长条的两端在血量上等同于「头 / 尾」，Miss 惩罚只有 tap 的一半。 */
export interface LifeTable {
  /** tap 的六档增量 */
  tap: HitResultTable<number>
  /** 长条头 / 尾的六档增量 */
  holdPart: HitResultTable<number>
}

function increaseFor(
  result: HitResult,
  hp: number,
  hpMultiplierNormal: number,
  isHoldPart: boolean,
): number {
  switch (result) {
    case HIT_RESULTS.Perfect:
      return hpMultiplierNormal * (0.0055 - hp * 0.0005)
    case HIT_RESULTS.Great:
      return hpMultiplierNormal * (0.0050 - hp * 0.0005)
    case HIT_RESULTS.Good:
      return hpMultiplierNormal * (0.0040 - hp * 0.0004)
    case HIT_RESULTS.Ok:
      return 0
    case HIT_RESULTS.Meh:
      return -(hp + 1) * 0.0016
    case HIT_RESULTS.Miss:
      return -(hp + 1) * (isHoldPart ? 0.00375 : 0.0075)
  }
}

export function createLifeTable(hp: number, hpMultiplierNormal = 1): LifeTable {
  const table = (isHoldPart: boolean): HitResultTable<number> => [
    increaseFor(HIT_RESULTS.Perfect, hp, hpMultiplierNormal, isHoldPart),
    increaseFor(HIT_RESULTS.Great, hp, hpMultiplierNormal, isHoldPart),
    increaseFor(HIT_RESULTS.Good, hp, hpMultiplierNormal, isHoldPart),
    increaseFor(HIT_RESULTS.Ok, hp, hpMultiplierNormal, isHoldPart),
    increaseFor(HIT_RESULTS.Meh, hp, hpMultiplierNormal, isHoldPart),
    increaseFor(HIT_RESULTS.Miss, hp, hpMultiplierNormal, isHoldPart),
  ]

  return { tap: table(false), holdPart: table(true) }
}

/**
 * `HpMultiplierNormal`。
 *
 * `LegacyDrainingHealthProcessor.ComputeDrainRate()` 里那段 stable 遗留的三重检测：
 * 先用初始 drain 试跑整张谱，收尾血量或平均恢复量不达标就 `*= 1.01` 重来。
 * 因为 lazer 的 mania drain 最终是 0，收敛条件只剩「平均恢复量 ≥ 可用恢复量」，
 * 这里按这个收敛条件直接迭代。
 *
 * 枚举口径与 v1 不同：lazer 没有 tick，长条贡献**头 + 尾**两个 Perfect 增量，
 * 分母仍是顶层物件数（每局 tick 在 stable 里算 300 分、在这里算 0）。
 */
export function computeHpMultiplierNormal(
  judgementColumns: Columns<JudgementV2>,
  hp: number,
): number {
  const judgements = judgementColumns.flat()

  if (judgements.length === 0) return 1

  const hpRecoveryAvailable = difficultyRange(hp, 0.04, 0.02, 0)

  let hpMultiplierNormal = 1

  while (true) {
    let currentHpUncapped = 1

    for (const judgement of judgements) {
      const parts = 'headResult' in judgement ? 2 : 1

      for (let i = 0; i < parts; i++) {
        currentHpUncapped += increaseFor(
          HIT_RESULTS.Perfect,
          hp,
          hpMultiplierNormal,
          true,
        )
      }
    }

    const recovery = (currentHpUncapped - 1) / judgements.length

    if (recovery < hpRecoveryAvailable) {
      hpMultiplierNormal *= 1.01
      continue
    }

    return hpMultiplierNormal
  }
}
