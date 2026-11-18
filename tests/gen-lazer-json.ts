import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyBeatmapMods, applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import type { LazerMod, LegacyModBitmask } from 'osu-mania-io/mod'

import { v1, calcAccuracy, createOsuData } from '../src'
import { encodeFrames } from './fixture-frames'
import type { FixtureOutput } from './fixture-types'
import { CONDITION_GROUPS, validateConditions, writeOutputs } from './shared'
import type { QueryCondition, ConditionGroupName } from './shared'

import type { HitResultTable } from '../src/types'

// ── Config ────────────────────────────────────────────────────────────

/** `lazer-index` 的默认输出位置，可用 `--index` 或 `LAZER_INDEX` 覆盖。 */
const DEFAULT_INDEX_PATH = path.resolve(import.meta.dirname, '../tools/lazer-index/out/scores.json')

/** 每个条件最多看多少条候选（对应旧实现的 `LIMIT(200)`）。 */
const MAX_SCORE_RESULTS = 200

/** `lazer-index` 导出的索引（camelCase；null 字段被省略）。 */
interface IndexScore {
  id: string
  beatmapHash?: string
  beatmapPath?: string
  replayPath?: string
  playedAt?: number
  maxCombo?: number
  accuracy?: number
  totalScore?: number
  modsJson?: string
  rank?: string
}

interface IndexDocument {
  dataDirectory?: string
  clientVersion?: string
  scores: IndexScore[]
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Parse lazer mod acronyms from ModsJson string. */
const parseModsJson = (modsJson: string): string[] => {
  try {
    const mods: { acronym?: string }[] = JSON.parse(modsJson)
    return mods.map((m) => m.acronym ?? '').filter(Boolean)
  } catch {
    return []
  }
}

/** Mod acronyms that don't affect gameplay timing or judgement windows. */
const COSMETIC_MODS = new Set(['CL', 'CO'])

/** Filter out cosmetic-only mods that don't affect gameplay. */
const filterCosmeticMods = (mods: string[]): string[] => {
  return mods.filter((m) => !COSMETIC_MODS.has(m))
}

/** Check if the mod list matches the expected set (order-agnostic). */
const hasMatchingMods = (scoreMods: string[], expectedMods: string[]): boolean => {
  const effectiveMods = filterCosmeticMods(scoreMods)

  // For NM, treat cosmetic-only mods or empty as NM
  if (expectedMods.length === 1 && expectedMods[0] === 'NM') {
    return effectiveMods.length === 0
  }

  // For non-NM mods, compare after filtering cosmetic mods (CL, CO)
  return effectiveMods.length === expectedMods.length
    && expectedMods.every((mod) => effectiveMods.includes(mod))
}

const getIndexModAcronyms = (score: IndexScore): string[] => parseModsJson(score.modsJson ?? '')

/**
 * 条件预筛，语义与原 RQL 保持一致：
 * `Ruleset.ShortName=="mania" AND Accuracy>=min AND Accuracy<=max
 *  AND NOT (ModsJson CONTAINS "CL")`，非 NM 时再加 `ModsJson CONTAINS "<mod>"`。
 * 索引本身只导出 mania 分数，所以 ruleset 条件不用再判断。
 */
const matchesConditionPrefilter = (score: IndexScore, condition: QueryCondition): boolean => {
  const accuracy = score.accuracy ?? 0
  const [minAcc, maxAcc] = condition.accuracyRange
  if (accuracy < minAcc || accuracy > maxAcc) return false

  // Scores with the Classic mod use the Classic judgement formula, which differs
  // from the non-Classic formula we implement.
  const mods = getIndexModAcronyms(score)
  if (mods.includes('CL')) return false

  if (condition.mods.length === 1 && condition.mods[0] !== 'NM' && !mods.includes(condition.mods[0])) {
    return false
  }

  return true
}

// ── Index loading ─────────────────────────────────────────────────────

const loadIndex = async (indexPath: string): Promise<IndexDocument> => {
  let content: string
  try {
    content = await readFile(indexPath, 'utf8')
  } catch {
    throw new Error(
      `读不到 lazer 索引：${indexPath}\n`
      + '先导出：dotnet run --project tools/lazer-index -- --out tools/lazer-index/out/scores.json',
    )
  }

  const document = JSON.parse(content) as IndexDocument
  if (!Array.isArray(document.scores)) {
    throw new Error(`索引格式不对（缺少 scores 数组）：${indexPath}`)
  }

  return document
}

// ── Conversion ────────────────────────────────────────────────────────

const createFixtureFromScore = async (score: IndexScore): Promise<FixtureOutput | null> => {
  const { beatmapPath, replayPath } = score
  if (!beatmapPath || !replayPath) return null

  // 索引里给的就是绝对路径，直接读文件
  let osuContent: string
  let replayBuffer: Buffer
  try {
    [osuContent, replayBuffer] = await Promise.all([
      readFile(beatmapPath, 'utf8'),
      readFile(replayPath),
    ])
  } catch {
    return null
  }

  // Parse beatmap
  let beatmap: ReturnType<typeof parseBeatmap>
  let replay: ReturnType<typeof parseReplay>
  try {
    beatmap = parseBeatmap(osuContent)
    const keyCount = beatmap.difficulty.keyCount
    replay = parseReplay(replayBuffer, keyCount)
  } catch {
    return null
  }

  // Determine mods and apply them
  // Prefer lazer mods from replay payload, fall back to legacy bitmask
  const lazerMods = replay.lazer?.mods
  const legacyMods = replay.mods as LegacyModBitmask

  const effectiveBeatmap = lazerMods && lazerMods.length > 0
    ? applyBeatmapMods(beatmap, lazerMods as LazerMod[])
    : legacyMods !== 0
      ? applyLegacyBeatmapMods(beatmap, legacyMods, { randomSeed: replay.stableRandomSeed })
      : beatmap

  // Calculate hold ratio from parsed beatmap
  const holdRatio = beatmap.hitObjects.length > 0
    ? beatmap.hitObjects.filter((o) => o.endTime !== undefined).length / beatmap.hitObjects.length
    : 0

  // Build osuData（字段换算统一走 createOsuData，避免和库里的口径漂移）
  const osuData = {
    ...createOsuData(effectiveBeatmap, replay),
    frames: encodeFrames(replay.frames),
  }

  // Build scoreInfo
  const statistics = [...replay.statistics] as HitResultTable<number>

  // Mod acronyms: use lazer mods if available, else legacy mod bitmask
  let modAcronyms: string[]
  if (lazerMods && lazerMods.length > 0) {
    modAcronyms = lazerMods.map((m: LazerMod) => m.acronym)
  } else {
    modAcronyms = getIndexModAcronyms(score)
  }
  if (filterCosmeticMods(modAcronyms).length === 0) {
    modAcronyms = ['NM']
  }

  // Accuracy: prefer the value recorded by lazer, fall back to the replay's stats
  const accuracy = score.accuracy ?? calcAccuracy(statistics, [...v1.accTable] as HitResultTable<number>)

  return {
    title: beatmap.metadata.title ?? '',
    difficulty: beatmap.metadata.version ?? '',
    creator: beatmap.metadata.creator ?? '',
    holdRatio,
    scoreInfo: {
      combo: replay.maxCombo,
      totalScore: replay.totalScore,
      mods: modAcronyms,
      modsBitmask: legacyMods,
      statistics,
      accuracy,
    },
    lifeFrames: [],
    osuData,
  }
}

// ── Query logic ───────────────────────────────────────────────────────

const queryLazerFixtures = async (
  scores: IndexScore[],
  conditions: QueryCondition[],
): Promise<FixtureOutput[]> => {
  validateConditions(conditions)

  const counts = conditions.map(() => 0)
  const results: FixtureOutput[] = []

  // Process conditions in order, picking candidates for each accuracy range
  for (let condIdx = 0; condIdx < conditions.length; condIdx++) {
    const condition = conditions[condIdx]
    const needed = condition.count

    if (counts[condIdx] >= needed) continue

    const candidates = scores
      .filter((score) => matchesConditionPrefilter(score, condition))
      .slice(0, MAX_SCORE_RESULTS)

    console.log(`  Condition ${condIdx} (acc ${condition.accuracyRange[0]}-${condition.accuracyRange[1]}, hold ${condition.holdRatioRange[0]}-${condition.holdRatioRange[1]}): got ${candidates.length} candidates`)

    for (const score of candidates) {
      if (counts[condIdx] >= needed) break

      // Filter mods client-side
      const scoreMods = getIndexModAcronyms(score)
      if (!hasMatchingMods(scoreMods, condition.mods)) continue

      const fixture = await createFixtureFromScore(score)
      if (!fixture) continue

      // Check hold ratio
      const [minHold, maxHold] = condition.holdRatioRange
      if (fixture.holdRatio < minHold || fixture.holdRatio > maxHold) continue

      counts[condIdx]++
      results.push(fixture)
      console.log(`    -> Match #${counts[condIdx]}/${needed}: "${fixture.title} - ${fixture.difficulty}" (hold=${fixture.holdRatio.toFixed(3)}, acc=${(fixture.scoreInfo.accuracy * 100).toFixed(2)}%)`)
    }
  }

  return results
}

// ── Main ──────────────────────────────────────────────────────────────

interface CliOptions {
  groupName: ConditionGroupName
  indexPath: string
}

const parseArgs = (argv: string[]): CliOptions => {
  let groupName: string | undefined
  let indexPath: string = process.env.LAZER_INDEX ?? DEFAULT_INDEX_PATH

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--index' || arg === '-i') {
      const value = argv[++index]
      if (!value) throw new Error('--index 需要一个路径参数')
      indexPath = value
      continue
    }

    if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`)
    if (groupName !== undefined) throw new Error('一次只能生成一个条件组')

    groupName = arg
  }

  if (!groupName || !(groupName in CONDITION_GROUPS)) {
    throw new Error('Usage: gen-lazer-json.ts <tap-only|hold|mods> [--index <path>]')
  }

  return {
    groupName: groupName as ConditionGroupName,
    indexPath: path.resolve(process.cwd(), indexPath),
  }
}

const main = async () => {
  const { groupName, indexPath } = parseArgs(process.argv.slice(2))

  const document = await loadIndex(indexPath)
  console.log(`Index: ${indexPath} (lazer ${document.clientVersion ?? 'unknown'}, ${document.scores.length} scores)`)

  const conditions = CONDITION_GROUPS[groupName]
  const maxCount = conditions.reduce((total, c) => total + c.count, 0)

  console.log(`Generating ${groupName} fixtures (target: ${maxCount} scores)...`)

  const fixtures = await queryLazerFixtures(document.scores, conditions)
  const outputDir = path.resolve(import.meta.dirname, `fixtures/lazer/${groupName}`)
  const filePaths = await writeOutputs(outputDir, fixtures)

  console.log(`Generated ${fixtures.length}/${maxCount} ${groupName} fixtures in ${outputDir}`)
  for (const fp of filePaths) {
    console.log(`  ${path.basename(fp)}`)
  }
}

await main()
