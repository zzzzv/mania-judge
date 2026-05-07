import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1, calcAccuracy, type TimeLineFrame } from '../src'
import type { FixtureOutput } from './fixture-types'

const tapOnlyFixturesDir = path.resolve(import.meta.dirname, 'fixtures/json/tap-only')
const holdFixturesDir = path.resolve(import.meta.dirname, 'fixtures/json/hold')
const modsFixturesDir = path.resolve(import.meta.dirname, 'fixtures/json/mods')
const tapOnlyFixtureNames = readdirSync(tapOnlyFixturesDir).filter((name) => name.endsWith('.json'))
const holdFixtureNames = readdirSync(holdFixturesDir).filter((name) => name.endsWith('.json'))
const modsFixtureNames = readdirSync(modsFixturesDir).filter((name) => name.endsWith('.json'))

function getLifeSamples(events: TimeLineFrame[], lifeFrames: FixtureOutput['lifeFrames']) {
  const samples = {
    times: [] as number[],
    expected: [] as number[],
    actual: [] as number[],
  }
  let eventIndex = 0
  let lastLife = 1.0

  for (const [time, expectedLife] of lifeFrames) {
    while (eventIndex < events.length && events[eventIndex].time <= time) {
      lastLife = events[eventIndex].life
      eventIndex++
    }

    samples.times.push(time)
    samples.expected.push(expectedLife)
    samples.actual.push(Math.round(lastLife * 100) / 100)
  }

  return samples
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

    //const sampledLives = getLifeSamples(events, fixture.lifeFrames)
    //expect(sampledLives.expected).toEqual(sampledLives.actual)
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
    expect.soft(calcAccuracy(lastEvent.resultCounts, v1.accTable)).toBeCloseTo(fixture.scoreInfo.accuracy, 3)
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

    expect.soft(lastEvent.resultCounts).toEqual(fixture.scoreInfo.statistics)
    expect.soft(calcAccuracy(lastEvent.resultCounts, v1.accTable)).toBeCloseTo(fixture.scoreInfo.accuracy, 3)
  })
})