import { readFile } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import { GameplayModes, Mods } from 'osu-stable-db'
import { getConfiguredOsuFolder } from 'osu-stable-db/node'
import type { BeatmapScoreMatch, BeatmapScoreQuery } from 'osu-stable-db/node'

import { v1, calcAccuracy, beatmapToNoteColumns, replayToActionColumns } from '../src'
import { formatJson, pathExists } from './utils'
import type { FixtureOutput } from './fixture-types'
import {
  CONDITION_GROUPS,
  validateConditions,
  createOutputFileName,
} from './shared'
import type { QueryCondition } from './shared'

import type { HitResultTable } from '../src/types'

const MOD_ACRONYMS: [number, string][] = [
  [Mods.NoFail, 'NF'],
  [Mods.Easy, 'EZ'],
  [Mods.TouchDevice, 'TD'],
  [Mods.Hidden, 'HD'],
  [Mods.HardRock, 'HR'],
  [Mods.SuddenDeath, 'SD'],
  [Mods.DoubleTime, 'DT'],
  [Mods.HalfTime, 'HT'],
  [Mods.Nightcore, 'NC'],
  [Mods.Flashlight, 'FL'],
  [Mods.FadeIn, 'FI'],
  [Mods.Random, 'RD'],
  [Mods.Key4, '4K'],
  [Mods.Key5, '5K'],
  [Mods.Key6, '6K'],
  [Mods.Key7, '7K'],
  [Mods.Key8, '8K'],
  [Mods.Key9, '9K'],
  [Mods.Key1, '1K'],
  [Mods.Key2, '2K'],
  [Mods.Key3, '3K'],
  [Mods.KeyCoop, 'CO'],
  [Mods.Perfect, 'PF'],
  [Mods.ScoreV2, 'SV2'],
  [Mods.Mirror, 'MR'],
]

const getScoreMods = (scoreMods: number) => {
  if (scoreMods === Mods.None) {
    return ['NM']
  }

  const acronyms: string[] = []
  for (const [modBit, acronym] of MOD_ACRONYMS) {
    if ((scoreMods & modBit) !== modBit) {
      continue
    }

    if (modBit === Mods.DoubleTime && (scoreMods & Mods.Nightcore) === Mods.Nightcore) {
      continue
    }

    if (modBit === Mods.SuddenDeath && (scoreMods & Mods.Perfect) === Mods.Perfect) {
      continue
    }

    acronyms.push(acronym)
  }

  return acronyms
}

const createScoreStatistics = (
  score: BeatmapScoreMatch['score'],
): HitResultTable<number> => {
  return [
    score.countGeki,
    score.count300,
    score.countKatu,
    score.count100,
    score.count50,
    score.countMiss,
  ]
}

const getScoreAccuracy = (
  score: BeatmapScoreMatch['score'],
) => {
  return calcAccuracy(createScoreStatistics(score), [...v1.accTable] as HitResultTable<number>)
}

const getBeatmapHoldRatio = (beatmap: BeatmapScoreMatch['beatmap']) => {
  const totalNotes = beatmap.hitCircleCount + beatmap.sliderCount + beatmap.spinnerCount
  return totalNotes > 0 ? beatmap.sliderCount / totalNotes : 0
}

const hasMatchingMods = (scoreMods: string[], expectedMods: string[]) => {
  return scoreMods.length === expectedMods.length && expectedMods.every((mod) => scoreMods.includes(mod))
}

const matchesCondition = (
  match: BeatmapScoreMatch,
  condition: QueryCondition,
) => {
  const holdRatio = getBeatmapHoldRatio(match.beatmap)
  const accuracy = getScoreAccuracy(match.score)
  const scoreMods = getScoreMods(match.score.mods)
  const [minHoldRatio, maxHoldRatio] = condition.holdRatioRange
  const [minAccuracy, maxAccuracy] = condition.accuracyRange

  return holdRatio >= minHoldRatio
    && holdRatio <= maxHoldRatio
    && accuracy >= minAccuracy
    && accuracy <= maxAccuracy
    && hasMatchingMods(scoreMods, condition.mods)
}

const querySourcePaths = async (
  query: BeatmapScoreQuery,
  conditions: QueryCondition[],
): Promise<[string, string][]> => {
  validateConditions(conditions)

  const counts = conditions.map(() => 0)
  const results: [string, string][] = []
  const matches = [...query.iterateBeatmapScores()].sort((left, right) => {
    const leftTimestamp = Number(left.score.replayTimestamp)
    const rightTimestamp = Number(right.score.replayTimestamp)

    if (leftTimestamp === rightTimestamp) {
      return 0
    }

    return leftTimestamp > rightTimestamp ? -1 : 1
  })

  for (const match of matches) {
    const { beatmap, score } = match

    if (beatmap.gameplayMode !== GameplayModes.Mania) {
      continue
    }

    if (score.gameplayMode !== GameplayModes.Mania) {
      continue
    }

    const conditionIndex = conditions.findIndex((condition, index) => {
      return counts[index] < condition.count && matchesCondition(match, condition)
    })

    if (conditionIndex < 0) {
      continue
    }

    const beatmapPath = beatmap.getOsuFilePath()
    if (!await pathExists(beatmapPath)) {
      continue
    }

    const replayPath = score.getOsrFilePath()
    if (!await pathExists(replayPath)) {
      continue
    }

    counts[conditionIndex]++
    results.push([beatmapPath, replayPath])

    if (counts.every((count, index) => count >= conditions[index].count)) {
      return results
    }
  }

  return results
}

const createOutputFromPath = async (
  beatmapPath: string,
  replayPath: string,
): Promise<FixtureOutput> => {
  const [beatmapContent, replayBuffer] = await Promise.all([
    readFile(beatmapPath, 'utf8'),
    readFile(replayPath),
  ])

  const beatmap = parseBeatmap(beatmapContent)
  const keyCount = beatmap.difficulty.keyCount
  const replay = parseReplay(replayBuffer, keyCount)
  const mods = replay.mods
  const modded = mods !== 0 ? applyLegacyBeatmapMods(beatmap, mods) : undefined
  const effectiveBeatmap = modded ?? beatmap
  const holdRatio = beatmap.hitObjects.length > 0
    ? beatmap.hitObjects.filter((o) => o.endTime !== undefined).length / beatmap.hitObjects.length
    : 0

  const speedRate = 'speedMultiplier' in effectiveBeatmap
    ? (effectiveBeatmap as { speedMultiplier: number }).speedMultiplier
    : 1
  const windowScale = 'hitWindowScale' in effectiveBeatmap
    ? (effectiveBeatmap as { hitWindowScale: number }).hitWindowScale
    : 1

  const osuData = {
    od: effectiveBeatmap.difficulty.overallDifficulty,
    hp: effectiveBeatmap.difficulty.hpDrainRate,
    speedRate,
    windowScale,
    noteColumns: beatmapToNoteColumns(effectiveBeatmap),
    actionColumns: replayToActionColumns(replay.frames, keyCount),
  }
  const statistics: HitResultTable<number> = [
    replay.statistics[0],
    replay.statistics[1],
    replay.statistics[2],
    replay.statistics[3],
    replay.statistics[4],
    replay.statistics[5],
  ]

  return {
    title: beatmap.metadata.title ?? '',
    difficulty: beatmap.metadata.version ?? '',
    creator: beatmap.metadata.creator ?? '',
    holdRatio,
    scoreInfo: {
      combo: replay.maxCombo,
      totalScore: replay.totalScore,
      mods: getScoreMods(replay.mods),
      modsBitmask: replay.mods,
      statistics,
      accuracy: calcAccuracy(statistics, [...v1.accTable] as HitResultTable<number>),
    },
    lifeFrames: [],
    osuData,
  }
}

const writeOutputsFromSources = async (outputDir: string, sourcePaths: [string, string][]) => {
  await mkdir(outputDir, { recursive: true })

  const filePaths: string[] = []
  for (const [beatmapPath, replayPath] of sourcePaths) {
    const output = await createOutputFromPath(beatmapPath, replayPath)
    const outputPath = path.join(outputDir, createOutputFileName(output))

    await writeFile(outputPath, `${formatJson(output)}\n`)
    filePaths.push(outputPath)
  }

  return filePaths
}

const main = async () => {
  const groupName = process.argv[2]
  if (!groupName || !(groupName in CONDITION_GROUPS)) {
    throw new Error('Usage: generate-test-json-stable.ts <tap-only|hold|mods>')
  }

  const osuFolder = getConfiguredOsuFolder()
  if (osuFolder === null) {
    throw new Error('OSU_STABLE_DIR is not configured.')
  }

  const [osuDatabase, scoresDatabase] = await Promise.all([
    osuFolder.readOsuDatabase(),
    osuFolder.readScoresDatabase(),
  ])

  const conditions = CONDITION_GROUPS[groupName as keyof typeof CONDITION_GROUPS]
  const query = osuFolder.createBeatmapScoreQuery(osuDatabase, scoresDatabase)
  const sourcePaths = await querySourcePaths(query, conditions)
  const outputDir = path.resolve(import.meta.dirname, `fixtures/stable/${groupName}`)
  const exportCount = (await writeOutputsFromSources(outputDir, sourcePaths)).length
  const maxCount = conditions.reduce((total: number, condition) => total + condition.count, 0)
  console.log(`Generated ${exportCount}/${maxCount} ${groupName} fixtures in ${outputDir}`)
}

await main()
