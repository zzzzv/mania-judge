import type { Frame, OsuData } from '../src/types'
import type { FixtureOutput } from './fixture-types'

/**
 * 行表 ↔ fixture 编码。
 *
 * fixture 里把每一行压成 `[time, mask]`：mask 第 i 位 = 第 i 列按下。
 * 这是无损的（行数、同时间戳的多行、结尾仍按住都保留），只是为了别让 JSON
 * 里出现成千上万个 `boolean[]`。
 */

export function encodeFrames(frames: readonly Frame[]): [number, number][] {
  return frames.map((frame) => {
    let mask = 0
    for (let column = 0; column < frame.columns.length; column++) {
      if (frame.columns[column]) {
        mask |= 1 << column
      }
    }
    return [frame.time, mask]
  })
}

export function decodeFrames(
  rows: readonly (readonly number[])[],
  keyCount: number,
): Frame[] {
  const frames: Frame[] = new Array(rows.length)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const time = row[0]!
    const mask = row[1] ?? 0
    const columns: boolean[] = new Array(keyCount)

    for (let column = 0; column < keyCount; column++) {
      columns[column] = ((mask >> column) & 1) === 1
    }

    frames[i] = { time, columns }
  }

  return frames
}

export function toOsuData(fixture: FixtureOutput): OsuData {
  const { osuData } = fixture

  return {
    od: osuData.od,
    hp: osuData.hp,
    speedRate: osuData.speedRate,
    windowScale: osuData.windowScale,
    noteColumns: osuData.noteColumns,
    frames: decodeFrames(osuData.frames, osuData.noteColumns.length),
  }
}
