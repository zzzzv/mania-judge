import type { Columns, HitResultTable, Note } from '../src/types'

export interface ScoreInfo {
  combo: number
  totalScore: number
  mods: string[]
  modsBitmask: number
  statistics: HitResultTable<number>
  accuracy: number
}

/**
 * fixture 里的判定输入。
 *
 * 与 `OsuData` 唯一的差别是行表的编码：JSON 里存成 `[time, mask]`，
 * 掩码第 i 位表示第 i 列按下。用 `toOsuData` 展开成判定真正吃的形状。
 */
export interface FixtureOsuData {
  od: number
  hp: number
  speedRate: number
  windowScale: number
  noteColumns: Columns<Note>
  /** 回放原始行表（升序，一行一次推进）：`[time, mask]` */
  frames: [number, number][]
}

export interface FixtureOutput {
  title: string
  difficulty: string
  creator: string
  holdRatio: number
  scoreInfo: ScoreInfo
  lifeFrames: [number, number][]
  osuData: FixtureOsuData
}
