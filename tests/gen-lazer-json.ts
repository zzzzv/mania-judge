import path from 'node:path'
import process from 'node:process'

import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyBeatmapMods, applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import type { LazerMod, LegacyModBitmask } from 'osu-mania-io/mod'

import { v1, calcAccuracy, beatmapToNoteColumns, replayToActionColumns } from '../src'
import type { FixtureOutput } from './fixture-types'
import { CONDITION_GROUPS, validateConditions, writeOutputs } from './shared'
import type { QueryCondition, ConditionGroupName } from './shared'

import type { HitResultTable } from '../src/types'

// ── Config ────────────────────────────────────────────────────────────

const LAZER_API_BASE = 'http://localhost:5048'
const MAX_SCORE_RESULTS = 200

// ── Helpers ───────────────────────────────────────────────────────────

/** Extract the SHA256 hex hash from a RealmFile reference string. */
const extractReplayHash = (fileRef: unknown): string | undefined => {
  if (typeof fileRef === 'string') {
    const match = /RealmFile\s*\(Hash\s*=\s*([a-fA-F0-9]+)\)/.exec(fileRef)
    return match?.[1]?.toLowerCase()
  }
  if (fileRef !== null && typeof fileRef === 'object') {
    const obj = fileRef as Record<string, unknown>
    if (typeof obj.Hash === 'string') return obj.Hash.toLowerCase()
  }
  return undefined
}

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

const getLazerModAcronyms = (score: LazerScoreInfo): string[] => {
  // Try ModsJson first
  if (score.ModsJson) {
    return parseModsJson(score.ModsJson)
  }
  return []
}

const buildAccuracyRql = (
  condition: QueryCondition,
): string => {
  const [minAcc, maxAcc] = condition.accuracyRange
  const parts = [
    'Ruleset.ShortName=="mania"',
    `Accuracy>=${minAcc}`,
    `Accuracy<=${maxAcc}`,
  ]

  // Always exclude CL mod — scores with CL use Classic judging formula
  // which differs from the non-Classic formula we implement.
  parts.push('NOT (ModsJson CONTAINS "CL")')

  // For non-NM mods, also filter by the specific mod acronym
  if (condition.mods.length === 1 && condition.mods[0] !== 'NM') {
    parts.push(`ModsJson CONTAINS "${condition.mods[0]}"`)
  }

  return parts.join(' AND ')
}

// ── HTTP client ───────────────────────────────────────────────────────

interface LazerApiResponse<T> {
  count: number
  items: T[]
}

interface LazerScoreInfo {
  ID: string
  BeatmapHash: string
  Hash: string
  Files?: { File: unknown; Filename: string }[]
  TotalScore: number
  TotalScoreWithoutMods?: number
  LegacyTotalScore?: number
  MaxCombo: number
  Accuracy: number
  ModsJson: string
  StatisticsJson?: string
  Statistics?: Record<string, number>
  Mods?: unknown[]
  APIMods?: { Acronym: string; Settings: unknown }[]
  Passed?: boolean
  Combo?: number
}

interface StatusResponse {
  version: string
  lazer: {
    clientRealmPath: string
    isAvailable: boolean
  }
}

const checkBackendStatus = async (): Promise<void> => {
  let status: StatusResponse
  try {
    status = await fetchJson<StatusResponse>(`${LAZER_API_BASE}/api/status`)
  } catch {
    console.error(`Error: cannot reach backend at ${LAZER_API_BASE}`)
    console.error('Make sure OsuLocalServer is running')
    process.exit(1)
  }

  if (!status.lazer.isAvailable) {
    console.error('Error: lazer module is not available on the backend')
    console.error(`  clientRealmPath: ${status.lazer.clientRealmPath}`)
    console.error('Make sure osu!lazer has been run at least once to generate client.realm')
    process.exit(1)
  }

  console.log(`Backend connected (v${status.version}), lazer module available`)
}

// ── Types & Functions ─────────────────────────────────────────────

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`)
  }
  return response.json() as Promise<T>
}

const fetchBuffer = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`)
  }
  return response.arrayBuffer()
}

const queryScores = async (
  rql: string,
  depth = 2,
): Promise<LazerScoreInfo[]> => {
  const url = `${LAZER_API_BASE}/api/lazer/scores?rql=${encodeURIComponent(rql)}&depth=${depth}&noExpand=User&noExpand=BeatmapInfo`
  const result = await fetchJson<LazerApiResponse<LazerScoreInfo>>(url)
  return result.items
}

const fetchOsuFile = (beatmapHash: string): Promise<string> => {
  const url = `${LAZER_API_BASE}/api/lazer/files/${beatmapHash}`
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching .osu: ${url}`)
    return r.text()
  })
}

const fetchReplayFile = (replayHash: string): Promise<ArrayBuffer> => {
  const url = `${LAZER_API_BASE}/api/lazer/files/${replayHash}`
  return fetchBuffer(url)
}

// ── Conversion ────────────────────────────────────────────────────────

const createFixtureFromLazerScore = async (
  score: LazerScoreInfo,
): Promise<FixtureOutput | null> => {
  const beatmapHash = score.BeatmapHash
  if (!beatmapHash) return null

  // Extract replay hash from Files[0].File
  const replayHash = score.Files?.[0] ? extractReplayHash(score.Files[0].File) : undefined
  if (!replayHash) return null

  // Fetch .osu and replay in parallel
  let osuContent: string
  let replayBuffer: ArrayBuffer
  try {
    [osuContent, replayBuffer] = await Promise.all([
      fetchOsuFile(beatmapHash),
      fetchReplayFile(replayHash),
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
    replay = parseReplay(new Uint8Array(replayBuffer), keyCount)
  } catch {
    return null
  }

  // Determine mods and apply them
  // Prefer lazer mods from replay payload, fall back to legacy bitmask
  const lazerMods = replay.lazer?.mods
  const legacyMods = replay.mods as LegacyModBitmask

  let effectiveBeatmap: ReturnType<typeof parseBeatmap> & {
    speedMultiplier?: number
    hitWindowScale?: number
  }

  if (lazerMods && lazerMods.length > 0) {
    effectiveBeatmap = applyBeatmapMods(beatmap, lazerMods as LazerMod[])
  } else if (legacyMods !== 0) {
    effectiveBeatmap = applyLegacyBeatmapMods(beatmap, legacyMods)
  } else {
    effectiveBeatmap = beatmap as typeof effectiveBeatmap
  }

  // Calculate hold ratio from parsed beatmap
  const holdRatio = beatmap.hitObjects.length > 0
    ? beatmap.hitObjects.filter((o) => o.endTime !== undefined).length / beatmap.hitObjects.length
    : 0

  // Build osuData
  const speedRate = effectiveBeatmap.speedMultiplier ?? 1
  const windowScale = effectiveBeatmap.hitWindowScale ?? 1

  const osuData = {
    od: effectiveBeatmap.difficulty.overallDifficulty,
    hp: effectiveBeatmap.difficulty.hpDrainRate,
    speedRate,
    windowScale,
    noteColumns: beatmapToNoteColumns(effectiveBeatmap),
    actionColumns: replayToActionColumns(replay.frames, beatmap.difficulty.keyCount),
  }

  // Build scoreInfo
  const statistics = [...replay.statistics] as HitResultTable<number>

  // Mod acronyms: use lazer mods if available, else legacy mod bitmask
  let modAcronyms: string[]
  if (lazerMods && lazerMods.length > 0) {
    modAcronyms = lazerMods.map((m: LazerMod) => m.acronym)
  } else {
    modAcronyms = getLazerModAcronyms(score)
  }
  if (filterCosmeticMods(modAcronyms).length === 0) {
    modAcronyms = ['NM']
  }

  // Accuracy: prefer replay's computed accuracy, fall back to ScoreInfo
  const accuracy = score.Accuracy ?? calcAccuracy(statistics, [...v1.accTable] as HitResultTable<number>)

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
  conditions: QueryCondition[],
): Promise<FixtureOutput[]> => {
  validateConditions(conditions)

  const counts = conditions.map(() => 0)
  const results: FixtureOutput[] = []

  // Process conditions in order, querying scores for each accuracy range
  for (let condIdx = 0; condIdx < conditions.length; condIdx++) {
    const condition = conditions[condIdx]
    const needed = condition.count

    if (counts[condIdx] >= needed) continue

    // Build RQL and query scores
    const rql = `${buildAccuracyRql(condition)} LIMIT(${MAX_SCORE_RESULTS})`
    let scores: LazerScoreInfo[]

    try {
      scores = await queryScores(rql)
    } catch (err) {
      console.warn(`Query failed for condition ${condIdx}: ${err}`)
      continue
    }

    console.log(`  Condition ${condIdx} (acc ${condition.accuracyRange[0]}-${condition.accuracyRange[1]}, hold ${condition.holdRatioRange[0]}-${condition.holdRatioRange[1]}): got ${scores.length} candidates`)

    for (const score of scores) {
      if (counts[condIdx] >= needed) break

      // Filter mods client-side
      const scoreMods = getLazerModAcronyms(score)
      if (!hasMatchingMods(scoreMods, condition.mods)) continue

      const fixture = await createFixtureFromLazerScore(score)
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

const main = async () => {
  const groupName = process.argv[2]
  if (!groupName || !(groupName in CONDITION_GROUPS)) {
    throw new Error('Usage: gen-lazer-json.ts <tap-only|hold|mods>')
  }

  await checkBackendStatus()

  const conditions = CONDITION_GROUPS[groupName as ConditionGroupName]
  const maxCount = conditions.reduce((total, c) => total + c.count, 0)

  console.log(`Querying lazer API (${
    LAZER_API_BASE
  }) for ${groupName} fixtures (target: ${maxCount} scores)...`)

  const fixtures = await queryLazerFixtures(conditions)
  const outputDir = path.resolve(import.meta.dirname, `fixtures/lazer/${groupName}`)
  const filePaths = await writeOutputs(outputDir, fixtures)

  console.log(`Generated ${fixtures.length}/${maxCount} ${groupName} fixtures in ${outputDir}`)
  for (const fp of filePaths) {
    console.log(`  ${path.basename(fp)}`)
  }
}

await main()
