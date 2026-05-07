import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  HitSample,
  LifeBarFrame,
  Replay,
  Score,
  ScoreInfo,
  TimingPoint,
  Vector2,
} from 'osu-classes'
import {
  Hold,
  ManiaAction,
  ManiaBeatmap,
  ManiaReplayFrame,
  ManiaRuleset,
  Note,
  StageDefinition,
} from 'osu-mania-stable'
import { BeatmapEncoder, ScoreEncoder } from 'osu-parsers'

import type { FixtureOutput } from './fixture-types'
import { createSilentWav, createZipArchive, sanitizeFileNamePart } from './utils'

interface GeneratedFixturePaths {
  fixtureName: string
  jsonPath: string
  osrPath: string
  oszPath: string
}

const ruleset = new ManiaRuleset()
const beatmapEncoder = new BeatmapEncoder()
const scoreEncoder = new ScoreEncoder()

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

const getStableColumnX = (totalColumns: number, column: number) => {
  const divisor = 512 / totalColumns
  const position = Math.floor(column * divisor + divisor / 2)
  return Math.max(0, Math.min(511, position))
}

export const createBeatmapFromFixture = (fixture: FixtureOutput) => {
  const totalColumns = fixture.osuData.noteColumns.length
  const beatmap = new ManiaBeatmap(new StageDefinition(totalColumns), totalColumns)

  beatmap.originalMode = 3
  beatmap.general.audioFilename = DEFAULT_AUDIO_FILENAME
  beatmap.general.previewTime = fixture.osuData.noteColumns.flat().at(0)?.start ?? -1
  beatmap.general.countdown = 0
  beatmap.general.letterboxInBreaks = false
  beatmap.general.specialStyle = totalColumns % 2 === 1
  beatmap.general.widescreenStoryboard = false

  beatmap.metadata.title = fixture.title || DEFAULT_TITLE
  beatmap.metadata.titleUnicode = fixture.title || DEFAULT_TITLE
  beatmap.metadata.artist = DEFAULT_ARTIST
  beatmap.metadata.artistUnicode = DEFAULT_ARTIST
  beatmap.metadata.creator = fixture.creator || DEFAULT_CREATOR
  beatmap.metadata.version = fixture.difficulty || DEFAULT_DIFFICULTY
  beatmap.metadata.tags = [...DEFAULT_TAGS]

  beatmap.difficulty.circleSize = totalColumns
  beatmap.difficulty.drainRate = fixture.osuData.hp
  beatmap.difficulty.overallDifficulty = fixture.osuData.od
  beatmap.difficulty.approachRate = fixture.osuData.od
  beatmap.difficulty.sliderMultiplier = 1
  beatmap.difficulty.sliderTickRate = 1

  const timingPoint = new TimingPoint()
  timingPoint.beatLength = 1000
  beatmap.controlPoints.add(timingPoint, 0)

  const notes = fixture.osuData.noteColumns
    .flat()
    .sort((left, right) => left.start - right.start || left.column - right.column)

  for (const note of notes) {
    const startPosition = new Vector2(getStableColumnX(totalColumns, note.column), 192)

    if (typeof note.end === 'number') {
      const hold = new Hold()
      hold.startTime = note.start
      hold.endTime = note.end
      hold.originalColumn = note.column
      hold.column = note.column
      hold.startPosition = startPosition
      hold.samples = [new HitSample()]
      hold.nodeSamples = [[new HitSample()], []]
      hold.applyDefaults(beatmap.controlPoints, beatmap.difficulty)
      beatmap.hitObjects.push(hold)
      continue
    }

    const hit = new Note()
    hit.startTime = note.start
    hit.originalColumn = note.column
    hit.column = note.column
    hit.startPosition = startPosition
    hit.samples = [new HitSample()]
    hit.applyDefaults(beatmap.controlPoints, beatmap.difficulty)
    beatmap.hitObjects.push(hit)
  }

  return beatmap
}

export const createReplayFrames = (fixture: FixtureOutput) => {
  const transitions = fixture.osuData.actionColumns
    .flatMap((actions) => actions.flatMap((action) => ([
      { time: action.press, column: action.column, pressed: true },
      { time: action.release, column: action.column, pressed: false },
    ])))
    .sort((left, right) => {
      if (left.time !== right.time) {
        return left.time - right.time
      }

      if (left.pressed !== right.pressed) {
        return left.pressed ? 1 : -1
      }

      return left.column - right.column
    })

  const frames: ManiaReplayFrame[] = []
  const activeColumns = new Set<number>()
  let lastTime = 0

  const initialFrame = new ManiaReplayFrame()
  initialFrame.startTime = 0
  initialFrame.interval = 0
  initialFrame.actions = new Set()
  frames.push(initialFrame)

  for (const transition of transitions) {
    if (transition.pressed) {
      activeColumns.add(transition.column)
    } else {
      activeColumns.delete(transition.column)
    }

    const frame = new ManiaReplayFrame()
    frame.startTime = transition.time
    frame.interval = transition.time - lastTime
    frame.actions = new Set(
      [...activeColumns]
        .sort((left, right) => left - right)
        .map((column) => ManiaAction.Key1 + column)
    )
    frames.push(frame)
    lastTime = transition.time
  }

  return frames
}

export const createScoreFromFixture = (fixture: FixtureOutput, beatmapHashMD5: string) => {
  const replay = new Replay()
  replay.mode = 3
  replay.lifeBar = fixture.lifeFrames.map(([time, health]) => new LifeBarFrame(time, health))
  replay.frames = createReplayFrames(fixture)

  const info = new ScoreInfo()
  info.id = Number.parseInt(beatmapHashMD5.slice(0, 8), 16)
  info.ruleset = ruleset
  info.rulesetId = 3
  info.rawMods = fixture.scoreInfo.modsBitmask
  info.username = 'mania-judge'
  info.beatmapHashMD5 = beatmapHashMD5
  info.date = new Date()
  info.maxCombo = fixture.scoreInfo.combo
  info.totalScore = fixture.scoreInfo.totalScore
  info.countGeki = fixture.scoreInfo.statistics[0]
  info.count300 = fixture.scoreInfo.statistics[1]
  info.countKatu = fixture.scoreInfo.statistics[2]
  info.count100 = fixture.scoreInfo.statistics[3]
  info.count50 = fixture.scoreInfo.statistics[4]
  info.countMiss = fixture.scoreInfo.statistics[5]
  info.passed = true
  info.perfect = fixture.scoreInfo.statistics[5] === 0

  return new Score(info, replay)
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
  const osuContent = beatmapEncoder.encodeToString(beatmap)
  const beatmapHashMD5 = createHash('md5').update(osuContent).digest('hex')
  const score = createScoreFromFixture(fixture, beatmapHashMD5)
  const scoreBuffer = await scoreEncoder.encodeToBuffer(score, beatmap)

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