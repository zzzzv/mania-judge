import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { GameplayModes, Mods } from 'osu-stable-db'
import { getConfiguredOsuFolder } from 'osu-stable-db/node'
import type { BeatmapScoreMatch, BeatmapScoreQuery } from 'osu-stable-db/node'

import { v1, calcAccuracy } from '../src'
import { parseFromPath } from '../src/osu-parsers/node'
import { formatJson, pathExists, sanitizeFileNamePart } from './utils'
import type { FixtureOutput } from './fixture-types'

import type { HitResultTable } from '../src/types'

interface QueryCondition {
  holdRatioRange: [number, number]
  accuracyRange: [number, number]
  count: number
  mods: string[]
}

type ConditionGroupName = 'tap-only' | 'hold' | 'mods'

const CONDITION_GROUPS: Record<ConditionGroupName, QueryCondition[]> = {
  'tap-only': [
    { holdRatioRange: [0, 0], accuracyRange: [0.9, 0.919999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.92, 0.939999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.94, 0.959999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.96, 0.98], count: 10, mods: ['NM'] },
  ],
  'hold': [
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.9, 0.919999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.92, 0.939999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.94, 0.959999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.96, 0.98], count: 10, mods: ['NM'] },
  ],
  'mods': [
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['EZ'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['HR'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['MR'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['DT'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['HT'] },
  ],
}

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
  score: BeatmapScoreMatch['score'] | Awaited<ReturnType<typeof parseFromPath>>['rawScore']['info'],
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
  score: BeatmapScoreMatch['score'] | Awaited<ReturnType<typeof parseFromPath>>['rawScore']['info'],
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
  for (const condition of conditions) {
    if (condition.holdRatioRange[0] > condition.holdRatioRange[1]) {
      throw new Error('holdRatioRange must be in ascending order.')
    }

    if (condition.accuracyRange[0] > condition.accuracyRange[1]) {
      throw new Error('accuracyRange must be in ascending order.')
    }

    if (!Number.isInteger(condition.count) || condition.count <= 0) {
      throw new Error('count must be a positive integer.')
    }
  }

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
  const { rawBeatmap, rawScore, osuData } = await parseFromPath(beatmapPath, replayPath)
  const modsBitmask = rawScore.info.mods?.bitwise ?? Number(rawScore.info.rawMods ?? 0)
  const statistics: HitResultTable<number> = createScoreStatistics(rawScore.info)
  const holdRatio = rawBeatmap.hitObjects.length > 0 ? rawBeatmap.holds.length / rawBeatmap.hitObjects.length : 0

  return {
    title: rawBeatmap.metadata.titleUnicode || rawBeatmap.metadata.title || '',
    difficulty: rawBeatmap.metadata.version || '',
    creator: rawBeatmap.metadata.creator || '',
    holdRatio,
    scoreInfo: {
      combo: rawScore.info.maxCombo,
      totalScore: rawScore.info.totalScore,
      mods: getScoreMods(modsBitmask),
      modsBitmask,
      statistics,
      accuracy: getScoreAccuracy(rawScore.info),
    },
    lifeFrames: rawScore.replay!.lifeBar.map((frame) => [frame.startTime, frame.health]),
    osuData,
  }
}

const createOutputFileName = (output: FixtureOutput) => {
  const titlePart = sanitizeFileNamePart(output.title || 'untitled')
  const difficultyPart = sanitizeFileNamePart(output.difficulty || 'difficulty')
  return `${titlePart}-${difficultyPart}-${(output.scoreInfo.accuracy * 100).toFixed(2)}.json`
}

const writeOutputs = async (outputDir: string, sourcePaths: [string, string][]) => {
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

const isConditionGroupName = (value: string): value is ConditionGroupName => {
  return value in CONDITION_GROUPS
}

const main = async () => {
  const groupName = process.argv[2]
  if (!groupName || !isConditionGroupName(groupName)) {
    throw new Error('Usage: generate-test-json.ts <tap-only|hold|mods>')
  }

  const osuFolder = getConfiguredOsuFolder()
  if (osuFolder === null) {
    throw new Error('OSU_STABLE_DIR is not configured.')
  }

  const [osuDatabase, scoresDatabase] = await Promise.all([
    osuFolder.readOsuDatabase(),
    osuFolder.readScoresDatabase(),
  ])

  const query = osuFolder.createBeatmapScoreQuery(osuDatabase, scoresDatabase)
  const sourcePaths = await querySourcePaths(query, CONDITION_GROUPS[groupName])
  const outputDir = path.resolve(import.meta.dirname, `fixtures/json/${groupName}`)
  const exportCount = (await writeOutputs(outputDir, sourcePaths)).length
  const maxCount = CONDITION_GROUPS[groupName].reduce((total, condition) => total + condition.count, 0)
  console.log(`Generated ${exportCount}/${maxCount} ${groupName} fixtures in ${outputDir}`)
}

await main()