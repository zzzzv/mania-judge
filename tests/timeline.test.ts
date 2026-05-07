import { describe, expect, it } from 'vitest'

import { HIT_RESULTS, v1, type Columns, type HitResultTable, type JudgementV1 } from '../src'

describe('generateTimeLine', () => {
  it('applies hold ticks to combo and life without changing result counts', () => {
    const judgements: Columns<JudgementV1> = [
      [{
        note: {
          column: 0,
          start: 50,
        },
        enter: 0,
        exit: 100,
        actions: [],
        result: HIT_RESULTS.Miss,
      }],
      [{
        note: {
          column: 1,
          start: 0,
          end: 300,
        },
        enter: 0,
        exit: 300,
        actions: [],
        result: HIT_RESULTS.Great,
        ticks: [100],
      }],
    ]
    const lifeTable: HitResultTable<number> = [0.08, 0.05, 0.03, 0, -0.02, -0.2]

    const frames = v1.generateFrames(judgements, lifeTable)

    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({
      time: 100,
      combo: 1,
      maxCombo: 1,
      resultCounts: [0, 0, 0, 0, 0, 1],
    })
    expect(frames[0].life).toBeCloseTo(0.85)

    expect(frames[1]).toMatchObject({
      time: 300,
      combo: 2,
      maxCombo: 2,
      resultCounts: [0, 1, 0, 0, 0, 1],
    })
    expect(frames[1].life).toBeCloseTo(0.9)
  })
})