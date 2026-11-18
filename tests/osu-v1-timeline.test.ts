import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { v1 } from '../src'
import { toOsuData } from './fixture-frames'
import { fixtureNames, fixturesRoot } from './fixtures'
import type { FixtureOutput } from './fixture-types'

/**
 * timeline 层测试：只校验 combo / score 这条链，判定档位由
 * `osu-v1-judgement.test.ts` 负责。两层分开，哪层错了能直接看出来。
 *
 * 血量不做断言：`.osr` 里的血条只有每 2 秒一个采样点、两位小数，而且解析链还没暴露它。
 */

async function expectTimelineMatches(group: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, 'stable', group, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const judgements = v1.playOsu(toOsuData(fixture))
  const frames = v1.generateFramesOsu(
    judgements,
    fixture.osuData.hp,
    fixture.scoreInfo.mods ?? [],
  )
  const last = frames.at(-1)!

  expect(last.maxCombo).toBe(fixture.scoreInfo.combo)
  expect(last.score).toBe(fixture.scoreInfo.totalScore)
}

for (const group of ['tap-only', 'hold', 'mods']) {
  describe(`osu-v1 timeline — ${group}`, () => {
    const names = fixtureNames('stable', group)

    if (names.length === 0) it.skip('缺少样本（见启动时的提示）', () => {})

    for (const fixtureName of names) {
      it(fixtureName, () => expectTimelineMatches(group, fixtureName))
    }
  })
}
