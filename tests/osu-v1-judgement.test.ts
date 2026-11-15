import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1 } from '../src'
import type { FixtureOutput } from './fixture-types'

/**
 * 判定层测试：只校验每个物件落在哪个档位（resultCounts），
 * 不掺杂 combo / life / 分数，这些属于 timeline 层。
 */

const fixturesRoot = path.resolve(import.meta.dirname, 'fixtures/stable')

const tapOnlyFixturesDir = path.join(fixturesRoot, 'tap-only')
const holdFixturesDir = path.join(fixturesRoot, 'hold')
const modsFixturesDir = path.join(fixturesRoot, 'mods')

const tapOnlyFixtureNames = readdirSync(tapOnlyFixturesDir).filter((name) => name.endsWith('.json'))
const holdFixtureNames = readdirSync(holdFixturesDir).filter((name) => name.endsWith('.json'))
const modsFixtureNames = readdirSync(modsFixturesDir).filter((name) => name.endsWith('.json'))

async function expectJudgementMatches(dir: string, fixtureName: string) {
  const content = await readFile(path.join(dir, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = v1.playOsu(fixture.osuData)
  const counts = v1.countResults(judgements.flat())

  expect(counts).toEqual(fixture.scoreInfo.statistics)
}

describe('osu-v1 judgement — tap-only', () => {
  for (const fixtureName of tapOnlyFixtureNames) {
    it(fixtureName, () => expectJudgementMatches(tapOnlyFixturesDir, fixtureName))
  }
})

describe('osu-v1 judgement — hold', () => {
  for (const fixtureName of holdFixtureNames) {
    it(fixtureName, () => expectJudgementMatches(holdFixturesDir, fixtureName))
  }
})

describe('osu-v1 judgement — mods', () => {
  for (const fixtureName of modsFixtureNames) {
    it(fixtureName, () => expectJudgementMatches(modsFixturesDir, fixtureName))
  }
})
