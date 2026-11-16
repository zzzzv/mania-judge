import { HIT_RESULTS } from '../types'
import type {
  Action,
  Columns,
  HitResult,
  HitWindows,
  HoldNote,
  Note,
  OsuData,
  TapJudgement,
  TapNote,
} from '../types'
import { baseWindows } from './types'
import type { HoldJudgementV1, JudgementV1 } from './types'

/** 长条体中每 100ms 一个 tick（只加 combo，不加判定） */
const LN_TICK_MS = 100

interface NoteState {
  note: Note
  start: number
  end: number
  isHold: boolean
  isJudged: boolean
  judgement: HitResult
  isHeld: boolean
  pressTime: number
  pressRecorded: boolean
  releaseTime: number
  releaseRecorded: boolean
  headJudged: boolean
  wasBroken: boolean
  isDimmed: boolean
  lastTick: number
  ticks: number[]
  actions: Action[]
  enter: number
  exit: number
  breakTime: number | undefined
  /** 每次提前松手都记一次（重新按下后再次提前松手会再重置连击） */
  breakTimes: number[]
  breakRecorded: boolean
  /** 首次「变暗」的时刻：之后这条长条已经不可能再被按下，stable 就是在这时判的漏接 */
  dimTime: number | undefined
  current: Action | undefined
  originalIndex: number
}

interface ColumnRuntime {
  windows: HitWindows
  w50: number
  w100: number
  early: number
  held: boolean
  wasHeld: boolean
  consumed: boolean
  cursor: number
  lastJudgedStart: number
}

function gradeBy(error: number, windows: HitWindows): HitResult {
  const delta = Math.abs(error)
  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Meh; i++) {
    if (delta <= windows[i]) {
      return i as HitResult
    }
  }
  return HIT_RESULTS.Miss
}

/** 第一个 `>= time` 的帧时刻；传空表时退化成边界本身 */
function resolveBoundary(time: number, frameTimes: readonly number[] | undefined): number {
  if (!frameTimes || frameTimes.length === 0) {
    return time
  }

  let lo = 0
  let hi = frameTimes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frameTimes[mid]! < time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  return lo < frameTimes.length ? frameTimes[lo]! : Number.POSITIVE_INFINITY
}

/** 第一个 `release > time` 的动作下标 */
function firstActionAfter(actions: readonly Action[], time: number): number {
  let lo = 0
  let hi = actions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (actions[mid]!.release <= time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * 关键帧：stable 的判定只在「按键边沿」和「物件边界落到的那一帧」上推进，
 * 所以按列把这些时刻收集起来逐帧重演，等价于全帧扫描但只跑必要帧。
 */
function collectKeyFrames(
  notes: readonly Note[],
  actions: readonly Action[],
  windows: HitWindows,
  frameTimes: readonly number[] | undefined,
): number[] {
  const frames = new Set<number>()
  const w50 = windows[HIT_RESULTS.Meh]
  const w100 = windows[HIT_RESULTS.Ok]
  const early = windows[HIT_RESULTS.Miss]

  for (const action of actions) {
    frames.add(action.press)
    frames.add(action.release)
  }

  for (const note of notes) {
    const end = note.end ?? note.start
    for (const boundary of [
      note.start - early,
      note.start + w50,
      // 变暗（dim）在 `now > start + W50` 的第一个帧生效，之后未按住的物件不再自动结算
      note.start + w50 + 1,
      end - w50,
      end + w50,
      end + w100,
    ]) {
      const frame = resolveBoundary(boundary, frameTimes)
      if (Number.isFinite(frame)) {
        frames.add(frame)
      }
    }

    if (note.end === undefined) {
      continue
    }

    // tick 从「按下时刻」起每 100ms 一次，按区间逐个推
    for (let i = firstActionAfter(actions, note.start); i < actions.length; i++) {
      const action = actions[i]!
      if (action.press >= note.end) {
        break
      }
      const stop = Math.min(action.release, note.end)
      for (let time = action.press + LN_TICK_MS; time <= stop; time += LN_TICK_MS) {
        // 网格点落在 start 之前时（提前按下的长条），tick 实际发生在
        // 「不早于 start 的第一帧」：此时最后一个 tick 时刻还没前进，
        // 该帧一到就满足 now - lastTick >= 100。只按 press + 100k 取帧会漏掉它。
        const frame = resolveBoundary(Math.max(time, note.start), frameTimes)
        if (Number.isFinite(frame)) {
          frames.add(frame)
        }
      }
    }
  }

  return [...frames].sort((left, right) => left - right)
}

function dimCheck(state: NoteState, now: number, runtime: ColumnRuntime): void {
  if (state.isJudged && state.judgement === HIT_RESULTS.Miss) {
    state.isDimmed = true
  } else if (state.isHeld) {
    state.isDimmed = false
  } else if (now <= state.start + runtime.w50) {
    state.isDimmed = false
  } else {
    state.isDimmed = !state.isJudged
    if (state.isDimmed && state.dimTime === undefined) {
      state.dimTime = now
    }
  }
}

function judgeTapState(state: NoteState, now: number, runtime: ColumnRuntime): void {
  if (state.isJudged) {
    return
  }

  state.isJudged = true
  runtime.lastJudgedStart = Math.max(runtime.lastJudgedStart, state.start)
  state.judgement = state.isHeld
    ? gradeBy(state.pressTime - state.start, runtime.windows)
    : HIT_RESULTS.Miss
  state.exit = now
}

/** V1 的合并口径：头尾误差各自镜像后再按「头 ≤ 窗×1.2、合并 ≤ 窗×2.4」降档 */
function v1HoldGrade(state: NoteState, now: number, runtime: ColumnRuntime): HitResult {
  const { start, end } = state
  const press = state.pressTime

  let effectiveStart: number
  if (press < start - runtime.w50) {
    effectiveStart = end - 1
  } else if (press < start) {
    effectiveStart = start + (start - press)
  } else {
    effectiveStart = press
  }

  let effectiveEnd: number
  if (state.isHeld) {
    effectiveEnd = now
  } else if (state.releaseTime > end) {
    effectiveEnd = end - (state.releaseTime - end)
  } else {
    effectiveEnd = state.releaseTime
  }

  const headError = Math.abs(effectiveStart - start)
  const tailError = Math.abs(effectiveEnd - end)
  const combined = headError + tailError

  let grade: HitResult
  if (effectiveEnd < end - runtime.w50) {
    grade = HIT_RESULTS.Miss
  } else {
    grade = HIT_RESULTS.Meh
    const table: [HitResult, number, number][] = [
      [HIT_RESULTS.Perfect, 1.2, 2.4],
      [HIT_RESULTS.Great, 1.1, 2.2],
      [HIT_RESULTS.Good, 1, 2],
      [HIT_RESULTS.Ok, 1, 2],
    ]
    for (const [result, headMultiplier, combinedMultiplier] of table) {
      if (
        headError <= runtime.windows[result] * headMultiplier
        && combined <= runtime.windows[result] * combinedMultiplier
      ) {
        grade = result
        break
      }
    }
  }

  if (state.wasBroken && grade < HIT_RESULTS.Good) {
    grade = HIT_RESULTS.Good
  }

  return grade
}

function judgeHoldState(
  state: NoteState,
  now: number,
  runtime: ColumnRuntime,
): 'judged' | 'break' | 'wait' {
  state.lastTick = -1
  dimCheck(state, now, runtime)

  if (state.isJudged) {
    return 'judged'
  }

  if (now < state.start + runtime.w50 && !state.pressRecorded) {
    return 'wait'
  }

  if (now < state.end - runtime.w50) {
    if (state.isHeld) {
      return 'wait'
    }
    state.wasBroken = true
    // 同一次按下期间只记一次 break（同一帧内每次重判都会返回 break，但连击已归零）
    if (!state.breakRecorded) {
      state.breakRecorded = true
      state.breakTimes.push(now)
      if (state.breakTime === undefined) {
        state.breakTime = now
      }
    }
    return 'break'
  }

  if (now < state.end + runtime.w50 && state.isHeld) {
    return 'wait'
  }

  state.isJudged = true
  runtime.lastJudgedStart = Math.max(runtime.lastJudgedStart, state.start)
  state.judgement = v1HoldGrade(state, now, runtime)
  state.exit = now
  return 'judged'
}

function expire(state: NoteState, now: number, runtime: ColumnRuntime): boolean {
  if (now < state.end + runtime.w100) {
    return false
  }

  if (!state.isJudged) {
    if (state.isHold) {
      judgeHoldState(state, now, runtime)
    } else {
      judgeTapState(state, now, runtime)
    }
    return true
  }

  return false
}

function tickNote(state: NoteState, now: number, runtime: ColumnRuntime): void {
  if (runtime.consumed) {
    return
  }

  if (now < state.start - runtime.early) {
    return
  }

  if (expire(state, now, runtime)) {
    return
  }

  const { held, wasHeld } = runtime

  if (held && !wasHeld) {
    if (!state.isHold) {
      state.isHeld = true
      state.pressTime = now
      state.pressRecorded = true
      state.current = { column: state.note.column, press: now, release: Number.POSITIVE_INFINITY }
      state.actions.push(state.current)
      runtime.consumed = true
      judgeTapState(state, now, runtime)
      return
    }

    if (state.isHeld) {
      return
    }

    state.pressTime = now
    state.pressRecorded = true
    state.current = { column: state.note.column, press: now, release: Number.POSITIVE_INFINITY }
    state.actions.push(state.current)
    runtime.consumed = true
    state.isHeld = true
    state.headJudged = true
    state.lastTick = state.pressTime
    // 重新按下后，下一次提前松手要再次触发 break（stable 每帧都会重判，松开即重置连击）
    state.breakRecorded = false
    return
  }

  if (held && wasHeld) {
    if (!state.isHold || !state.isHeld) {
      return
    }
    runtime.consumed = true

    if (state.lastTick !== -1 && state.start <= now && now <= state.end) {
      if (now - state.lastTick >= LN_TICK_MS) {
        state.lastTick += LN_TICK_MS
        state.ticks.push(now)
      }
    }
    return
  }

  if (held) {
    return
  }

  if (!state.isHold) {
    return
  }

  if (!state.isHeld) {
    if (!state.isDimmed) {
      judgeHoldState(state, now, runtime)
    }
    return
  }

  state.isHeld = false
  state.releaseTime = now
  state.releaseRecorded = true
  if (state.current) {
    state.current.release = now
    state.current = undefined
  }
  judgeHoldState(state, now, runtime)
}

function tickColumn(now: number, states: readonly NoteState[], runtime: ColumnRuntime): void {
  if (runtime.lastJudgedStart > now) {
    runtime.consumed = true
    return
  }

  let index = runtime.cursor
  while (index < states.length) {
    const state = states[index]!

    if (state.isJudged) {
      if (state.start > now) {
        runtime.consumed = true
      }
      index++
      continue
    }

    if (runtime.consumed) {
      break
    }

    if (now < state.start - runtime.early) {
      break
    }

    tickNote(state, now, runtime)
    index++
  }

  while (runtime.cursor < states.length && states[runtime.cursor]!.isJudged) {
    runtime.cursor++
  }
}

function settle(states: readonly NoteState[], runtime: ColumnRuntime): void {
  const pending = states.filter((state) => !state.isJudged)
  pending.sort((left, right) => left.end + runtime.w100 - (right.end + runtime.w100))

  runtime.wasHeld = runtime.held

  for (const state of pending) {
    if (state.isJudged) {
      continue
    }

    const when = Math.max(
      state.end + runtime.w100,
      state.end + runtime.w50 + 1,
      state.start + runtime.w50 + 1,
    )

    if (state.isHold) {
      judgeHoldState(state, when, runtime)
    } else {
      judgeTapState(state, when, runtime)
    }

    if (!state.isJudged) {
      state.isJudged = true
      state.judgement = HIT_RESULTS.Miss
      state.exit = when
    }

    // 结算阶段补判的漏接，对 stable 来说早在「变暗」那一刻就已经结束了，
    // 判定时刻回填过去，否则 combo 断点会全部挤到回放结尾。
    if (state.judgement === HIT_RESULTS.Miss && state.dimTime !== undefined) {
      state.exit = state.dimTime
    }
  }
}

function createState(note: Note, originalIndex: number, runtime: ColumnRuntime): NoteState {
  const isHold = note.end !== undefined
  return {
    note,
    start: note.start,
    end: note.end ?? note.start,
    isHold,
    isJudged: false,
    judgement: HIT_RESULTS.Miss,
    isHeld: false,
    pressTime: 0,
    pressRecorded: false,
    releaseTime: 0,
    releaseRecorded: false,
    headJudged: false,
    wasBroken: false,
    isDimmed: false,
    lastTick: -1,
    ticks: [],
    actions: [],
    enter: note.start - runtime.early,
    exit: (note.end ?? note.start) + runtime.w100,
    breakTime: undefined,
    breakTimes: [],
    breakRecorded: false,
    dimTime: undefined,
    current: undefined,
    originalIndex,
  }
}

/**
 * 精确模式：按列重演 stable 的 mania 判定状态机。
 *
 * `frameTimes` 是回放原始帧时间（升序）。判定里所有「当前时刻」都取
 * 「不早于边界的第一帧」，这样事件驱动和 stable 的逐帧扫描等价。
 * 不传时退化成用边界本身当时刻（只适合做近似估计）。
 */
export function playColumnFrames(
  notes: readonly Note[],
  actions: readonly Action[],
  windows: HitWindows,
  frameTimes: readonly number[],
): JudgementV1[] {
  const runtime: ColumnRuntime = {
    windows,
    w50: windows[HIT_RESULTS.Meh],
    w100: windows[HIT_RESULTS.Ok],
    early: windows[HIT_RESULTS.Miss],
    held: false,
    wasHeld: false,
    consumed: false,
    cursor: 0,
    lastJudgedStart: -1e9,
  }

  const states = notes.map((note, index) => createState(note, index, runtime))
  const ordered = states.slice().sort((left, right) => left.start - right.start)
  const keyFrames = collectKeyFrames(notes, actions, windows, frameTimes)

  let actionIndex = 0
  let previousHeld = false

  for (const now of keyFrames) {
    while (actionIndex < actions.length && actions[actionIndex]!.release <= now) {
      actionIndex++
    }
    const held = actionIndex < actions.length && actions[actionIndex]!.press <= now

    runtime.wasHeld = previousHeld
    runtime.held = held
    runtime.consumed = false

    tickColumn(now, ordered, runtime)
    previousHeld = held
  }

  settle(ordered, runtime)

  const judgements: JudgementV1[] = new Array(states.length)
  for (const state of states) {
    if (state.isHold) {
      const hold: HoldJudgementV1 = {
        note: state.note as HoldNote,
        enter: state.enter,
        exit: state.exit,
        actions: state.actions,
        result: state.judgement,
        breakTime: state.breakTime,
        breakTimes: state.breakTimes,
        ticks: state.ticks,
      }
      judgements[state.originalIndex] = hold
    } else {
      const tap: TapJudgement = {
        note: state.note as TapNote,
        enter: state.enter,
        exit: state.exit,
        action: state.current,
        result: state.judgement,
      }
      judgements[state.originalIndex] = tap
    }
  }

  return judgements
}

export function playFrames(
  noteColumns: Columns<Note>,
  actionColumns: Columns<Action>,
  windows: HitWindows,
  frameTimes: readonly number[],
): Columns<JudgementV1> {
  const judgements: Columns<JudgementV1> = []
  for (let column = 0; column < noteColumns.length; column++) {
    judgements.push(
      playColumnFrames(
        noteColumns[column] ?? [],
        actionColumns[column] ?? [],
        windows,
        frameTimes,
      ),
    )
  }
  return judgements
}

export function playOsuFrames(data: OsuData): Columns<JudgementV1> {
  // stable 的窗口取整（向下），缩放之后同样取整
  const windows = truncateWindows(baseWindows(data.od), data.speedRate * data.windowScale)
  return playFrames(data.noteColumns, data.actionColumns, windows, data.frameTimes)
}

function truncateWindows(windows: HitWindows, scale: number): HitWindows {
  const result: HitWindows = [...windows]
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.trunc(result[i]! * scale + 1e-6)
  }
  return result
}
