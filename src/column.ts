import type { Action, Columns, Note } from './types'

/**
 * Extract the replay's raw frame timeline (ms, ascending, deduped).
 * osu!stable judges on these frames, so the exact settle time of every object
 * is "the first frame at or after the boundary" — not the boundary itself.
 */
export function replayToFrameTimes(
  frames: readonly { readonly time: number }[],
): number[] {
  const times: number[] = []
  for (const frame of frames) {
    const last = times[times.length - 1]
    if (last === undefined || last !== frame.time) {
      times.push(frame.time)
    }
  }
  return times
}

/**
 * Group beatmap hit objects into per-column note arrays.
 * Structurally compatible with `osu-mania-io`'s `Beatmap`.
 */
export function beatmapToNoteColumns(beatmap: {
  readonly difficulty: { readonly keyCount: number }
  readonly hitObjects: readonly {
    readonly column: number
    readonly startTime: number
    readonly endTime?: number
  }[]
}): Columns<Note> {
  const columns: Columns<Note> = Array.from({ length: beatmap.difficulty.keyCount }, () => [])

  for (const hitObject of beatmap.hitObjects) {
    columns[hitObject.column].push({
      column: hitObject.column,
      start: hitObject.startTime,
      end: hitObject.endTime,
    })
  }

  return columns
}

/**
 * Convert key-state replay frames into press/release actions.
 * Structurally compatible with `osu-mania-io`'s `ReplayFrame`.
 */
export function replayToActionColumns(
  frames: readonly {
    readonly time: number
    readonly columns: readonly boolean[]
  }[],
  keyCount: number,
): Columns<Action> {
  const columns: Columns<Action> = Array.from({ length: keyCount }, () => [])
  const lastPress: (number | null)[] = Array.from({ length: keyCount }, () => null)

  // 回放里会有负时间帧（a lead-in / 暂停），stable 是照常处理的：
  // 掉进开头的那次按下会一直算到对应音符上，丢掉它会让整列的配对错位。
  for (const frame of frames) {
    for (let col = 0; col < keyCount; col++) {
      const pressed = frame.columns[col] ?? false

      if (pressed && lastPress[col] === null) {
        lastPress[col] = frame.time
      } else if (!pressed && lastPress[col] !== null) {
        columns[col].push({ column: col, press: lastPress[col]!, release: frame.time })
        lastPress[col] = null
      }
    }
  }

  return columns
}