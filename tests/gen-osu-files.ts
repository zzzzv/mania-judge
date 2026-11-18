import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { serializeBeatmap } from 'osu-mania-io/beatmap'
import { serializeReplay } from 'osu-mania-io/replay'
import type { ReplayFrame } from 'osu-mania-io/replay'

import { decodeFrames } from './fixture-frames'
import type { FixtureOutput } from './fixture-types'
import { createSilentWav, createZipArchive, sanitizeFileNamePart } from './utils'

interface GeneratedFixturePaths {
  fixtureName: string
  jsonPath: string
  osrPath: string
  oszPath: string
}

const DEFAULT_ROOT_DIR = path.resolve(import.meta.dirname, 'fixtures/generated')
const DEFAULT_AUDIO_FILENAME = 'silence.wav'
const DEFAULT_TITLE = 'Generated Fixture'
const DEFAULT_ARTIST = 'mania-judge'
const DEFAULT_CREATOR = 'mania-judge'
const DEFAULT_DIFFICULTY = 'Generated'
const DEFAULT_TAGS = ['generated', 'fixture']

const parseCliRootDir = (argv: string[]) => {
  if (argv.length > 1) {
    throw new Error('Only one directory can be provided.')
  }

  const [rootDir] = argv
  if (rootDir?.startsWith('--')) {
    throw new Error(`Unknown option: ${rootDir}`)
  }

  return rootDir === undefined
    ? DEFAULT_ROOT_DIR
    : path.resolve(process.cwd(), rootDir)
}

const getOutputDirs = (rootDir: string) => {
  return {
    osrDir: path.join(rootDir, 'osr'),
    oszDir: path.join(rootDir, 'osz'),
  }
}

const ensureOutputDirs = async (rootDir: string) => {
  const { osrDir, oszDir } = getOutputDirs(rootDir)

  await Promise.all([
    mkdir(rootDir, { recursive: true }),
    mkdir(osrDir, { recursive: true }),
    mkdir(oszDir, { recursive: true }),
  ])
}

const resolveJsonPaths = async (rootDir: string) => {
  const entries = await readdir(rootDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(rootDir, entry.name))
}

export const readFixture = async (jsonPath: string) => {
  const content = await readFile(jsonPath, 'utf8')
  return JSON.parse(content) as FixtureOutput
}

const createBeatmapFromFixture = (fixture: FixtureOutput) => {
  const totalColumns = fixture.osuData.noteColumns.length
  // osu-mania-io 1.0 起 ControlPoint 用 kind + sampleBank 建模，uninherited/effects 由 write 侧推导
  const timingPoint = { time: 0, beatLength: 1000, meter: 4, sampleBank: 'default' as const, sampleIndex: 0, volume: 100, effectFlags: 0, kind: 'timing' as const }

  return {
    // 14 是 osu-mania-io 的默认写出格式，显式写出来保持 .osu 内容不变
    fileFormat: 14,
    // 1.0 起 General 段所有键都是必填（0.1.x 里可省略的键不再有默认值）
    general: {
      audioFilename: DEFAULT_AUDIO_FILENAME,
      audioLeadIn: 0,
      previewTime: fixture.osuData.noteColumns.flat().at(0)?.start ?? -1,
      countdown: 0 as const,
      sampleBank: 'default' as const,
      stackLeniency: 0.7,
      mode: 3 as const,
      letterboxInBreaks: false,
      useSkinSprites: false,
      overlayPosition: 'no-change' as const,
      epilepsyWarning: false,
      countdownOffset: 0,
      specialStyle: totalColumns % 2 === 1,
      widescreenStoryboard: false,
      samplesMatchPlaybackRate: false,
    },
    metadata: {
      title: fixture.title || DEFAULT_TITLE,
      titleUnicode: fixture.title || DEFAULT_TITLE,
      artist: DEFAULT_ARTIST,
      artistUnicode: DEFAULT_ARTIST,
      creator: fixture.creator || DEFAULT_CREATOR,
      version: fixture.difficulty || DEFAULT_DIFFICULTY,
      tags: [...DEFAULT_TAGS],
    },
    difficulty: {
      hpDrainRate: fixture.osuData.hp,
      keyCount: totalColumns,
      overallDifficulty: fixture.osuData.od,
      approachRate: 5,
      sliderMultiplier: 1,
      sliderTickRate: 1,
    },
    controlPoints: [timingPoint],
    hitObjects: fixture.osuData.noteColumns
      .flat()
      .sort((left, right) => left.start - right.start || left.column - right.column)
      .map((note) => ({
        column: note.column,
        startTime: note.start,
        endTime: note.end,
      })),
  }
}

export const createReplayFrames = (fixture: FixtureOutput): ReplayFrame[] => {
  // fixture 里存的就是原始行表，直接展开即可（不需要再从按键区间反推）
  return decodeFrames(fixture.osuData.frames, fixture.osuData.noteColumns.length)
}

const createScoreFromFixture = (fixture: FixtureOutput, beatmapHashMD5: string) => {
  return {
    gameVersion: 20250307,
    beatmapHash: beatmapHashMD5,
    username: 'mania-judge',
    replayHash: '',
    mods: fixture.scoreInfo.modsBitmask,
    statistics: [
      fixture.scoreInfo.statistics[0], // max
      fixture.scoreInfo.statistics[1], // great
      fixture.scoreInfo.statistics[2], // good
      fixture.scoreInfo.statistics[3], // ok
      fixture.scoreInfo.statistics[4], // meh
      fixture.scoreInfo.statistics[5], // miss
    ] as const,
    totalScore: fixture.scoreInfo.totalScore,
    maxCombo: fixture.scoreInfo.combo,
    perfectCombo: fixture.scoreInfo.statistics[5] === 0 || undefined,
    playedAt: new Date(),
    frames: createReplayFrames(fixture),
    onlineScoreId: BigInt(parseInt(beatmapHashMD5.slice(0, 8), 16)),
  }
}

export const createFixtureName = (fixture: FixtureOutput) => {
  const titlePart = sanitizeFileNamePart(fixture.title || 'fixture')
  const difficultyPart = sanitizeFileNamePart(fixture.difficulty || DEFAULT_DIFFICULTY)
  return `${titlePart}-${difficultyPart}`
}

export const generateFromFixture = async (rootDir: string, jsonPath: string): Promise<GeneratedFixturePaths> => {
  const fixture = await readFixture(jsonPath)
  const fixtureName = createFixtureName(fixture)
  const { osrDir, oszDir } = getOutputDirs(rootDir)

  const beatmap = createBeatmapFromFixture(fixture)
  const osuContent = serializeBeatmap(beatmap)
  const beatmapHashMD5 = createHash('md5').update(osuContent).digest('hex')
  const replay = createScoreFromFixture(fixture, beatmapHashMD5)
  const scoreBuffer = serializeReplay(replay)

  const osrPath = path.join(osrDir, `${fixtureName}.osr`)
  const oszPath = path.join(oszDir, `${fixtureName}.osz`)

  await Promise.all([
    writeFile(osrPath, Buffer.from(scoreBuffer)),
  ])

  await createZipArchive(oszPath, [
    { name: `${fixtureName}.osu`, content: osuContent },
    { name: DEFAULT_AUDIO_FILENAME, content: createSilentWav() },
  ])

  return {
    fixtureName,
    jsonPath,
    osrPath,
    oszPath,
  }
}

export const generateFiles = async (rootDir: string) => {
  await ensureOutputDirs(rootDir)

  const jsonPaths = await resolveJsonPaths(rootDir)
  if (jsonPaths.length === 0) {
    throw new Error(`No input JSON found in ${rootDir}.`)
  }

  const generated = [] as GeneratedFixturePaths[]

  for (const jsonPath of jsonPaths) {
    const output = await generateFromFixture(rootDir, jsonPath)
    generated.push(output)
  }

  return {
    rootDir,
    generated,
  }
}

const main = async () => {
  const rootDir = parseCliRootDir(process.argv.slice(2))

  const result = await generateFiles(rootDir)

  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.main) {
  await main()
}