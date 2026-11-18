import type { Columns, Note } from './types'

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
