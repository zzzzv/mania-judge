import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFromPath } from '../src/osu-parsers/node'
import { parseWithMods } from '../src/osu-parsers/shared'

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures/files')
const fixtureNames = ['sparkle', '7kreg8st', '7kreg7j'] as const

const countObjects = <T>(columns: T[][]) => columns.reduce((total, column) => total + column.length, 0)

describe('osu-parsers', () => {
  it.each(fixtureNames)('shared/%s parses fixture', async (fixtureName) => {
    const [beatmapContent, replayBuffer] = await Promise.all([
      readFile(path.join(fixturesDir, `${fixtureName}.osu`), 'utf8'),
      readFile(path.join(fixturesDir, `${fixtureName}.osr`)),
    ])

    const result = await parseWithMods(beatmapContent, replayBuffer)

    expect(result.rawScore.replay).toBeDefined()
    expect(result.rawBeatmap.totalColumns).toBeGreaterThan(0)
    expect(result.osuData.noteColumns).toHaveLength(result.rawBeatmap.totalColumns)
    expect(result.osuData.actionColumns).toHaveLength(result.rawBeatmap.totalColumns)
    expect(countObjects(result.osuData.noteColumns)).toBeGreaterThan(0)
    expect(countObjects(result.osuData.actionColumns)).toBeGreaterThan(0)
    expect(result.osuData.od).toBeGreaterThan(0)
    expect(result.osuData.hp).toBeGreaterThan(0)
  })

  it.each(fixtureNames)('node/%s matches shared parser', async (fixtureName) => {
    const beatmapPath = path.join(fixturesDir, `${fixtureName}.osu`)
    const replayPath = path.join(fixturesDir, `${fixtureName}.osr`)

    const [beatmapContent, replayBuffer, fromPath] = await Promise.all([
      readFile(beatmapPath, 'utf8'),
      readFile(replayPath),
      parseFromPath(beatmapPath, replayPath),
    ])

    const fromShared = await parseWithMods(beatmapContent, replayBuffer)

    expect(fromPath.osuData).toEqual(fromShared.osuData)
    expect(fromPath.rawBeatmap.totalColumns).toBe(fromShared.rawBeatmap.totalColumns)
    expect(fromPath.rawScore.info.totalScore).toBe(fromShared.rawScore.info.totalScore)
  })
})