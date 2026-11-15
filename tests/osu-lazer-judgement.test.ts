import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lazer, type HitResultTable } from '../src'
import type { FixtureOutput } from './fixture-types'

/**
 * lazer 判定层测试：只断言六档计数。
 *
 * lazer 的长条是「头 + 尾」各产生一个结果，所以计数要把 headResult 和 tailResult
 * 都算进去（stable 的 V1 是合并成一个）。
 */

const fixturesRoot = path.resolve(import.meta.dirname, 'fixtures/lazer')

function fixtureNames(dirName: string) {
  return readdirSync(path.join(fixturesRoot, dirName)).filter((name) => name.endsWith('.json'))
}

async function expectJudgementMatches(dirName: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, dirName, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = lazer.playOsu(fixture.osuData)

  const counts: HitResultTable<number> = [0, 0, 0, 0, 0, 0]
  for (const judgement of judgements.flat()) {
    if ('headResult' in judgement) {
      counts[judgement.headResult]++
      counts[judgement.tailResult]++
    } else {
      counts[judgement.result]++
    }
  }

  expect(counts).toEqual(fixture.scoreInfo.statistics)
}

describe('osu-lazer judgement — tap-only', () => {
  for (const fixtureName of fixtureNames('tap-only')) {
    it(fixtureName, () => expectJudgementMatches('tap-only', fixtureName))
  }
})

describe('osu-lazer judgement — hold', () => {
  for (const fixtureName of fixtureNames('hold')) {
    it(fixtureName, () => expectJudgementMatches('hold', fixtureName))
  }
})

describe('osu-lazer judgement — mods', () => {
  for (const fixtureName of fixtureNames('mods')) {
    it(fixtureName, () => expectJudgementMatches('mods', fixtureName))
  }
})
