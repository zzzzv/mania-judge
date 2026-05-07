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
  HoldJudgementV1,
  JudgementV1,
  HitResultTable,
} from '../types'
import { type ActionCursor, createActionCursor } from '../column'
import { truncWindows } from '../extensions'

export const accTable: Readonly<HitResultTable<number>> = [1.0, 1.0, 2 / 3, 1 / 3, 1 / 6, 0.0]

export function baseWindows(od: number): HitWindows {
  return [
    16,
    64 - 3 * od,
    97 - 3 * od,
    127 - 3 * od,
    151 - 3 * od,
    188 - 3 * od,
  ]
}

function judgeTap(
  note: TapNote,
  cursor: ActionCursor,
  windows: HitWindows
): TapJudgement {
  const judgement: TapJudgement = {
    note,
    enter: Math.max(note.start - windows[HIT_RESULTS.Miss], cursor.time),
    exit: note.start + windows[HIT_RESULTS.Ok],
    actions: [],
    result: HIT_RESULTS.Miss,
  }

  while (cursor.getNextAction() && cursor.getNextAction()!.press < judgement.enter) {
    cursor.setNextTime(cursor.getNextAction()!.press + 1)
  }

  if (cursor.getNextAction() && cursor.getNextAction()!.press < judgement.exit) {
    const action = cursor.getNextAction()!

    judgement.exit = action.press
    judgement.actions.push(action)
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

  cursor.setNextTime(judgement.note.start)
  return judgement
}

function generateTick(hold: HoldNote, action: Action): number[] {
  const tickInterval = 100
  const ticks: number[] = []
  const first = action.press + tickInterval
  const stop = Math.min(action.release, hold.end)

  for (let t = first; t < stop; t += tickInterval) {
    ticks.push(t)
  }

  return ticks
}

function judgeHold(
  note: HoldNote,
  cursor: ActionCursor,
  windows: HitWindows,
  nextNote: Note | undefined,
): HoldJudgementV1 {
  const judgement: HoldJudgementV1 = {
    note,
    enter: Math.max(note.start - windows[HIT_RESULTS.Miss], cursor.time),
    exit: note.end + windows[HIT_RESULTS.Ok],
    actions: [],
    result: HIT_RESULTS.Miss,
    ticks: [],
  }

  const factors = [1.2, 1.1, 1.0, 1.0, 1.0, 1.0]

  while (cursor.getNextAction() && cursor.getNextAction()!.press < judgement.enter) {
    cursor.setNextTime(cursor.getNextAction()!.release + 1)
  }

  while (cursor.getNextAction() && cursor.getNextAction()!.release < note.end - windows[HIT_RESULTS.Meh]) {
    const action = cursor.getNextAction()!
    judgement.actions.push(action)
    cursor.setNextTime(action.release + 1)

    if (judgement.breakTime === undefined) {
      judgement.breakTime = action.release
      judgement.ticks = generateTick(note, action)
    }
  }

  if (cursor.getNextAction() && cursor.getNextAction()!.press >= judgement.exit) {
    cursor.setNextTime(judgement.exit)
    return judgement
  }

  if (cursor.getNextAction()) {
    const action = cursor.getNextAction()!

    if (
      nextNote &&
      nextNote.end !== undefined &&
      action.press > note.start + windows[HIT_RESULTS.Meh] &&
      action.press >= nextNote.start - windows[HIT_RESULTS.Miss]
    ) {
      judgement.exit = action.press
      cursor.setNextTime(action.press)
      return judgement
    }

    judgement.actions.push(action)

    let press = action.press
    let release = action.release

    if (action.press < note.start - windows[HIT_RESULTS.Meh]) {
      press = note.end - 1
    }

    if (action.release >= note.end + windows[HIT_RESULTS.Meh]) {
      release = note.end + windows[HIT_RESULTS.Meh]
    }
    
    cursor.setNextTime(release + 1)

    const headDelta = Math.abs(press - note.start)
    const tailDelta = Math.abs(release - note.end)

    for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Ok; i++) {
      const window = windows[i] * factors[i]
      if (headDelta <= window && headDelta + tailDelta <= window * 2) {
        judgement.result = i
        break
      }
    }

    if (judgement.result === HIT_RESULTS.Miss) {
      judgement.result = HIT_RESULTS.Meh
    }

    if (judgement.result <= HIT_RESULTS.Great && judgement.breakTime !== undefined) {
      judgement.result = HIT_RESULTS.Good
    }

    if (judgement.breakTime === undefined) {
      judgement.ticks = generateTick(note, action)
    }
    
    judgement.exit = release
  }

  cursor.setNextTime(note.end)
  return judgement
}

export function playColumn(notes: Note[], actions: Action[], windows: HitWindows): JudgementV1[] {
  const judgements: JudgementV1[] = []
  const cursor = createActionCursor(actions)

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    const nextNote = notes[i + 1]

    if (note.end === undefined) {
      judgements.push(judgeTap(note, cursor, windows))
    } else {
      judgements.push(judgeHold(note, cursor, windows, nextNote))
    }
  }

  return judgements
}

export function play(
  noteColumns: Columns<Note>,
  actionColumns: Columns<Action>,
  windows: HitWindows,
): Columns<JudgementV1> {
  const judgements: Columns<JudgementV1> = []
  for (let i = 0; i < noteColumns.length; i++) {
    judgements.push(playColumn(noteColumns[i], actionColumns[i], windows))
  }
  return judgements
}

export function playOsu(data: OsuData): Columns<JudgementV1> {
  const windows = truncWindows(baseWindows(data.od), data.windowScale)
  return play(data.noteColumns, data.actionColumns, windows)
}