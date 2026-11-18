/**
 * 把一个真回放 fixture 按时间窗口切成若干「片段探针」。
 *
 * 片段只保留窗口内的物件与回放行，并把窗口起点之前最后一行的按键状态补成首行，
 * 这样片段里不会因为缺前文而改变 holding / note lock。产物可以直接丢给
 * `tools/lazer-oracle` 跑真 lazer 真值（片段很短，几秒就能跑完）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { FixtureOutput } from '../tests/fixture-types'

const LEAD_IN = 500
const TAIL_PAD = 2000

function slice(fixture: FixtureOutput, from: number, to: number): FixtureOutput {
  const { noteColumns, frames, od, hp, windowScale, speedRate } = fixture.osuData

  const noteColumnsClipped = noteColumns.map(column =>
    column.filter(note => (note.end ?? note.start) >= from - LEAD_IN && note.start <= to + LEAD_IN),
  )

  const kept = frames.filter(row => row[0] >= from - LEAD_IN && row[0] <= to + TAIL_PAD)

  // 窗口起点的按键状态：取 from-LEAD_IN 之前最后一行
  let seed = 0
  for (const row of frames) {
    if (row[0] > from - LEAD_IN) break
    seed = row[1]
  }

  const slicedFrames: [number, number][] = []
  if (kept.length === 0 || kept[0]![0] > from - LEAD_IN) slicedFrames.push([from - LEAD_IN, seed])
  for (const row of kept) slicedFrames.push([row[0], row[1]])

  return {
    ...fixture,
    scoreInfo: {
      ...fixture.scoreInfo,
      statistics: [0, 0, 0, 0, 0, 0],
    },
    osuData: {
      od,
      hp,
      windowScale,
      ...(speedRate === undefined ? {} : { speedRate }),
      noteColumns: noteColumnsClipped,
      frames: slicedFrames,
    } as FixtureOutput['osuData'],
  }
}

const [, , fixturePath, outDir, spanArg] = process.argv

if (!fixturePath || !outDir) {
  console.error('usage: probe-slice.ts <fixture.json> <outDir> [spanSeconds=30]')
  process.exit(1)
}

const span = Number(spanArg ?? 30) * 1000
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureOutput

const notes = fixture.osuData.noteColumns.flat()
const first = Math.min(...notes.map(n => n.start))
const last = Math.max(...notes.map(n => n.end ?? n.start))

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const base = path.basename(fixturePath, '.json')
let count = 0

for (let from = Math.floor(first / span) * span; from < last; from += span) {
  const to = from + span
  const probe = slice(fixture, from, to)

  const objects = probe.osuData.noteColumns.flat().length
  if (objects === 0) continue

  const name = `${base}-${String(count).padStart(3, '0')}-${Math.round(from)}-${Math.round(to)}`
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(probe))
  console.log(`${name}  objs=${objects}  frames=${probe.osuData.frames.length}`)
  count++
}
