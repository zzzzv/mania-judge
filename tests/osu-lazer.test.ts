import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lazer, calcAccuracy, type HitResultTable } from '../src'
import type { FixtureOutput } from './fixture-types'

const tapOnlyFixturesDir = path.resolve(import.meta.dirname, 'fixtures/lazer/tap-only')
const modsFixturesDir = path.resolve(import.meta.dirname, 'fixtures/lazer/mods')
const tapOnlyFixtureNames = readdirSync(tapOnlyFixturesDir).filter((name) => name.endsWith('.json'))
const modsFixtureNames = readdirSync(modsFixturesDir).filter((name) => name.endsWith('.json'))

const runFixture = (fixture: FixtureOutput) => {
  const judgements = lazer.playOsu(fixture.osuData)
  const resultCounts: HitResultTable<number> = [0, 0, 0, 0, 0, 0]
  for (const j of judgements.flat()) {
    resultCounts[lazer.getResult(j)]++
  }

  const frames = lazer.generateFrames(judgements)
  const lastFrame = frames.at(-1)!

  return { judgements, resultCounts, lastFrame }
}

describe('osu-lazer tap-only fixtures', () => {
  it.each(tapOnlyFixtureNames)('tap-only/%s', async (fixtureName) => {
    const content = await readFile(path.join(tapOnlyFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const { lastFrame } = runFixture(fixture)

    expect(lastFrame.resultCounts).toEqual(fixture.scoreInfo.statistics)
    expect(lastFrame.maxCombo).toBeGreaterThanOrEqual(fixture.scoreInfo.combo - 1)
    expect(lastFrame.maxCombo).toBeLessThanOrEqual(fixture.scoreInfo.combo + 1)
  })
})

const holdFixturesDir = path.resolve(import.meta.dirname, 'fixtures/lazer/hold')
const holdFixtureNames = readdirSync(holdFixturesDir).filter((name) => name.endsWith('.json'))

describe('osu-lazer hold fixtures', () => {
  const accErrors: number[] = []

  it.each(holdFixtureNames)('hold/%s', async (fixtureName) => {
    const content = await readFile(path.join(holdFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const { lastFrame } = runFixture(fixture)

    const expectedAcc = fixture.scoreInfo.accuracy
    const actualAcc = calcAccuracy(lastFrame.resultCounts, lazer.accTable)
    accErrors.push(Math.abs(actualAcc - expectedAcc))
  })

  it('average accuracy error should be near zero', () => {
    expect(accErrors.length).toBeGreaterThan(0)

    const avg = accErrors.reduce((a, b) => a + b, 0) / accErrors.length
    expect(avg).toBeLessThanOrEqual(0.001)
    
    const max = Math.max(...accErrors)
    expect(max).toBeLessThanOrEqual(0.002)
  })
})

describe('osu-lazer mods fixtures', () => {
  const accErrors: number[] = []

  it.each(modsFixtureNames)('mods/%s', async (fixtureName) => {
    const content = await readFile(path.join(modsFixturesDir, fixtureName), 'utf8')
    const fixture = JSON.parse(content) as FixtureOutput
    const { lastFrame } = runFixture(fixture)

    const expectedAcc = fixture.scoreInfo.accuracy
    const actualAcc = calcAccuracy(lastFrame.resultCounts, lazer.accTable)
    accErrors.push(Math.abs(actualAcc - expectedAcc))
  })

  it('average accuracy error should be near zero', () => {
    expect(accErrors.length).toBeGreaterThan(0)

    const avg = accErrors.reduce((a, b) => a + b, 0) / accErrors.length
    expect(avg).toBeLessThanOrEqual(0.0005)

    const max = Math.max(...accErrors)
    expect(max).toBeLessThanOrEqual(0.002)
  })
})
