import type { OsuData, Frame } from './types'
import { beatmapToNoteColumns } from './column'

/**
 * 结构化的谱面接口：只依赖判定真正用到的字段，不绑定任何解析库。
 * 如果已经把 mod 应用过（例如 `applyLegacyBeatmapMods`），它会额外带上
 * `speedMultiplier` / `difficultyMultiplier`，这里会一并读出来。
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
  /** 播放速率倍率，DT/HT 等改它 */
  readonly speedMultiplier?: number
  /** lazer 口径的判定窗口倍率（HR = 1.4 更宽、EZ = 0.5 更窄），`osu-mania-io` 1.0 起用这个字段 */
  readonly difficultyMultiplier?: number
  /** `osu-mania-io` 0.1.x 的字段，本身就是窗口倍率（HR = 1/1.4），两个都给时以它为准 */
  readonly hitWindowScale?: number
}

/**
 * 把 mod 应用结果换算成「窗口倍率」。
 *
 * `osu-mania-io` 0.1.x 的 `hitWindowScale` 直接就是倍率；1.0 起换成 lazer 的
 * `difficultyMultiplier`，两者互为倒数（HR 在旧版是 1/1.4、新版是 1.4）。
 */
const readWindowScale = (beatmap: BeatmapLike): number => {
  if (beatmap.hitWindowScale !== undefined)
    return beatmap.hitWindowScale

  return beatmap.difficultyMultiplier === undefined ? 1 : 1 / beatmap.difficultyMultiplier
}

/**
 * 结构化的回放接口：`columns` 是这一帧每列的按键状态。
 * `osu-mania-io` 的 `parseReplay().frames` 直接满足这个形状（零拷贝）。
 */
export interface ReplayLike {
  readonly frames: readonly Frame[]
}

/**
 * 把「已解析的谱面 + 回放」组装成判定输入。
 *
 * 本库不解析 `.osu` / `.osr`，也不做 mod 计算，所以传进来的 `beatmap` 应当
 * 已经是应用过 mod 的那一份（`speedMultiplier` / `difficultyMultiplier` 会被读取；
 * `overallDifficulty` / `hpDrainRate` 也用应用后的值）。
 *
 * 回放帧原样透传：行表就是判定的时钟，不做折叠、不去重、不排序。
 */
export function createOsuData(beatmap: BeatmapLike, replay: ReplayLike): OsuData {
  return {
    od: beatmap.difficulty.overallDifficulty,
    hp: beatmap.difficulty.hpDrainRate,
    speedRate: beatmap.speedMultiplier ?? 1,
    windowScale: readWindowScale(beatmap),
    noteColumns: beatmapToNoteColumns(beatmap),
    frames: replay.frames,
  }
}
