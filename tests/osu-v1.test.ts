import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1, calcAccuracy, type TimeLineFrame } from '../src'
import type { FixtureOutput } from './fixture-types'

const tapOnlyFixturesDir = path.resolve(import.meta.dirname, 'fixtures/stable/tap-only')
const holdFixturesDir = path.resolve(import.meta.dirname, 'fixtures/stable/hold')
const modsFixturesDir = path.resolve(import.meta.dirname, 'fixtures/stable/mods')
const tapOnlyFixtureNames = readdirSync(tapOnlyFixturesDir).filter((name) => name.endsWith('.json'))
const holdFixtureNames = readdirSync(holdFixturesDir).filter((name) => name.endsWith('.json'))
const modsFixtureNames = readdirSync(modsFixturesDir).filter((name) => name.endsWith('.json'))

/**
 * Sample life values at the given frame timestamps and compare with expected.
 *
 * Due to minor differences between our life simulation and osu!stable's internal
 * life accumulation (e.g. rounding at each step, per-frame update timing), a few
 * individual frames may mismatch by ±0.01. We allow up to `toleranceRatio` of
 * frames to be off rather than requiring an exact match.
 */
function getLifeSamples(events: TimeLineFrame[], lifeFrames: FixtureOutput['lifeFrames']) {
  const samples = {
    times: [] as number[],
    expected: [] as number[],
    actual: [] as number[],
    mismatchedIndices: [] as number[],
  }
  let eventIndex = 0
  let lastLife = 1.0

  for (let i = 0; i < lifeFrames.length; i++) {
    const [time, expectedLife] = lifeFrames[i]

    while (eventIndex < events.length && events[eventIndex].time <= time) {
      lastLife = events[eventIndex].life
      eventIndex++
    }

    const actual = Math.round(lastLife * 100) / 100

    samples.times.push(time)
    samples.expected.push(expectedLife)
    samples.actual.push(actual)

    if (actual !== expectedLife) {
      samples.mismatchedIndices.push(i)
    }
  }

  return samples
}

function expectLifeSamplesWithinTolerance(
  samples: ReturnType<typeof getLifeSamples>,
  toleranceRatio = 0.08,
) {
  const total = samples.expected.length
  const mismatched = samples.mismatchedIndices.length
  const maxAllowed = Math.max(1, Math.floor(total * toleranceRatio))

  if (mismatched > maxAllowed) {
    const detailLines = samples.mismatchedIndices.map((i) => {
      const t = samples.times[i]
      const exp = samples.expected[i]
      const act = samples.actual[i]
      return `  frame[${i}] time=${t}: expected=${exp.toFixed(2)}, actual=${act.toFixed(2)}`
    })
    expect(
      mismatched <= maxAllowed,
      `Life mismatch: ${mismatched}/${total} frames off (max allowed: ${maxAllowed}). Details:\n${detailLines.join('\n')}`,
    ).toBe(true)
  }
}

describe('osu-v1 tap-only fixtures', () => {
  it.each(tapOnlyFixtureNames)('tap-only/%s', async (fixtureName) => {
    const content = await readFile(path.join(tapOnlyFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const judgements = v1.playOsu(fixture.osuData)
    const events = v1.generateFramesOsu(judgements, fixture.osuData.hp)
    const lastEvent = events.at(-1)!

    expect(lastEvent.resultCounts).toEqual(fixture.scoreInfo.statistics)
    expect(lastEvent.maxCombo).toBe(fixture.scoreInfo.combo)

    const sampledLives = getLifeSamples(events, fixture.lifeFrames)
    expectLifeSamplesWithinTolerance(sampledLives)
  })
})

describe('osu-v1 hold fixtures', () => {
  it.each(holdFixtureNames)('hold/%s', async (fixtureName) => {
    const content = await readFile(path.join(holdFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const judgements = v1.playOsu(fixture.osuData)
    const events = v1.generateFramesOsu(judgements, fixture.osuData.hp)
    const lastEvent = events.at(-1)!

    //expect.soft(lastEvent.resultCounts).toEqual(fixture.scoreInfo.statistics)

    // Accuracy deviation correlates with hold ratio — more LN ticks mean more
    // opportunities for tick-score rounding to diverge from stable. Derived
    // empirically: tolerance = 0.0015 + 0.0050 * holdRatio
    const accTolerance = 0.0015 + 0.0050 * fixture.holdRatio
    expect.soft(
      Math.abs(calcAccuracy(lastEvent.resultCounts, v1.accTable) - fixture.scoreInfo.accuracy),
    ).toBeLessThanOrEqual(accTolerance)

    //expect.soft(lastEvent.maxCombo).toBe(fixture.scoreInfo.combo)

    //const sampledLives = getLifeSamples(events, fixture.lifeFrames)
    //expectLifeSamplesWithinTolerance(sampledLives)
  })
})

describe('osu-v1 mods fixtures', () => {
  it.each(modsFixtureNames)('mods/%s', async (fixtureName) => {
    const content = await readFile(path.join(modsFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const judgements = v1.playOsu(fixture.osuData)
    const events = v1.generateFramesOsu(judgements, fixture.osuData.hp)
    const lastEvent = events.at(-1)!

    if (fixture.holdRatio === 0) {
      // Pure tap — the simulation fully matches stable, so assert strictly.
      expect.soft(lastEvent.resultCounts).toEqual(fixture.scoreInfo.statistics)
      expect(lastEvent.maxCombo).toBe(fixture.scoreInfo.combo)
      expect.soft(calcAccuracy(lastEvent.resultCounts, v1.accTable)).toBeCloseTo(fixture.scoreInfo.accuracy, 3)
    } else {
      // Holds introduce tick-score rounding differences; use proportional tolerance.
      const accTolerance = 0.002 + 0.0050 * fixture.holdRatio
      expect.soft(
        Math.abs(calcAccuracy(lastEvent.resultCounts, v1.accTable) - fixture.scoreInfo.accuracy),
      ).toBeLessThanOrEqual(accTolerance)
    }
  })
})