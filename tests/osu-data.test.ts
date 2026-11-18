import { describe, expect, it } from 'vitest'

import { createOsuData } from '../src'

const beatmap = {
  difficulty: { keyCount: 4, overallDifficulty: 8, hpDrainRate: 7 },
  hitObjects: [
    { column: 0, startTime: 1000 },
    { column: 1, startTime: 1200, endTime: 1600 },
  ],
}

const replay = {
  frames: [
    { time: 900, columns: [false, false, false, false] },
    { time: 990, columns: [true, false, false, false] },
    { time: 1020, columns: [false, false, false, false] },
  ],
}

describe('createOsuData', () => {
  it('reads difficulty and the mod scaling fields', () => {
    // osu-mania-io 1.0 起 mod 结果里是 lazer 口径的 difficultyMultiplier（HR = 1.4），窗口倍率是它的倒数
    const data = createOsuData({ ...beatmap, speedMultiplier: 1.5, difficultyMultiplier: 1.4 }, replay)

    expect(data.od).toBe(8)
    expect(data.hp).toBe(7)
    expect(data.speedRate).toBe(1.5)
    expect(data.windowScale).toBeCloseTo(1 / 1.4)
  })

  it('accepts the legacy hitWindowScale field', () => {
    const data = createOsuData({ ...beatmap, speedMultiplier: 1.5, hitWindowScale: 0.7 }, replay)

    expect(data.windowScale).toBe(0.7)
  })

  it('defaults speed rate and window scale to 1', () => {
    const data = createOsuData(beatmap, replay)

    expect(data.speedRate).toBe(1)
    expect(data.windowScale).toBe(1)
  })

  it('groups notes by column', () => {
    const { noteColumns } = createOsuData(beatmap, replay)

    expect(noteColumns).toHaveLength(4)
    expect(noteColumns[0]).toEqual([{ column: 0, start: 1000, end: undefined }])
    expect(noteColumns[1]).toEqual([{ column: 1, start: 1200, end: 1600 }])
    expect(noteColumns[2]).toEqual([])
  })

  it('passes the replay row table through untouched', () => {
    const { frames } = createOsuData(beatmap, replay)

    expect(frames).toBe(replay.frames)
    expect(frames.map((frame) => frame.time)).toEqual([900, 990, 1020])
    expect(frames[1]!.columns[0]).toBe(true)
  })
})
