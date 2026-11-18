import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lazer } from '../src'
import { toOsuData } from './fixture-frames'
import { fixtureNames, fixturesRoot } from './fixtures'
import type { FixtureOutput } from './fixture-types'

/**
 * lazer timeline 层测试：断言 combo 与标准分。
 *
 * `.osr` 抬头对 lazer 来说只是冒烟门禁（判定本身就有漂移，见 `doc/osu-lazer.md`），
 * 失败用例当已知差异清单读。
 * 标准分真正的精确真值只有游戏内复现那一组，见文件末尾的 tosu 用例。
 *
 * 血量不做断言：`.osr` 里虽然有血条，但只有每 2 秒一个采样点、两位小数，而且本地分数索引
 * 没有把它导出（`lifeFrames` 恒为空）。
 */

async function expectTimelineMatches(dirName: string, fixtureName: string) {
  const content = await readFile(path.join(fixturesRoot, 'lazer', dirName, fixtureName), 'utf8')
  const fixture = JSON.parse(content) as FixtureOutput
  const data = toOsuData(fixture)
  const frames = lazer.generateFramesOsu(
    lazer.playOsu(data),
    data.hp,
    fixture.scoreInfo.mods ?? [],
  )
  const last = frames.at(-1)!

  expect(last.maxCombo).toBe(fixture.scoreInfo.combo)
  expect(last.score).toBe(fixture.scoreInfo.totalScore)
}

for (const group of ['tap-only', 'hold', 'mods']) {
  describe(`osu-lazer timeline — ${group}`, () => {
    const names = fixtureNames('lazer', group)

    if (names.length === 0) it.skip('缺少样本（见启动时的提示）', () => {})

    for (const fixtureName of names) {
      it(fixtureName, () => expectTimelineMatches(group, fixtureName))
    }
  })
}

// ── 游戏内复核（tosu 抓的实时计数） ──────────────────────────────────

interface TosuCounts {
  Perfect: number
  Great: number
  Good: number
  Ok: number
  Meh: number
  Miss: number
}

interface TosuSnapshot {
  state: string
  counts: TosuCounts
  score: number
}

/** 判定已经稳定、连击序列与游戏一致的区间上限（见 doc/osu-lazer.md）。 */
const VERIFIED_JUDGEMENTS = 400

const tosuPath = path.resolve(import.meta.dirname, 'fixtures/tosu/piscord-2026-11-18.json')
const tosuFixture = path.join(fixturesRoot, 'lazer/hold/PISSCORD-Why not-96.45.json')

describe.skipIf(!existsSync(tosuPath) || !existsSync(tosuFixture))('osu-lazer timeline — 游戏内复核', () => {
  it('标准分与游戏内复现逐点相等', async () => {
    const fixture = JSON.parse(await readFile(tosuFixture, 'utf8')) as FixtureOutput
    const capture = JSON.parse(await readFile(tosuPath, 'utf8')) as { snapshots: TosuSnapshot[] }

    const data = toOsuData(fixture)
    const frames = lazer.generateFramesOsu(lazer.playOsu(data), data.hp)

    // 按「已判条数」对齐
    const scoreAt = new Map<number, number>()
    for (const frame of frames) {
      const judged = frame.resultCounts.reduce((sum, count) => sum + count, 0)
      scoreAt.set(judged, frame.score!)
    }

    let compared = 0

    for (const snapshot of capture.snapshots) {
      if (snapshot.state !== 'play') continue

      const judged = Object.values(snapshot.counts).reduce((sum, count) => sum + count, 0)
      if (judged === 0 || judged > VERIFIED_JUDGEMENTS) continue

      const score = scoreAt.get(judged)
      if (score === undefined) continue

      compared++
      expect(score).toBe(snapshot.score)
    }

    // 防止采样文件变动后这个用例变成空断言
    expect(compared).toBeGreaterThan(50)
  })
})
