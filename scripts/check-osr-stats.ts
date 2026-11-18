/**
 * 整谱冒烟门禁：拿本库的 lazer 判定 / 时间轴结果，对照 fixture 里 `.osr` 抬头存的统计。
 *
 * 用法：
 *   node --import tsx scripts/check-osr-stats.ts [组名=tap-only|hold|mods] [--verbose] [--timeline]
 *
 * 两个层级：
 *   - 判定层：六档计数与 accuracy；
 *   - 时间轴层（`--timeline`）：maxCombo 与标准分。
 *
 * 注意口径：`.osr` 抬头记的是**当初游玩**那一刻的判定，而且可能是旧版客户端算的。
 * lazer 播同一份回放会按当前代码重新判定，两者不保证逐条相同（详 `doc/osu-lazer.md`）。
 * 所以这里的偏差是「与本库无关的历史差异」，只能当冒烟门禁；
 * 精确对账请用片段 oracle（`scripts/probe-slice.ts` + `scripts/compare-oracle.ts`）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { lazer, calcAccuracy, type HitResultTable } from '../src'
import { toOsuData } from '../tests/fixture-frames'
import type { FixtureOutput } from '../tests/fixture-types'

const NAMES = ['Perfect', 'Great', 'Good', 'Ok', 'Meh', 'Miss'] as const

const argv = process.argv.slice(2)
const group = argv.find(a => !a.startsWith('-')) ?? 'tap-only'
const verbose = argv.includes('--verbose')
const timeline = argv.includes('--timeline')
const root = path.resolve(import.meta.dirname, '../tests/fixtures/lazer', group)

interface Row {
  name: string
  counts: number[]
  want: number[]
  delta: number[]
  absDelta: number
  accDelta: number
  total: number
  /** 时间轴层 */
  maxCombo: number
  wantMaxCombo: number
  score: number
  wantScore: number
  mods: string[]
}

const rows: Row[] = []

for (const name of readdirSync(root).filter(n => n.endsWith('.json')).sort()) {
  const fixture = JSON.parse(readFileSync(path.join(root, name), 'utf8')) as FixtureOutput
  const data = toOsuData(fixture)
  const judgements = lazer.playOsu(data)
  const counts = lazer.countResults(judgements.flat())
  const want = [...fixture.scoreInfo.statistics]
  const delta = counts.map((value, index) => value - want[index]!)
  const mods = fixture.scoreInfo.mods ?? []
  const last = lazer.generateFramesOsu(judgements, data.hp, mods).at(-1)!

  rows.push({
    name,
    counts,
    want,
    delta,
    absDelta: delta.reduce((sum, value) => sum + Math.abs(value), 0),
    accDelta: Math.abs(
      calcAccuracy(counts as HitResultTable<number>, lazer.accTable)
      - calcAccuracy(want as HitResultTable<number>, lazer.accTable),
    ),
    total: counts.reduce((sum, value) => sum + value, 0),
    maxCombo: last.maxCombo,
    wantMaxCombo: fixture.scoreInfo.combo,
    score: last.score!,
    wantScore: fixture.scoreInfo.totalScore,
    mods,
  })
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

const pass = rows.filter(row => row.absDelta === 0).length
const totalJudgements = rows.reduce((sum, row) => sum + row.total, 0)
const totalAbsDelta = rows.reduce((sum, row) => sum + row.absDelta, 0)
const accDeltas = rows.map(row => row.accDelta * 100)

const bucketSums = NAMES.map((_, index) => rows.reduce((sum, row) => sum + row.delta[index]!, 0))
const bucketAbs = NAMES.map((_, index) => rows.reduce((sum, row) => sum + Math.abs(row.delta[index]!), 0))

console.log(`\n组：${group}（${rows.length} 局，共 ${totalJudgements} 条判定）`)
console.log(`六档完全一致：${pass}/${rows.length}`)
console.log(`偏差总数    ：${totalAbsDelta} 条（${((totalAbsDelta / totalJudgements) * 100).toFixed(4)}%）`)
console.log(
  `acc 偏差    ：中位 ${quantile(accDeltas, 0.5).toFixed(4)}%  `
  + `均值 ${mean(accDeltas).toFixed(4)}%  `
  + `最大 ${Math.max(...accDeltas).toFixed(4)}%`,
)
console.log(`分档（ΣΔ / Σ|Δ|）：${NAMES.map((name, index) => `${name} ${bucketSums[index]! >= 0 ? '+' : ''}${bucketSums[index]}/${bucketAbs[index]}`).join('  ')}`)

if (timeline) {
  const comboPass = rows.filter(row => row.maxCombo === row.wantMaxCombo).length
  const comboDeltas = rows.map(row => Math.abs(row.maxCombo - row.wantMaxCombo))
  const scorePass = rows.filter(row => row.score === row.wantScore).length
  const scoreDeltas = rows.map(row => row.score - row.wantScore)

  console.log(`\n时间轴（vs .osr，score 已含 mod 倍率）`)
  console.log(`maxCombo 完全一致：${comboPass}/${rows.length}`)
  console.log(
    `maxCombo 偏差    ：|Δ| 中位 ${quantile(comboDeltas, 0.5)}  `
    + `均值 ${mean(comboDeltas).toFixed(1)}  `
    + `最大 ${Math.max(...comboDeltas)}`,
  )
  console.log(`score 完全一致   ：${scorePass}/${rows.length}`)
  console.log(
    `score 偏差       ：中位 ${quantile(scoreDeltas, 0.5)}  `
    + `均值 ${Math.round(mean(scoreDeltas))}  `
    + `|Δ| 最大 ${Math.max(...scoreDeltas.map(Math.abs))}`,
  )
}

if (verbose) {
  console.log('\n逐局：')

  for (const row of [...rows].sort((a, b) => b.absDelta - a.absDelta || Math.abs(b.score - b.wantScore) - Math.abs(a.score - a.wantScore))) {
    if (row.absDelta === 0 && !verbose) continue
    console.log(
      `  ${row.name.slice(0, 46).padEnd(48)} |Δ|=${String(row.absDelta).padStart(3)}  `
      + `acc ${(row.accDelta * 100).toFixed(4)}%  Δ ${row.delta.join(' ')}  `
      + `combo ${row.maxCombo}/${row.wantMaxCombo}  score ${row.score}/${row.wantScore} (${row.score - row.wantScore})`,
    )
  }
}
