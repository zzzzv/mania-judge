import { HIT_RESULTS } from '../types'
import type {
  HitWindows,
  TapNote,
  HoldNote,
  Note,
  Action,
  Columns,
  OsuData,
  TapJudgement,
} from '../types'
import { type ActionCursor, createActionCursor } from '../column'
import { truncWindows } from '../utils'
import { type HoldJudgementV2, type JudgementV2, baseWindows, tailWindows } from './types'

function judgeTap(
  note: TapNote,
  cursor: ActionCursor,
  windows: HitWindows,
  nextNote: Note | undefined,
): TapJudgement {
  const judgement: TapJudgement = {
    note,
    enter: Math.max(note.start - windows[HIT_RESULTS.Miss], cursor.time),
    exit: note.start + windows[HIT_RESULTS.Meh],
    action: undefined,
    result: HIT_RESULTS.Miss,
  }

  while (cursor.getNextAction() && cursor.getNextAction()!.press < judgement.enter) {
    cursor.setNextTime(cursor.getNextAction()!.press + 1)
  }

  if (cursor.getNextAction() && cursor.getNextAction()!.press <= judgement.exit) {
    const action = cursor.getNextAction()!

    // Note lock: if the next note's start has passed, this action is for it
    if (nextNote && action.press >= nextNote.start) {
      cursor.setNextTime(action.press)
      return judgement
    }

    judgement.exit = action.press
    judgement.action = action
    cursor.setNextTime(action.press + 1)

    const delta = Math.abs(action.press - note.start)
    for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
      if (delta <= windows[i]) {
        judgement.result = i
        break
      }
    }
  } else {
    cursor.setNextTime(judgement.exit)
  }

  return judgement
}

// ── Hold judgement (lazer-style) ─────────────────────────────────────

function judgeHold(
  note: HoldNote,
  cursor: ActionCursor,
  windows: HitWindows,
  tailWindows: HitWindows,
  nextNote: Note | undefined,
): HoldJudgementV2 {
  const missWindow = windows[HIT_RESULTS.Miss]
  const mehWindow = windows[HIT_RESULTS.Meh]

  // The head action must be found within the head's miss window.
  // Additionally, lazer blocks starting a hold if past tail.start+MehWindow
  // (the tail's OnPressed check: Time.Current > Tail.StartTime && !CanBeHit).
  const headEnter = Math.max(note.start - missWindow, cursor.time)
  const headLateDeadline = Math.min(
    note.start + missWindow,
    note.end + mehWindow,
  )

  const judgement: HoldJudgementV2 = {
    note,
    headEnter: headEnter,
    headExit: 0,
    tailEnter: 0,
    tailExit: 0,
    actions: [],
    headResult: HIT_RESULTS.Miss,
    tailResult: HIT_RESULTS.Miss,
  }

  // Skip actions before the head's enter window
  while (cursor.getNextAction() && cursor.getNextAction()!.press < headEnter) {
    cursor.setNextTime(cursor.getNextAction()!.press + 1)
  }

  if (!cursor.getNextAction() || cursor.getNextAction()!.press > headLateDeadline) {
    // No usable action → full miss at the miss deadline
    const autoMissTime = Math.min(note.start + mehWindow, note.end + mehWindow)
    judgement.headExit = autoMissTime
    judgement.tailEnter = autoMissTime
    judgement.tailExit = autoMissTime
    cursor.setNextTime(autoMissTime)
    return judgement
  }

  const action = cursor.getNextAction()!

  // Note lock: if the next note's start has passed, this action is for it.
  if (nextNote && action.press >= nextNote.start) {
    cursor.setNextTime(action.press)
    return judgement
  }

  judgement.actions.push(action)

  // ── Head result (press timing, base windows) ────────────────
  const headDelta = Math.abs(action.press - note.start)
  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
    if (headDelta <= windows[i]) {
      judgement.headResult = i
      break
    }
  }
  judgement.headExit = action.press

  // ── Tail result (release timing, 1.5× expanded windows) ────
  // Use pre-computed tailWindows that match lazer's effective bounds.
  const absTailDelta = Math.abs(action.release - note.end)

  if (absTailDelta > tailWindows[HIT_RESULTS.Miss]) {
    // Release outside the expanded miss window → auto-miss
    judgement.tailResult = HIT_RESULTS.Miss
    const missThreshold = Math.ceil(tailWindows[HIT_RESULTS.Miss])
    judgement.tailEnter = action.release > note.end
      ? note.end + missThreshold
      : note.end - missThreshold
    judgement.tailExit = judgement.tailEnter
  } else {
    for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
      if (absTailDelta <= tailWindows[i]) {
        judgement.tailResult = i
        break
      }
    }
    judgement.tailEnter = action.release
    judgement.tailExit = action.release
  }

  // ── Tail capping (DrawableHoldNoteTail.GetCappedResult) ─────
  if (judgement.headResult === HIT_RESULTS.Miss && judgement.tailResult < HIT_RESULTS.Meh) {
    judgement.tailResult = HIT_RESULTS.Meh
  }

  // ── Body break ──────────────────────────────────────────────
  if (judgement.tailResult === HIT_RESULTS.Miss) {
    judgement.breakTime = judgement.tailEnter
  }

  cursor.setNextTime(action.release + 1)
  return judgement
}

// ── Column & full play ───────────────────────────────────────────────

export function playColumn(
  notes: Note[],
  actions: Action[],
  windows: HitWindows,
  tailWindows?: HitWindows,
): JudgementV2[] {
  const judgements: JudgementV2[] = []
  const cursor = createActionCursor(actions)

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    const nextNote = notes[i + 1]
    if (note.end === undefined) {
      judgements.push(judgeTap(note, cursor, windows, nextNote))
    } else {
      judgements.push(judgeHold(note, cursor, windows, tailWindows!, nextNote))
    }
  }

  return judgements
}

export function play(
  noteColumns: Columns<Note>,
  actionColumns: Columns<Action>,
  windows: HitWindows,
  tailWindows?: HitWindows,
): Columns<JudgementV2> {
  const judgements: Columns<JudgementV2> = []
  for (let i = 0; i < noteColumns.length; i++) {
    judgements.push(playColumn(noteColumns[i], actionColumns[i], windows, tailWindows))
  }
  return judgements
}

export function playOsu(data: OsuData): Columns<JudgementV2> {
  const windows = truncWindows(baseWindows(data.od), data.speedRate * data.windowScale)
  const tailW = tailWindows(windows)
  return play(data.noteColumns, data.actionColumns, windows, tailW)
}
