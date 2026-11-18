import { HIT_RESULTS } from '../types'
import type { HitResult, HitResultTable } from '../types'
import { buildEvents, type ScoreEventKind } from './events'
import type { JudgementV2 } from './types'

/**
 * lazer 的标准分（`ManiaScoreProcessor` + `ScoreProcessor`）。
 *
 * ```
 * TotalScore = round(150000 * comboProgress
 *                  + 850000 * Accuracy^ (2 + 2 * Accuracy) * accuracyProgress
 *                  + bonusPortion)        // mania 没有 bonus，恒 0
 *
 * comboProgress    = currentComboPortion / maximumComboPortion
 * accuracyProgress = 已判可计分数 / 全谱可计分数
 * Accuracy         = currentBaseScore / currentMaximumBaseScore   （分母只算已判的部分）
 * ```
 *
 * 每次判定的两项贡献：
 *   - 基础分（进 Accuracy 分母/分子）：Perfect 305、Great 300、Good 200、Ok 100、Meh 50、Miss 0
 *   - 连击分：`基础分(Perfect 取 300) * clamp(log4(连击数), 0.5, log4(400))`
 *
 * `maximumComboPortion` 是 `ScoreProcessor.SimulateAutoplay()` 的结果：按全 Perfect 跑一遍，
 * 第 c 个可计分判定的连击恰好是 c，所以可以闭式求和。
 *
 * 这里算的是 `TotalScoreWithoutMods`；成绩提交用的 mod 倍率
 * （`ManiaScoreMultiplierCalculator`）不在时间轴上体现，由调用方另行相乘。
 */

/** `ManiaScoreProcessor.GetBaseScoreForResult`：mania 把 Perfect 提到 305，其余沿用默认。 */
const BASE_SCORE: Readonly<HitResultTable<number>> = [305, 300, 200, 100, 50, 0]

/** `getBaseComboScoreForResult`：Perfect 取 300（不是 305），其余同基础分。 */
const COMBO_BASE_SCORE: Readonly<HitResultTable<number>> = [300, 300, 200, 100, 50, 0]

const COMBO_LOG_MAX = Math.log(400) / Math.log(4)

/** `Math.Log(comboAfter, 4)` 夹在 `[max(0.5, ...), log4(400)]`。 */
function comboFactor(combo: number): number {
  return Math.min(Math.max(0.5, Math.log(combo) / Math.log(4)), COMBO_LOG_MAX)
}

/**
 * mod 分数倍率（`ManiaScoreMultiplierCalculator`）。
 *
 * 各 mod 的倍率是**相乘**的，没有组合倍率：
 * `EZ` / `NF` / `DA` / `WU` / `WD` / `AS` 各 0.5，`NR` / `CS` / `HO` 各 0.9，
 * `HT` / `DC` 按倍速插值，`1K`~`10K` 按客户端版本取 0.9 或 1，`CL` 在旧分数版本下取 0.96；
 * 其余（DT / NC / HR / SD / HD / CO / FL / MR / IN 等）都是 1 —— mania 的倍率表里
 * 只注册了减速，DT / NC 那一行是注释掉的。
 */
export interface ScoreMultiplierOptions {
  /** 倍速；不传则按 mod 推断（HT / DC 0.75，DT / NC 1.5） */
  speedRate?: number
  /** 历史成绩的客户端版本（如 `2025.718.0`），决定 key mod 是 1 还是 0.9 */
  clientVersion?: string
  /** 历史成绩的记录时间：没有客户端版本时用它回退判断 key mod 口径 */
  date?: Date
  /** 历史成绩的 `TotalScoreVersion`：小于 30000017 时 Classic 取 0.96 */
  totalScoreVersion?: number
}

const FLAT_MULTIPLIER: Readonly<Record<string, number>> = {
  EZ: 0.5,
  NF: 0.5,
  DA: 0.5,
  WU: 0.5,
  WD: 0.5,
  AS: 0.5,
  NR: 0.9,
  CS: 0.9,
  HO: 0.9,
}

/**
 * 只有**减**速会打折：mania 的倍率表里注册了 HT / DC，DT / NC 那一行是注释掉的，
 * 所以加速照 1.0 算。
 */
const RATE_MULTIPLIER_SPEED: Readonly<Record<string, number>> = {
  HT: 0.75,
  DC: 0.75,
}

const KEY_MOD = /^([1-9]|10)K$/

/** `rateAdjustMultiplier`：倍速先截断到 0.1，再相对 1.0 折成倍率。 */
function rateAdjustMultiplier(speedChange: number): number {
  const value = Math.trunc(speedChange * 10) / 10 - 1
  return speedChange >= 1 ? 1 + value / 5 : 0.6 + value
}

/** key mod 的 0.9 倍率是 2025.718 引入的；更早的成绩按 1 算。 */
function keyModMultiplier(options: ScoreMultiplierOptions): number {
  if (options.clientVersion) {
    const [year, monthDay] = options.clientVersion.split('.')
    const yearValue = Number(year)
    const monthDayValue = Number(monthDay)

    if (Number.isFinite(yearValue) && Number.isFinite(monthDayValue)) {
      return yearValue < 2025 || (yearValue === 2025 && monthDayValue < 718) ? 1 : 0.9
    }
  }

  if (options.date && options.date.getTime() < Date.UTC(2025, 6, 18)) return 1

  return 0.9
}

export function scoreMultiplier(
  mods: readonly string[],
  options: ScoreMultiplierOptions = {},
): number {
  let multiplier = 1

  for (const mod of mods) {
    const flat = FLAT_MULTIPLIER[mod]

    if (flat !== undefined) {
      multiplier *= flat
      continue
    }

    const speed = RATE_MULTIPLIER_SPEED[mod]

    if (speed !== undefined) {
      multiplier *= rateAdjustMultiplier(options.speedRate ?? speed)
      continue
    }

    if (KEY_MOD.test(mod)) {
      multiplier *= keyModMultiplier(options)
      continue
    }

    if (mod === 'CL') {
      multiplier *= options.totalScoreVersion !== undefined && options.totalScoreVersion < 30_000_017
        ? 0.96
        : 1
    }
  }

  return multiplier
}

/** .NET 的 `Math.Round` 默认是中点取偶 */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * 全 Perfect 时的连击分总和（`SimulateAutoplay` 的 `maximumComboPortion`）。
 *
 * `total` 是可计分判定数：tap 记 1，长条记 2。
 */
export function maximumComboPortion(total: number): number {
  let sum = 0
  for (let combo = 1; combo <= total; combo++) {
    sum += COMBO_BASE_SCORE[HIT_RESULTS.Perfect] * comboFactor(combo)
  }
  return sum
}

export interface ScoreAccumulator {
  /** 喂入一次事件，必须是时间轴顺序 */
  push: (kind: ScoreEventKind, result: HitResult) => void
  /** 取整后的标准分（未乘 mod 倍率） */
  readonly score: number
  readonly combo: number
  /** 当前精度（分母只算已判部分） */
  readonly accuracy: number
}

export function createScoreAccumulator(total: number): ScoreAccumulator {
  const maximum = maximumComboPortion(total)
  const perfectBase = BASE_SCORE[HIT_RESULTS.Perfect]

  let combo = 0
  let comboPortion = 0
  let baseScore = 0
  /** `currentMaximumBaseScore`：只累加**已判**物件的上限分（305） */
  let maximumBase = 0
  let judged = 0

  return {
    push(kind, result) {
      if (kind === 'break') {
        combo = 0
        return
      }

      judged++
      maximumBase += perfectBase

      if (result < HIT_RESULTS.Miss) {
        combo++
      } else {
        combo = 0
      }

      comboPortion += COMBO_BASE_SCORE[result] * comboFactor(combo)
      baseScore += BASE_SCORE[result]
    },
    get score() {
      const accuracy = maximumBase > 0 ? baseScore / maximumBase : 1
      const comboProgress = maximum > 0 ? comboPortion / maximum : 1
      const accuracyProgress = total > 0 ? judged / total : 1

      const raw = 150_000 * comboProgress
        + 850_000 * Math.pow(accuracy, 2 + 2 * accuracy) * accuracyProgress

      return Math.max(0, roundHalfEven(raw))
    },
    get combo() {
      return combo
    },
    get accuracy() {
      return maximumBase > 0 ? baseScore / maximumBase : 1
    },
  }
}

/** 标准分（0 ~ 1,000,000，未乘 mod 倍率） */
export function calculateScore(judgements: readonly JudgementV2[]): number {
  const events = buildEvents(judgements)
  const total = events.reduce((sum, event) => sum + (event.kind === 'judge' ? 1 : 0), 0)
  const accumulator = createScoreAccumulator(total)

  for (const event of events) accumulator.push(event.kind, event.result)

  return accumulator.score
}
