import { HIT_RESULTS } from '../types'
import type { Columns, HitResult, HitResultTable, TimeLineFrame } from '../types'
import type { JudgementV1 } from './types'
import { isHoldJudgement } from './types'
import { clamp } from '../utils'

import { computeHpMultiplierNormal, createLifeTable } from './health'
import { createScoreAccumulator, type ScoreEventKind } from './score'

interface TimeLineEvent {
  time: number
  kind: ScoreEventKind
  judgement: JudgementV1
  result: HitResult
}

/**
 * 一个物件在时间轴上最多留下三类事件：
 *   - `tick`：长条体内的 100ms 节拍，只加连击与分数相位，不进档位计数、不改血量
 *   - `break`：提前松手，清空连击（不写判定）
 *   - `judge`：最终判定
 */
function createEvents(judgement: JudgementV1): TimeLineEvent[] {
  const events: TimeLineEvent[] = []

  if (isHoldJudgement(judgement)) {
    for (const tick of judgement.ticks) {
      events.push({ time: tick, kind: 'tick', judgement, result: HIT_RESULTS.Great })
    }

    if (judgement.breakTime !== undefined) {
      events.push({
        time: judgement.breakTime,
        kind: 'break',
        judgement,
        result: HIT_RESULTS.Miss,
      })
    }
  }

  events.push({
    time: judgement.exit,
    kind: 'judge',
    judgement,
    result: judgement.result,
  })

  return events
}

function compareEvents(left: TimeLineEvent, right: TimeLineEvent): number {
  if (left.time !== right.time) {
    return left.time - right.time
  }

  // 同一时间戳：先按判定产生顺序（exit），再按列
  const a = left.judgement
  const b = right.judgement
  if (a.exit !== b.exit) return a.exit - b.exit
  if (a.note.column !== b.note.column) return a.note.column - b.note.column
  return a.note.start - b.note.start
}

export function generateFrames(
  judgementColumns: Columns<JudgementV1>,
  lifeTable: HitResultTable<number>,
  mods: readonly string[] = [],
): TimeLineFrame[] {
  const judgements = judgementColumns.flat()
  const sorted = judgements.flatMap(createEvents).sort(compareEvents)
  const score = createScoreAccumulator(judgements.length, mods)

  const frames: TimeLineFrame[] = []
  const last = {
    time: 0,
    combo: 0,
    maxCombo: 0,
    resultCounts: [0, 0, 0, 0, 0, 0] as HitResultTable<number>,
    life: 1,
  }

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i]

    last.time = event.time
    score.push(event.kind, event.result)

    // 连击：tick 也算 +1；break 与 miss 清零
    const resets = event.kind === 'break'
      || (event.kind === 'judge' && event.result === HIT_RESULTS.Miss)
    if (resets) {
      last.combo = 0
    } else {
      last.combo++
      if (last.combo > last.maxCombo) {
        last.maxCombo = last.combo
      }
    }

    if (event.kind === 'judge') {
      last.resultCounts[event.result]++
    }

    // 血量：长条体里的 tick 按 300 回血（stable 的 ManiaHealthProcessor 如此），
    // 提前松手本身不改血量
    if (event.kind !== 'break') {
      last.life = clamp(last.life + lifeTable[event.result], 0, 1)
    }

    const nextEvent = sorted[i + 1]
    if (nextEvent?.time === event.time) {
      continue
    }

    frames.push({
      time: last.time,
      combo: last.combo,
      maxCombo: last.maxCombo,
      resultCounts: [...last.resultCounts],
      life: last.life,
      score: score.score,
    })
  }

  return frames
}

export function generateFramesOsu(
  judgementColumns: Columns<JudgementV1>,
  hp: number,
  mods: readonly string[] = [],
): TimeLineFrame[] {
  const hpMultiplierNormal = computeHpMultiplierNormal(judgementColumns, hp)
  return generateFrames(judgementColumns, createLifeTable(hp, hpMultiplierNormal), mods)
}
