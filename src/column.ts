import type { Action, Columns, Note } from './types'

export function createActionCursor(actions: Action[]) {
  let index = 0
  let time = Number.MIN_SAFE_INTEGER
  let holdingAction: Action | null = null

  return {
    get time() {
      return time
    },
    setNextTime(nextTime: number) {
      if (nextTime > time) {
        time = nextTime
        while (index < actions.length && actions[index].release < time) {
          index++
        }
        if (index < actions.length && actions[index].press < time) {
          holdingAction = actions[index++]
        } else {
          holdingAction = null
        }
      }
    },
    getHoldingAction() {
      return holdingAction
    },
    getNextAction() {
      if (index < actions.length) {
        return actions[index]
      }
      return null
    },
  }
}

export type ActionCursor = ReturnType<typeof createActionCursor>

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

  for (const frame of frames) {
    if (frame.time < 0) continue

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