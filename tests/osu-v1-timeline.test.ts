import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1 } from '../src'
import type { FixtureOutput } from './fixture-types'

/**
 * timeline 层测试：只校验 combo / score 这条链，判定档位由
 * `osu-v1-judgement.test.ts` 负责。两层分开，哪层错了能直接看出来。
 *
 * 血量没有真值可用（`.osr` 只存判定与连击，不存回放过程里的血条），
 * 所以这里不做断言。
 */

const fixturesRoot = path.resolve(import.meta.dirname, 'fixtures/stable')
const tapOnlyDir = path.join(fixturesRoot, 'tap-only')
const holdDir = path.join(fixturesRoot, 'hold')
const modsDir = path.join(fixturesRoot, 'mods')

const tapOnlyNames = readdirSync(tapOnlyDir).filter((name) => name.endsWith('.json'))
const holdNames = readdirSync(holdDir).filter((name) => name.endsWith('.json'))
const modsNames = readdirSync(modsDir).filter((name) => name.endsWith('.json'))

async function expectTimelineMatches(dir: string, fixtureName: string) {
  const content = await readFile(path.join(dir, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = v1.playOsu(fixture.osuData)
  const frames = v1.generateFramesOsu(
    judgements,
    fixture.osuData.hp,
    fixture.scoreInfo.mods ?? [],
  )
  const last = frames.at(-1)!

  expect(last.maxCombo).toBe(fixture.scoreInfo.combo)
  expect(last.score).toBe(fixture.scoreInfo.totalScore)
}

describe('osu-v1 timeline — tap-only', () => {
  for (const fixtureName of tapOnlyNames) {
    it(fixtureName, () => expectTimelineMatches(tapOnlyDir, fixtureName))
  }
})

describe('osu-v1 timeline — hold', () => {
  for (const fixtureName of holdNames) {
    it(fixtureName, () => expectTimelineMatches(holdDir, fixtureName))
  }
})

describe('osu-v1 timeline — mods', () => {
  for (const fixtureName of modsNames) {
    it(fixtureName, () => expectTimelineMatches(modsDir, fixtureName))
  }
})
