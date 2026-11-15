import { HIT_RESULTS } from '../types'
import type {
  HitResult,
  HitWindows,
  TapNote,
  HoldNote,
  Note,
  Action,
  Columns,
  OsuData,
  TapJudgement,
} from '../types'
import { truncWindows } from '../utils'
import { type HoldJudgementV2, type JudgementV2, baseWindows, tailWindows } from './types'

/**
 * lazer 的判定是**事件驱动**的：按键按下/松开各是一个事件，对象的被动漏接是另一个。
 * 这里按列维护一个按键游标，逐个物件消费按键段 —— 一个长条可以吃掉多段按键
 * （中途断开后补按），所以不能简单地「一段按键对应一个物件」。
 */

function gradeFor(delta: number, windows: HitWindows): HitResult {
  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
    if (delta <= windows[i]) {
      return i
    }
  }
  return HIT_RESULTS.Miss
}

function judgeTap(
  note: TapNote,
  actions: readonly Action[],
  startIndex: number,
  windows: HitWindows,
  nextNote: Note | undefined,
): { judgement: TapJudgement, nextIndex: number } {
  const judgement: TapJudgement = {
    note,
    enter: note.start - windows[HIT_RESULTS.Miss],
    exit: note.start + windows[HIT_RESULTS.Meh],
    action: undefined,
    result: HIT_RESULTS.Miss,
  }

  let index = startIndex
  while (index < actions.length && actions[index]!.press < judgement.enter) {
    index++
  }

  if (index < actions.length && actions[index]!.press <= judgement.exit) {
    const action = actions[index]!

    // 顺序限制：这次按键已经落在下一个物件身上了
    if (nextNote && action.press >= nextNote.start) {
      return { judgement, nextIndex: index }
    }

    judgement.exit = action.press
    judgement.action = action
    judgement.result = gradeFor(Math.abs(action.press - note.start), windows)
    index++
  }

  return { judgement, nextIndex: index }
}

/**
 * 长条：头判一次按下，尾判在「覆盖尾部的那一段按键」的松手时刻。
 *
 * 中途断开（在尾巴可判定区之前松手）记为 broken，之后补按仍然可以拿到尾巴，
 * 但尾巴结果封顶到 Meh —— 与 lazer 的 `DrawableHoldNoteTail.GetCappedResult` 一致。
 */
function judgeHold(
  note: HoldNote,
  actions: readonly Action[],
  startIndex: number,
  windows: HitWindows,
  tails: HitWindows,
  nextNote: Note | undefined,
): { judgement: HoldJudgementV2, nextIndex: number } {
  const missWindow = windows[HIT_RESULTS.Miss]
  const mehWindow = windows[HIT_RESULTS.Meh]

  const judgement: HoldJudgementV2 = {
    note,
    headEnter: note.start - missWindow,
    headExit: 0,
    tailEnter: 0,
    tailExit: 0,
    actions: [],
    headResult: HIT_RESULTS.Miss,
    tailResult: HIT_RESULTS.Miss,
  }

  let index = startIndex
  while (index < actions.length && actions[index]!.press < judgement.headEnter) {
    index++
  }

  const head = actions[index]

  /**
   * 能不能「开始这条长条」：
   * - 不能早于 head 的 Miss 窗口（`beginHoldAt` 里直接 return，不进 holding）
   * - 已经越过尾巴时，尾巴必须还处在可命中窗口内（`OnPressed` 顶部的 return false）
   * - 同列顺序限制：这一下已经属于下一个物件了
   */
  const headDeadline = Math.min(note.start + missWindow, note.end + mehWindow)

  const canStart = head !== undefined
    && !(nextNote && head.press >= nextNote.start)
    && head.press <= headDeadline

  if (!canStart) {
    judgement.headExit = note.start + mehWindow
    judgement.tailEnter = note.end + tails[HIT_RESULTS.Meh]
    judgement.tailExit = judgement.tailEnter
    return { judgement, nextIndex: index }
  }

  judgement.actions.push(head)
  judgement.headExit = head.press

  // 头判只有落在 head 的 Miss 窗口内才会落判，否则保持未判（之后按 Meh 窗口自动 miss）
  const headDelta = Math.abs(head.press - note.start)
  if (headDelta <= missWindow) {
    judgement.headResult = gradeFor(headDelta, windows)
  }

  // 从这一段开始向後找「能结算尾巴」的那一段
  const tailHit = tails[HIT_RESULTS.Miss]
  let tailRelease: number | undefined
  let broken = false
  let cursorIndex = index

  while (cursorIndex < actions.length) {
    const action = actions[cursorIndex]!

    // 尾巴已经自动漏接，后面的按键再怎么按也救不回来
    if (action.press > note.end + tailHit) {
      break
    }

    judgement.actions.push(action)

    if (action.release > note.end + tailHit) {
      // 松得太晚：尾巴在 `end + Meh` 那一刻就已经自动漏接
      cursorIndex++
      break
    }

    if (action.release >= note.end - tailHit) {
      tailRelease = action.release
      break
    }

    // 提前松手 ⇒ 断条，但之后补按仍然可以把尾巴救回来
    broken = true
    cursorIndex++
  }

  if (tailRelease === undefined) {
    judgement.tailResult = HIT_RESULTS.Miss
    judgement.tailEnter = note.end + tailHit
    judgement.tailExit = judgement.tailEnter
    return { judgement, nextIndex: cursorIndex }
  }

  judgement.tailResult = gradeFor(Math.abs(tailRelease - note.end), tails)
  judgement.tailEnter = tailRelease
  judgement.tailExit = tailRelease

  // 头 miss 或中途断开 ⇒ 尾巴最高只能到 Meh
  if ((judgement.headResult === HIT_RESULTS.Miss || broken)
    && judgement.tailResult < HIT_RESULTS.Meh) {
    judgement.tailResult = HIT_RESULTS.Meh
  }

  return { judgement, nextIndex: cursorIndex + 1 }
}

export function playColumn(
  notes: Note[],
  actions: Action[],
  windows: HitWindows,
  tails?: HitWindows,
): JudgementV2[] {
  const judgements: JudgementV2[] = []
  const tailW = tails ?? windows
  let index = 0

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!
    const nextNote = notes[i + 1]

    if (note.end === undefined) {
      const { judgement, nextIndex } = judgeTap(note, actions, index, windows, nextNote)
      judgements.push(judgement)
      index = nextIndex
    } else {
      const { judgement, nextIndex } = judgeHold(note, actions, index, windows, tailW, nextNote)
      judgements.push(judgement)
      index = nextIndex
    }
  }

  return judgements
}

export function play(
  noteColumns: Columns<Note>,
  actionColumns: Columns<Action>,
  windows: HitWindows,
  tails?: HitWindows,
): Columns<JudgementV2> {
  const judgements: Columns<JudgementV2> = []
  for (let i = 0; i < noteColumns.length; i++) {
    judgements.push(playColumn(noteColumns[i]!, actionColumns[i]!, windows, tails))
  }
  return judgements
}

export function playOsu(data: OsuData): Columns<JudgementV2> {
  const windows = truncWindows(baseWindows(data.od), data.speedRate * data.windowScale)
  return play(data.noteColumns, data.actionColumns, windows, tailWindows(windows))
}
