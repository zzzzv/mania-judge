import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1 } from '../src'
import { toOsuData } from './fixture-frames'
import { fixtureNames, fixturesRoot } from './fixtures'
import type { FixtureOutput } from './fixture-types'

/**
 * 判定层测试：只校验每个物件落在哪个档位（resultCounts），
 * 不掺杂 combo / life / 分数，这些属于 timeline 层。
 */

async function expectJudgementMatches(group: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, 'stable', group, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = v1.playOsu(toOsuData(fixture))
  const counts = v1.countResults(judgements.flat())

  expect(counts).toEqual(fixture.scoreInfo.statistics)
}

for (const group of ['tap-only', 'hold', 'mods']) {
  describe(`osu-v1 judgement — ${group}`, () => {
    const names = fixtureNames('stable', group)

    if (names.length === 0) it.skip('缺少样本（见启动时的提示）', () => {})

    for (const fixtureName of names) {
      it(fixtureName, () => expectJudgementMatches(group, fixtureName))
    }
  })
}
