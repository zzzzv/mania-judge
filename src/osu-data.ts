import type { OsuData } from './types'
import { beatmapToNoteColumns, replayToActionColumns, replayToFrameTimes } from './column'

/**
 * 结构化的谱面接口：只依赖判定真正用到的字段，不绑定任何解析库。
 * 如果已经把 mod 应用过（例如 `applyLegacyBeatmapMods`），它会额外带上
 * `speedMultiplier` / `hitWindowScale`，这里会一并读出来。
 */
export interface BeatmapLike {
  readonly difficulty: {
    readonly keyCount: number
    readonly overallDifficulty: number
    readonly hpDrainRate: number
  }
  readonly hitObjects: readonly {
    readonly column: number
    readonly startTime: number
    readonly endTime?: number
  }[]
  readonly speedMultiplier?: number
  readonly hitWindowScale?: number
}

/**
 * 结构化的回放接口：`columns` 是这一帧每列的按键状态。
 */
export interface ReplayLike {
  readonly frames: readonly {
    readonly time: number
    readonly columns: readonly boolean[]
  }[]
}

/**
 * 把「已解析的谱面 + 回放」组装成判定输入。
 *
 * 本库不解析 `.osu` / `.osr`，也不做 mod 计算，所以传进来的 `beatmap` 应当
 * 已经是应用过 mod 的那一份（`speedMultiplier` / `hitWindowScale` 会被读取；
 * `overallDifficulty` / `hpDrainRate` 也用应用后的值）。
 */
export function createOsuData(beatmap: BeatmapLike, replay: ReplayLike): OsuData {
  return {
    od: beatmap.difficulty.overallDifficulty,
    hp: beatmap.difficulty.hpDrainRate,
    speedRate: beatmap.speedMultiplier ?? 1,
    windowScale: beatmap.hitWindowScale ?? 1,
    noteColumns: beatmapToNoteColumns(beatmap),
    actionColumns: replayToActionColumns(replay.frames, beatmap.difficulty.keyCount),
    frameTimes: replayToFrameTimes(replay.frames),
  }
}
