import { HIT_RESULTS } from '../types'
import type {
  Columns,
  HitResult,
  HitResultTable,
  JudgementV1,
  TimeLineFrame,
} from '../types'
import { compareJudgements, isHoldJudgement } from '../extensions'
import { clamp } from '../utils'

import { computeHpMultiplierNormal, createLifeTable } from './health'

interface TimeLineEvent {
  time: number
  judgement: JudgementV1
  result: HitResult
  affectsResultCounts: boolean
}

function createEvents(judgement: JudgementV1): TimeLineEvent[] {
  const events: TimeLineEvent[] = [{
    time: judgement.exit,
    judgement,
    result: judgement.result,
    affectsResultCounts: true,
  }]

  if (isHoldJudgement(judgement)) {
    for (const tick of judgement.ticks) {
      events.push({
        time: tick,
        judgement,
        result: HIT_RESULTS.Great,
        affectsResultCounts: false,
      })
    }
  }

  return events
}

function compareEvents(left: TimeLineEvent, right: TimeLineEvent): number {
  if (left.time !== right.time) {
    return left.time - right.time
  }

  return compareJudgements(left.judgement, right.judgement)
}

export function generateFrames(
  judgementColumns: Columns<JudgementV1>,
  lifeTable: HitResultTable<number>,
): TimeLineFrame[] {
  const sorted = judgementColumns.flat().flatMap(createEvents).sort(compareEvents)
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

    if (event.result < HIT_RESULTS.Miss) {
      last.combo++
      if (last.combo > last.maxCombo) {
        last.maxCombo = last.combo
      }
    } else {
      last.combo = 0
    }

    if (event.affectsResultCounts) {
      last.resultCounts[event.result]++
    }

    last.life += lifeTable[event.result]
    last.life = clamp(last.life, 0, 1)

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
    })
  }

  return frames
}

export function generateFramesOsu(
  judgementColumns: Columns<JudgementV1>,
  hp: number,
): TimeLineFrame[] {
  const hpMultiplierNormal = computeHpMultiplierNormal(judgementColumns, hp)
  return generateFrames(judgementColumns, createLifeTable(hp, hpMultiplierNormal))
}