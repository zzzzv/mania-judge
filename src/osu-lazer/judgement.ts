import { HIT_RESULTS } from '../types'
import type {
  Action,
  Columns,
  Frame,
  HitResult,
  HitWindows,
  Note,
  OsuData,
  TapJudgement,
} from '../types'
import { truncWindows } from '../utils'
import { type HoldJudgementV2, type JudgementV2, baseWindows, tailWindows } from './types'

/**
 * lazer 的 mania 判定是**帧驱动**的：`FrameStabilityContainer` 会把时钟钉在回放帧时间上，
 * 一帧一行、每行推进一次。判定语义则散在几处 UI 代码里：
 *
 * - 一次按下会沿同列物件**逐个传播**（`DrawableNote.OnPressed` / `DrawableHoldNote.OnPressed`），
 *   直到某个物件真的吃下这次按下才停；
 * - 传播中已判完 / `CheckHittable` 失败的物件是**透明**的（返回 false），不消费按键；
 * - 命中任一物件会级联把同列更早的未判物件强制 miss（`OrderedHitPolicy.HandleHit`）；
 * - 松手是**广播**：同列所有处于 holding 的长条都会各自结算尾巴；
 * - 长条 holding 由 `HoldNoteJudgementResult` 的上报栈决定，中途重按会重新上报 holding；
 * - 漏接用 `HitWindows.CanBeHit`（Meh 窗）；窗口是 `floor(DR(OD) * m) + 0.5`，
 *   尾巴再乘 `RELEASE_WINDOW_LENIENCE`。
 *
 * tick 内顺序：**到期漏接 → 按下 → 松手**。到期用严格小于（同一时刻的按下先于漏接，
 * 与 lazer 一帧内的「输入先于 Update」一致）。
 */

const RELEASE_WINDOW_LENIENCE = 1.5

/** Miss 结果的淡出时长，淡出期间物件仍留在 `AliveObjects` 里（`DrawableManiaHitObject`）。 */
const MISS_FADE_OUT = 150



/** 官方 `HitWindows.ResultFor`：按 |offset| 从 Perfect 往 Miss 逐档试，闭区间。 */
function resultFor(delta: number, windows: HitWindows): HitResult | undefined {
  const offset = Math.abs(delta)

  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
    if (offset <= windows[i]) {
      return i
    }
  }

  return undefined
}

/** 官方 `HitWindows.CanBeHit`：只要还没越过 Meh 窗就还有机会。 */
function canBeHit(delta: number, windows: HitWindows): boolean {
  return delta <= windows[HIT_RESULTS.Meh]
}

/** mania 里 `HitResult.IsHit` 等价于「不是 Miss」。 */
function isHit(result: HitResult | undefined): boolean {
  return result !== undefined && result !== HIT_RESULTS.Miss
}

interface HoldReport {
  time: number
  holding: boolean
}

interface SimObject {
  note: Note

  // tap
  tap?: HitResult
  tapTime?: number
  tapAction?: Action

  // hold
  head?: HitResult
  tail?: HitResult
  headTime?: number
  tailTime?: number
  bodyJudged: boolean
  bodyBroken: boolean
  /** body 落地（`Body.TriggerResult`）的时刻；破条就是 `ComboBreak` 的时刻 */
  bodyTime?: number
  reports: HoldReport[]
  actions: Action[]

  /** 输入顺序（输出按它还原） */
  originalIndex: number
}

/** 等价 `DrawableHitObject.AllJudged`：这个物件和所有 nested 都判完了。 */
function isDone(obj: SimObject): boolean {
  if (obj.note.end === undefined) return obj.tap !== undefined
  return obj.head !== undefined && obj.tail !== undefined && obj.bodyJudged
}

/** 单列判定状态机。 */
class ColumnSimulation {
  private readonly objects: SimObject[]
  private readonly windows: HitWindows
  private readonly tailWindows: HitWindows
  private readonly mehWindow: number
  private readonly missWindow: number
  private readonly tailMehWindow: number
  private readonly column: number

  /** 上一帧这一列是否按下 */
  private held = false
  /** 当前这次按下的区间（松开时回填 release） */
  private openAction: Action | undefined
  /** 第一个还没判完的物件下标（判完的物件对后续所有逻辑都无影响，可直接跳过） */
  private cursor = 0

  constructor(notes: readonly Note[], windows: HitWindows, tails?: HitWindows) {
    this.windows = windows
    this.tailWindows = tails ?? (windows.map(w => w * RELEASE_WINDOW_LENIENCE) as HitWindows)
    this.mehWindow = windows[HIT_RESULTS.Meh]
    this.missWindow = windows[HIT_RESULTS.Miss]
    this.tailMehWindow = this.tailWindows[HIT_RESULTS.Meh]
    this.column = notes[0]?.column ?? 0

    // 判定按 start 升序推进；输出按输入顺序还原
    const ordered = notes
      .map((note, index) => ({ note, index }))
      .sort((left, right) => left.note.start - right.note.start)

    this.objects = ordered.map(({ note, index }) => ({
      note,
      bodyJudged: false,
      bodyBroken: false,
      reports: [],
      actions: [],
      originalIndex: index,
    }))
  }

  // ── holding 上报栈（官方 HoldNoteJudgementResult） ──────────────────

  private lastReport(obj: SimObject, time: number): HoldReport | undefined {
    let found: HoldReport | undefined

    for (const report of obj.reports) {
      if (report.time > time) break
      found = report
    }

    return found
  }

  private isHolding(obj: SimObject, time: number): boolean {
    return this.lastReport(obj, time)?.holding === true
  }

  private reportHoldState(obj: SimObject, time: number, holding: boolean): void {
    if (this.lastReport(obj, time)?.holding === holding) return
    obj.reports.push({ time, holding })
  }

  // ── 结算 ────────────────────────────────────────────────────────────

  /**
   * body 落地（`Body.TriggerResult(Tail.IsHit)`）。
   *
   * 两条路径：
   *   - 尾巴判完（命中或漏接）时跟着落地 —— `force = false`，尾巴还没判就不动；
   *   - **松手**时立刻落地 —— `force = true`。此时尾巴若还不是命中，就走
   *     `ApplyMinResult()` ⇒ `HoldNoteBodyJudgement.MinResult = ComboBreak`，
   *     也就是说「松手这一下就断连击」，之后重新按住也不会撤销。
   */
  private settleBody(obj: SimObject, time: number, force = false): void {
    if (obj.bodyJudged) return
    if (obj.tail === undefined && !force) return

    obj.bodyJudged = true
    obj.bodyBroken = !isHit(obj.tail)
    obj.bodyTime = time
  }

  /** 跳过已经判完的物件（O(1) 摊还）。 */
  private advanceCursor(): void {
    while (this.cursor < this.objects.length && isDone(this.objects[this.cursor]!)) this.cursor++
  }

  /** `OrderedHitPolicy.HandleHit`：把同列更早的未判物件全部强制 miss。 */
  private handleHit(targetTime: number, time: number): void {
    for (let i = this.cursor; i < this.objects.length; i++) {
      const obj = this.objects[i]!
      const end = obj.note.end ?? obj.note.start
      if (end >= targetTime) break
      if (isDone(obj)) continue

      const { note } = obj

      if (note.end === undefined) {
        if (obj.tap === undefined) {
          obj.tap = HIT_RESULTS.Miss
          obj.tapTime = time
        }
      } else {
        if (obj.head === undefined) {
          obj.head = HIT_RESULTS.Miss
          obj.headTime = time
        }
        if (obj.tail === undefined) {
          obj.tail = HIT_RESULTS.Miss
          obj.tailTime = time
        }

        // 父长条 MissForcefully ⇒ ReportHoldState(false)
        this.reportHoldState(obj, time, false)
        this.settleBody(obj, time)
      }
    }
  }

  // ── note lock ──────────────────────────────────────────────────────

  /**
   * 物件在 `HitObjectContainer.AliveObjects` 里存活到什么时候。
   *
   * 判完之后还要等淡出结束才会被移出容器：Miss 淡出 150ms，命中是瞬时。
   * 这段时间里它仍然会挡住同列前一个物件的 note lock。
   */
  private aliveUntil(obj: SimObject): number {
    const { note } = obj

    if (note.end === undefined) {
      if (obj.tap === undefined) return Number.POSITIVE_INFINITY
      return (obj.tapTime ?? note.start) + (isHit(obj.tap) ? 0 : MISS_FADE_OUT)
    }

    if (obj.tail === undefined) return Number.POSITIVE_INFINITY
    return (obj.tailTime ?? note.end) + (isHit(obj.tail) ? 0 : MISS_FADE_OUT)
  }

  private isHittable(index: number, time: number): boolean {
    for (let i = index + 1; i < this.objects.length; i++) {
      const next = this.objects[i]!

      // 已经消亡的物件不在 AliveObjects 里，GetNext 会跳过它
      if (time >= this.aliveUntil(next)) continue

      return time < next.note.start
    }

    return true
  }

  // ── 按下 ────────────────────────────────────────────────────────────

  private pressObject(obj: SimObject, time: number, action: Action): boolean {
    const { note } = obj

    if (note.end === undefined) {
      // DrawableNote.OnPressed → UpdateResult(true)
      if (obj.tap !== undefined) return false

      const result = resultFor(time - note.start, this.windows)
      if (result === undefined) return false

      obj.tap = result
      obj.tapTime = time
      obj.tapAction = action

      if (isHit(result)) this.handleHit(note.start, time)

      return true
    }

    // DrawableHoldNote.OnPressed
    if (isDone(obj)) return false

    // 已越过尾巴、且尾巴连 Meh 窗都过了 ⇒ 连 holding 都不许开
    if (time > note.end && !canBeHit(time - note.end, this.tailWindows)) return false

    // beginHoldAt
    if (time - note.start >= -this.missWindow) {
      this.reportHoldState(obj, time, true)
      obj.actions.push(action)
    }

    if (obj.head !== undefined) return false

    const result = resultFor(time - note.start, this.windows)
    if (result === undefined) return false

    obj.head = result
    obj.headTime = time

    if (isHit(result)) this.handleHit(note.start, time)

    return true
  }

  private onPress(time: number): void {
    const action: Action = { column: this.column, press: time, release: Number.POSITIVE_INFINITY }
    this.openAction = action

    for (let i = this.cursor; i < this.objects.length; i++) {
      if (!this.isHittable(i, time)) continue
      if (this.pressObject(this.objects[i]!, time, action)) return
    }
  }

  // ── 松手 ────────────────────────────────────────────────────────────

  private onRelease(time: number): void {
    const action = this.openAction

    if (action) {
      action.release = time
      this.openAction = undefined
    }

    for (let i = this.cursor; i < this.objects.length; i++) {
      const obj = this.objects[i]!
      const { note } = obj

      // 还没进入判定窗的物件不可能处于 holding 状态
      if (note.start > time + this.missWindow) break

      if (note.end === undefined) continue
      if (isDone(obj)) continue
      if (!this.isHolding(obj, time)) continue

      if (action && obj.actions[obj.actions.length - 1] !== action) obj.actions.push(action)

      if (obj.tail === undefined) {
        // 官方只走 `HitWindows.ResultFor(timeOffset / 1.5)`：
        // 落在 (Meh, Miss] 区间会直接判成 Miss 并吃掉这次松手，而不是留着等漏接。
        const result = resultFor(time - note.end, this.tailWindows)

        if (result !== undefined) {
          // GetCappedResult：头没中或已经断条 ⇒ 最高只到 Meh
          obj.tail = result < HIT_RESULTS.Meh && (!isHit(obj.head) || obj.bodyBroken)
            ? HIT_RESULTS.Meh
            : result
          obj.tailTime = time
        }
      }

      // Body.TriggerResult(Tail.IsHit)：松手即结算，尾巴还没判也算破条
      this.settleBody(obj, time, true)

      this.reportHoldState(obj, time, false)
    }
  }

  // ── 被动漏接（每帧的 UpdateResult(false)） ──────────────────────────

  private autoMiss(time: number, final = false): void {
    const start = final ? 0 : this.cursor

    for (let i = start; i < this.objects.length; i++) {
      const obj = this.objects[i]!
      const { note } = obj

      // 物件按 start 升序：起点还在这帧之后的不可能有任何部分到期
      if (!final && note.start > time) break

      if (note.end === undefined) {
        if (obj.tap !== undefined) continue

        const deadline = note.start + this.mehWindow

        if (final || time > deadline) {
          obj.tap = HIT_RESULTS.Miss
          obj.tapTime = final ? deadline : time
        }

        continue
      }

      if (obj.head === undefined) {
        const deadline = note.start + this.mehWindow

        if (final || time > deadline) {
          obj.head = HIT_RESULTS.Miss
          obj.headTime = final ? deadline : time
        }
      }

      if (obj.tail === undefined) {
        const deadline = note.end + this.tailMehWindow

        if (final || time > deadline) {
          obj.tail = HIT_RESULTS.Miss
          obj.tailTime = final ? deadline : time
        }
      }

      this.settleBody(obj, obj.tailTime ?? time)
    }
  }

  // ── 推进一帧 ────────────────────────────────────────────────────────

  advance(time: number, held: boolean): void {
    this.advanceCursor()

    // tick 内顺序：先 `UpdateAfterChildren` 的自动漏接，再派发输入。
    // 也就是说按键落在刚过 deadline 的那一帧时，物件已经被判成漏接了，按键会穿透到
    // 下一个物件 —— 这与真实回放（60fps 级 tick 网格）的统计结果一致。
    this.autoMiss(time)

    if (held && !this.held) this.onPress(time)
    if (!held && this.held) this.onRelease(time)

    this.held = held
  }

  /** 收尾：剩下还没落地的全部按漏接结算。 */
  collect(): JudgementV2[] {
    this.autoMiss(Number.POSITIVE_INFINITY, true)

    const judgements: JudgementV2[] = new Array(this.objects.length)

    for (const obj of this.objects) {
      const { note } = obj

      if (note.end === undefined) {
        const judgement: TapJudgement = {
          note,
          enter: note.start - this.missWindow,
          exit: obj.tapTime ?? note.start + this.mehWindow,
          action: obj.tapAction,
          result: obj.tap ?? HIT_RESULTS.Miss,
        }

        judgements[obj.originalIndex] = judgement
        continue
      }

      const judgement: HoldJudgementV2 = {
        note,
        headEnter: note.start - this.missWindow,
        headExit: obj.headTime ?? note.start + this.mehWindow,
        tailEnter: obj.tailTime ?? note.end + this.tailMehWindow,
        tailExit: obj.tailTime ?? note.end + this.tailMehWindow,
        actions: obj.actions,
        headResult: obj.head ?? HIT_RESULTS.Miss,
        tailResult: obj.tail ?? HIT_RESULTS.Miss,
        breakTime: obj.bodyBroken ? obj.bodyTime : undefined,
      }

      judgements[obj.originalIndex] = judgement
    }

    return judgements
  }
}

/**
 * 精确模式：单列重演 lazer 的 mania 判定状态机。
 *
 * `frames` 是回放原始行表（升序，一行一次推进）；判定时钟就是行时间。
 */
export function playColumnFrames(
  notes: readonly Note[],
  column: number,
  windows: HitWindows,
  frames: readonly Frame[],
  tails?: HitWindows,
): JudgementV2[] {
  const simulation = new ColumnSimulation(notes, windows, tails)

  for (const frame of frames) {
    simulation.advance(frame.time, frame.columns[column] ?? false)
  }

  return simulation.collect()
}

/** 精确模式：按回放行表逐帧推进所有列（列之间完全独立）。 */
export function playFrames(
  noteColumns: Columns<Note>,
  windows: HitWindows,
  frames: readonly Frame[],
  tails?: HitWindows,
): Columns<JudgementV2> {
  const simulations = noteColumns.map(notes => new ColumnSimulation(notes, windows, tails))

  for (const frame of frames) {
    const { time, columns } = frame

    for (let column = 0; column < simulations.length; column++) {
      simulations[column]!.advance(time, columns[column] ?? false)
    }
  }

  return simulations.map(simulation => simulation.collect())
}

export function playOsu(data: OsuData): Columns<JudgementV2> {
  const windows = truncWindows(baseWindows(data.od), data.speedRate * data.windowScale)
  return playFrames(data.noteColumns, windows, data.frames, tailWindows(windows))
}
