import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lazer, type HitResultTable } from '../src'
import { toOsuData } from './fixture-frames'
import { fixtureNames, fixturesRoot } from './fixtures'
import type { FixtureOutput } from './fixture-types'

/**
 * lazer 判定层测试：只断言六档计数。
 *
 * lazer 的长条是「头 + 尾」各产生一个结果，所以计数要把 headResult 和 tailResult
 * 都算进去（stable 的 V1 是合并成一个）。
 */

async function expectJudgementMatches(dirName: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, 'lazer', dirName, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = lazer.playOsu(toOsuData(fixture))

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

for (const group of ['tap-only', 'hold', 'mods']) {
  describe(`osu-lazer judgement — ${group}`, () => {
    const names = fixtureNames('lazer', group)

    if (names.length === 0) it.skip('缺少样本（见启动时的提示）', () => {})

    for (const fixtureName of names) {
      it(fixtureName, () => expectJudgementMatches(group, fixtureName))
    }
  })
}
