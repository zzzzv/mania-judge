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
    const data = createOsuData({ ...beatmap, speedMultiplier: 1.5, hitWindowScale: 0.7 }, replay)

    expect(data.od).toBe(8)
    expect(data.hp).toBe(7)
    expect(data.speedRate).toBe(1.5)
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

  it('folds replay frames into press/release actions', () => {
    const { actionColumns } = createOsuData(beatmap, replay)

    expect(actionColumns[0]).toEqual([{ column: 0, press: 990, release: 1020 }])
    expect(actionColumns[1]).toEqual([])
  })

  it('keeps the raw frame timeline', () => {
    const { frameTimes } = createOsuData(beatmap, replay)

    expect(frameTimes).toEqual([900, 990, 1020])
  })
})
