import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lazer } from '../src'
import type { FixtureOutput } from './fixture-types'

/**
 * lazer timeline 层测试：只断言连击。
 *
 * 分数（ScoreV2）与血量还没实现，等判定稳定后再补。
 */

const fixturesRoot = path.resolve(import.meta.dirname, 'fixtures/lazer')

function fixtureNames(dirName: string) {
  return readdirSync(path.join(fixturesRoot, dirName)).filter((name) => name.endsWith('.json'))
}

async function expectTimelineMatches(dirName: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, dirName, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = lazer.playOsu(fixture.osuData)
  const frames = lazer.generateFrames(judgements)

  expect(frames.at(-1)!.maxCombo).toBe(fixture.scoreInfo.combo)
}

describe('osu-lazer timeline — tap-only', () => {
  for (const fixtureName of fixtureNames('tap-only')) {
    it(fixtureName, () => expectTimelineMatches('tap-only', fixtureName))
  }
})

describe('osu-lazer timeline — hold', () => {
  for (const fixtureName of fixtureNames('hold')) {
    it(fixtureName, () => expectTimelineMatches('hold', fixtureName))
  }
})

describe('osu-lazer timeline — mods', () => {
  for (const fixtureName of fixtureNames('mods')) {
    it(fixtureName, () => expectTimelineMatches('mods', fixtureName))
  }
})
