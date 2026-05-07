import { BeatmapDecoder, ScoreDecoder } from 'osu-parsers'
import { Hold, ManiaModCombination, ManiaRuleset } from 'osu-mania-stable'
import { ModBitwise } from 'osu-classes'

import type { Action, Columns, Note, OsuData } from '../types'
import type { ManiaBeatmap, ManiaReplayFrame } from 'osu-mania-stable'

type ReplayBufferLike = ArrayBuffer | SharedArrayBuffer | Uint8Array | Buffer

const ruleset = new ManiaRuleset()
const beatmapDecoder = new BeatmapDecoder()
const scoreDecoder = new ScoreDecoder()

export const convertBeatmap = (beatmap: ManiaBeatmap) => {
	const columnsArray: Columns<Note> = Array.from({ length: beatmap.totalColumns }, () => [])
	for (const hitObject of beatmap.hitObjects) {
		const note: Note = {
			column: hitObject.column,
			start: hitObject.startTime,
			end: hitObject instanceof Hold ? hitObject.endTime : undefined,
		}
		columnsArray[note.column].push(note)
	}
	return columnsArray
}

export const convertReplay = (frames: ManiaReplayFrame[], columns: number): Columns<Action> => {
	const columnsArray: Columns<Action> = Array.from({ length: columns }, () => [])
	const lastPressTime: (number | null)[] = Array.from({ length: columns }, () => null)

	for (const frame of frames) {
		if (frame.startTime < 0) continue

		for (let i = 0; i < columns; i++) {
			if (frame.actions.has(10 + i)) {
				if (lastPressTime[i] === null) {
					lastPressTime[i] = frame.startTime
				}
			} else if (lastPressTime[i] !== null) {
				columnsArray[i].push({
					column: i,
					press: lastPressTime[i]!,
					release: frame.startTime,
				})
				lastPressTime[i] = null
			}
		}
	}

	return columnsArray
}

export const parseWithMods = async (beatmapContent: string, replayBuffer: ReplayBufferLike) => {
	const beatmap = beatmapDecoder.decodeFromString(beatmapContent, false)
	const score = await scoreDecoder.decodeFromBuffer(replayBuffer, true)
	score.info.ruleset = ruleset

	const maniaBeatmap = ruleset.applyToBeatmap(beatmap)
	const columns = maniaBeatmap.totalColumns
	const maniaFrames = ruleset.applyToReplay(score.replay!, maniaBeatmap).frames as ManiaReplayFrame[]
	const mods = score.info.mods as ManiaModCombination | null
	const maniaBeatmapWithMods = mods === null || mods.bitwise === 0
		? maniaBeatmap
		: ruleset.applyToBeatmapWithMods(maniaBeatmap, mods)

	const osuData: OsuData = {
		od: beatmap.difficulty.overallDifficulty,
		hp: beatmap.difficulty.drainRate,
		windowScale: 1,
		noteColumns: convertBeatmap(maniaBeatmapWithMods),
		actionColumns: convertReplay(maniaFrames, columns),
	}

	if (mods?.has(ModBitwise.Easy)) {
    osuData.windowScale = 1.4
    osuData.hp *= 0.5
	} else if (mods?.has(ModBitwise.HardRock)) {
    osuData.windowScale = 1 / 1.4
    osuData.hp = Math.min(osuData.hp * 1.4, 10)
  } else if (mods?.has(ModBitwise.DoubleTime)) {
		osuData.windowScale = 1.5
	} else if (mods?.has(ModBitwise.HalfTime)) {
		osuData.windowScale = 0.75
	}

	return {
		osuData,
		rawBeatmap: maniaBeatmap,
		rawScore: score,
	}
}
