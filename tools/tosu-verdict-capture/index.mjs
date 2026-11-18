/**
 * 用 tosu 抓游戏内的实时判定流（用于和本库逐物件对账）。
 *
 * 用法：
 *   node tools/tosu-verdict-capture/index.mjs [输出文件] [--port 24050] [--interval 20]
 *
 * 前提：游戏与 tosu 都在运行，tosu 已连上游戏（浏览器打开 http://127.0.0.1:24050/json/v2
 * 能看到 play/beatmap 字段即可）。播完回放 / 打完图后按 Ctrl+C 落盘。
 *
 * 输出：
 *   schema        自动探测到的判定字段所在路径与字段名（用于核对映射）
 *   rawSamples[]  a few 原始 play 快照（字段名对不上时靠它定位）
 *   snapshots[]   { at, state, time, counts, combo, score, accuracy }
 *
 * 六档字段别名：geki/perfect/320、300/great、katu/good/200、100/ok、50/meh、0/miss
 */

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const outFile = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'tosu-verdict-capture.json'
const port = opt('--port', 24050)
const interval = opt('--interval', 20)
const base = `http://127.0.0.1:${port}`

const ALIASES = {
  Perfect: ['geki', 'perfect', '320', 'countPerfect', 'n320'],
  Great: ['300', 'great', 'countGreat', 'n300'],
  Good: ['katu', 'good', '200', 'countGood', 'n200'],
  Ok: ['100', 'ok', 'countOk', 'n100'],
  Meh: ['50', 'meh', 'countMeh', 'n50'],
  Miss: ['0', 'miss', 'countMiss', 'n0'],
}

const aliasOf = (key) => Object.keys(ALIASES).find(result => ALIASES[result].includes(key))

/** 在 payload 里找最像「六档计数」的对象。 */
const findHits = (root) => {
  let best

  const walk = (node, path, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return
    if (Array.isArray(node)) return

    let score = 0
    for (const key of Object.keys(node)) {
      if (aliasOf(key) && typeof node[key] === 'number') score++
    }
    if (score >= 3 && (!best || score > best.score)) best = { path, node, score }

    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, depth + 1)
  }

  walk(root, '', 0)
  return best
}

/** 找游戏内时间（ms）。 */
const findTime = (root) => {
  const time = root?.play?.time
  if (time && typeof time === 'object') return time.current ?? time.live ?? time.value
  return undefined
}

const toCounts = (node) => {
  if (!node) return undefined

  const counts = {}
  for (const [result, names] of Object.entries(ALIASES)) {
    for (const name of names) {
      if (typeof node[name] === 'number') {
        counts[result] = node[name]
        break
      }
    }
    counts[result] ??= 0
  }
  return counts
}

const snapshots = []
const rawSamples = []
let latest = {}
let last = ''
let schema

const flush = () => {
  writeFileSync(outFile, JSON.stringify({ capturedAt: new Date().toISOString(), source: `${base}/json/v2`, schema, rawSamples, final: latest, snapshots }, null, 1))
  console.log(`\n已写入 ${outFile}（快照 ${snapshots.length} 条）`)
  if (schema) console.log(`判定字段路径：${schema.path}（命中 ${schema.keys.join(',')}）`)
  else console.log('没找到判定字段 —— 请看 rawSamples 里的原始字段名')
  process.exit(0)
}
process.on('SIGINT', flush)
process.on('SIGTERM', flush)

const loop = async () => {
  for (;;) {
    try {
      const data = await (await fetch(`${base}/json/v2`)).json()
      const play = data.play ?? {}

      const hits = findHits(data)
      if (hits && !schema) {
        schema = {
          path: hits.path,
          keys: Object.keys(hits.node).filter(k => aliasOf(k) && typeof hits.node[k] === 'number'),
        }
        console.log(`判定字段：${schema.path} -> ${schema.keys.join(',')}`)
      }

      const counts = toCounts(hits?.node)
      const time = findTime(data)

      latest = {
        state: data.state?.name ?? '',
        time,
        counts,
        combo: play.combo?.current ?? play.combo?.max,
        maxCombo: play.combo?.max ?? data.resultsScreen?.maxCombo,
        score: play.score ?? data.resultsScreen?.score,
        accuracy: play.accuracy,
        beatmap: data.beatmap ? `${data.beatmap.artist} - ${data.beatmap.title} [${data.beatmap.version}]` : undefined,
      }

      // 前两条 + 进入 play 的第一条 + 结果屏第一条，留原始字段用于排错
      if (rawSamples.length < 4
        && (snapshots.length < 2 || (latest.state === 'play' && !rawSamples.some(s => s.state === 'play')) || (latest.state === 'resultScreen' && !rawSamples.some(s => s.state === 'resultScreen')))) {
        rawSamples.push({ at: new Date().toISOString(), state: latest.state, topKeys: Object.keys(data), play, resultsScreen: data.resultsScreen })
      }

      const key = JSON.stringify([latest.state, latest.time, latest.counts, latest.score])
      if (key !== last) {
        last = key
        snapshots.push({ at: new Date().toISOString(), ...latest })
        const c = counts
        console.log(
          String(latest.state).padEnd(12),
          `t=${time ?? '-'}`.padEnd(12),
          c ? `P${c.Perfect} G${c.Great} Gd${c.Good} O${c.Ok} M${c.Meh} X${c.Miss}` : '-',
          latest.combo !== undefined ? `combo ${latest.combo}` : '',
        )
      }
    } catch {
      // tosu 还没起来，或这一拍没读到
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}

console.log(`监听 ${base}，回放/游玩结束后按 Ctrl+C 落盘到 ${outFile}`)
await loop()
