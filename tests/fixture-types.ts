import type { HitResultTable, OsuData } from '../src/types'

export interface ScoreInfo {
  combo: number
  totalScore: number
  mods: string[]
  modsBitmask: number
  statistics: HitResultTable<number>
  accuracy: number
}

export interface FixtureOutput {
  title: string
  difficulty: string
  creator: string
  holdRatio: number
  scoreInfo: ScoreInfo
  lifeFrames: [number, number][]
  osuData: OsuData
}