import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { lazer } from '../src'
import { toOsuData } from '../tests/fixture-frames'
import type { FixtureOutput } from '../tests/fixture-types'

const NAMES = ['Perfect', 'Great', 'Good', 'Ok', 'Meh', 'Miss']

const fixtureDir = process.argv[2]!
const oracleDir = process.argv[3]!

interface OracleRow {
  part: string
  column: number
  start: number
  type: string
}

let totalExp = 0
let totalDiff = 0
let cleanFiles = 0
const failures: string[] = []

const fixtureFiles = readdirSync(fixtureDir).filter(n => n.endsWith('.json')).sort()

for (const file of fixtureFiles) {
  const base = file.replace(/\.json$/, '')

  let oracle: { order: OracleRow[] }

  try {
    oracle = JSON.parse(readFileSync(path.join(oracleDir, base + '.oracle.json'), 'utf8'))
  } catch {
    continue
  }

  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')) as FixtureOutput

  const exp = new Map<string, string>()

  for (const row of oracle.order) {
    if (row.part !== 'note' && row.part !== 'head' && row.part !== 'tail') continue
    exp.set(`${row.column}@${row.start}:${row.part}`, row.type)
  }

  const got = new Map<string, string>()
  const judgements = lazer.playOsu(toOsuData(fixture))

  for (let column = 0; column < judgements.length; column++) {
    for (const judgement of judgements[column]!) {
      if ('headResult' in judgement) {
        got.set(`${judgement.note.column}@${judgement.note.start}:head`, NAMES[judgement.headResult]!)
        got.set(`${judgement.note.column}@${judgement.note.end}:tail`, NAMES[judgement.tailResult]!)
      } else {
        got.set(`${judgement.note.column}@${judgement.note.start}:note`, NAMES[judgement.result]!)
      }
    }
  }

  let diff = 0
  const samples: string[] = []

  for (const [key, value] of exp) {
    const actual = got.get(key)

    if (actual !== value) {
      if (samples.length < 6) samples.push(`${key} oracle=${value} ts=${actual}`)
      diff++
    }
  }

  let extra = 0
  for (const key of got.keys()) if (!exp.has(key)) extra++

  totalExp += exp.size
  totalDiff += diff

  if (diff === 0 && extra === 0) {
    cleanFiles++
  } else {
    failures.push(`${base.slice(0, 46)}: diff=${diff} extra=${extra} exp=${exp.size} got=${got.size}  ${samples.join(' | ')}`)
  }
}

console.log(failures.join('\n'))
console.log(`\n${cleanFiles}/${cleanFiles + failures.length} 局完全一致；总判定 ${totalExp}，差异 ${totalDiff}`)
