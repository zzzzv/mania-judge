import { HIT_RESULTS } from '../types'
import type { HitResult } from '../types'
import type { HoldJudgementV2, JudgementV2 } from './types'

/**
 * 时间轴 / 分数共享的事件模型。
 *
 * 一个物件最多留下三类事件：
 *   - `judge`（头、尾、tap 各一条）：进六档计数、加连击、回血、加分
 *   - `break`：长条 body 的 `ComboBreak`（`HoldNoteBodyJudgement.MinResult`），
 *     只清连击 —— 不进计数、不回血、不加分
 *
 * lazer 没有 tick 事件，也没有「命中但断条」之外的清零来源。
 */
export type ScoreEventKind = 'judge' | 'break'

export interface TimeLineEvent {
  time: number
  kind: ScoreEventKind
  judgement: JudgementV2
  result: HitResult
  /** 长条的头部 / 尾部：血量上的 Miss 惩罚只有 tap 的一半 */
  isHoldPart: boolean
}

export function createEvents(judgement: JudgementV2): TimeLineEvent[] {
  if (!('headResult' in judgement)) {
    return [{
      time: judgement.exit,
      kind: 'judge',
      judgement,
      result: judgement.result,
      isHoldPart: false,
    }]
  }

  const events: TimeLineEvent[] = [
    {
      time: judgement.headExit,
      kind: 'judge',
      judgement,
      result: judgement.headResult,
      isHoldPart: true,
    },
    {
      time: judgement.tailEnter,
      kind: 'judge',
      judgement,
      result: judgement.tailResult,
      isHoldPart: true,
    },
  ]

  const breakTime = (judgement as HoldJudgementV2).breakTime

  if (breakTime !== undefined) {
    events.push({
      time: breakTime,
      kind: 'break',
      judgement,
      result: HIT_RESULTS.Miss,
      isHoldPart: false,
    })
  }

  return events
}

export function compareEvents(left: TimeLineEvent, right: TimeLineEvent): number {
  if (left.time !== right.time) return left.time - right.time

  // 同一时间戳按列从左到右（`Column` 自左向右收输入），再按物件起点。
  const a = left.judgement
  const b = right.judgement

  if (a.note.column !== b.note.column) return a.note.column - b.note.column
  return a.note.start - b.note.start
}

export function buildEvents(judgements: readonly JudgementV2[]): TimeLineEvent[] {
  return judgements.flatMap(createEvents).sort(compareEvents)
}
