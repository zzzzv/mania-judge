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

/**
 * 一段按键区间（按下 → 松开）。
 *
 * 只出现在**输出**里（物件的判定记录了它吃掉了哪几段按键），判定输入用的是
 * `Frame` 行表 —— 区间是有损投影，不能反推出原始帧。
 */
export interface Action {
  column: number
  press: number
  release: number
}

export type Columns<T> = T[][]

/**
 * 分数倍率。
 *
 * 两种写法都行：
 *   - 直接给数字，例如 `0.5`；
 *   - 给影响分数的 mod 缩写，例如 `['HT']`，由规则集各自换算 ——
 *     `v1.scoreMultiplier` 只认 NF / EZ / HT（各 ×0.5），`lazer.scoreMultiplier` 认 mania 的完整倍率表。
 *
 * 不传等于 1（即「不含 mod 的分数」）。
 */
export type ScoreMultiplierInput = number | readonly string[]

/**
 * 回放行表的一行：这一帧（一次判定推进）每列的按键状态。
 *
 * 输入契约：升序、一行对应一次推进。**不要去重、不要排序**：同一时间戳的多行
 * 是 stable 的多次推进，去重会改变判定；`columns` 比键数短时按未按下处理。
 */
export interface Frame {
  time: number
  columns: readonly boolean[]
}

export interface OsuData {
  od: number
  hp: number
  speedRate: number
  windowScale: number
  noteColumns: Columns<Note>
  /** 原始回放行表，判定的时钟就是它 */
  frames: readonly Frame[]
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
  /** 分数（0 ~ 1,000,000）：v1 是 ScoreV1，lazer 是标准分；传了倍率就是乘完倍率的总分 */
  score?: number
}