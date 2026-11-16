/**
 * 用 tosu 抓 osu!stable 播放回放时的实时判定（用于和本库逐档对账）。
 *
 * 用法：
 *   node tools/tosu-verdict-capture/index.mjs [输出文件] [--port 24050] [--interval 60]
 *
 * 前提：osu!stable 与 tosu 都在运行，且 tosu 能读到游戏内存（权限一致）。
 * 播完回放按 Ctrl+C 落盘；输出的 snapshots 是每次判定/连击变化时的快照，
 * final 是最后一次读到的状态（回到选歌界面后会被清零，因此对账取 snapshots 里计数最大的那条）。
 *
 * 六档映射（osu!stable 内存里的 hits 字段 → mania 判定）：
 *   geki = MAX(320)、300 = 300、katu = 200、100 = 100、50 = 50、0 = MISS
 */

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const outFile = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'tosu-verdict-capture.json'
const port = opt('--port', 24050)
const interval = opt('--interval', 60)
const base = `http://127.0.0.1:${port}`

const toCounts = (hits) => {
  if (!hits) return undefined
  return {
    MAX: hits.geki ?? 0,
    300: hits['300'] ?? 0,
    200: hits.katu ?? 0,
    100: hits['100'] ?? 0,
    50: hits['50'] ?? 0,
    MISS: hits['0'] ?? 0,
  }
}

const snapshots = []
let latest = {}
let last = ''

const flush = () => {
  writeFileSync(outFile, JSON.stringify({
    capturedAt: new Date().toISOString(),
    source: `${base}/json/v2`,
    final: latest,
    snapshots,
  }, null, 1))
  console.log(`\n已写入 ${outFile}（快照 ${snapshots.length} 条）`)
  process.exit(0)
}
process.on('SIGINT', flush)
process.on('SIGTERM', flush)

const loop = async () => {
  for (;;) {
    try {
      const data = await (await fetch(`${base}/json/v2`)).json()
      const state = data.state?.name ?? ''
      const counts = toCounts(data.play?.hits) ?? toCounts(data.resultsScreen?.hits)
      latest = {
        state,
        counts,
        combo: data.play?.combo ?? (data.resultsScreen ? { max: data.resultsScreen.maxCombo } : undefined),
        accuracy: data.play?.accuracy,
        score: data.play?.score ?? data.resultsScreen?.score,
        beatmap: data.beatmap ? `${data.beatmap.artist} - ${data.beatmap.title} [${data.beatmap.version}]` : undefined,
      }
      const key = JSON.stringify(latest)
      if (key !== last) {
        last = key
        snapshots.push({ at: new Date().toISOString(), ...latest })
        const c = counts
        console.log(
          state.padEnd(14),
          c ? `MAX ${c.MAX} 300 ${c['300']} 200 ${c['200']} 100 ${c['100']} 50 ${c['50']} MISS ${c.MISS}` : '-',
          latest.combo ? `combo ${latest.combo.current ?? ''}/${latest.combo.max ?? ''}` : '',
        )
      }
    } catch {
      // tosu 还没起来，或这一拍没读到
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}

console.log(`监听 ${base}，播完回放后按 Ctrl+C 落盘到 ${outFile}`)
await loop()
