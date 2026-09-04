# mania-judge

Work in progress.

Simulates osu!mania judgements.

## Status

- Score is not implemented.
- Mods: support is determined by osu-mania-io. Current tested coverage includes `HT`, `DT`, `HR`, `EZ`, and `MR`.

### v1

- Implemented: judgements, combo, and life.
- Tap-only: accurate in current tests.
- Hold: validated by accuracy-only tests with average error capped at 0.002 and max error capped at 0.004.
- Mods fixtures: accuracy-only tests cap average error at 0.002 and max error at 0.004.

### lazer

- Implemented: judgements.
- Tap-only: accurate in current tests.
- Hold: validated by accuracy-only tests with average error capped at 0.001 and max error capped at 0.002.
- Mods fixtures: accuracy-only tests cap average error at 0.0005 and max error at 0.002.

## Usage

### Core simulation

```ts
import { v1, calcAccuracy } from 'mania-judge'

const judgements = v1.playOsu(osuData)
const frames = v1.generateFramesOsu(judgements, osuData.hp)
const lastFrame = frames.at(-1)

if (lastFrame) {
  const accuracy = calcAccuracy(lastFrame.resultCounts, v1.accTable)
  console.log(lastFrame.resultCounts, lastFrame.maxCombo, lastFrame.life, accuracy)
}
```

### Parsing `.osu` / `.osr` files

Use [`osu-mania-io`](https://github.com/zzzzv/osu-mania-io) to parse beatmap and replay files, then convert the result with the adapter functions in `column.ts`:

```ts
import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import { beatmapToNoteColumns, replayToActionColumns } from 'mania-judge'

const beatmap = parseBeatmap(osuContent)
const replay = parseReplay(osrBuffer, beatmap.difficulty.keyCount)

// Apply mods if needed.
const effective = replay.mods !== 0
  ? applyLegacyBeatmapMods(beatmap, replay.mods)
  : beatmap

const osuData = {
  od: effective.difficulty.overallDifficulty,
  hp: effective.difficulty.hpDrainRate,
  speedRate: 'speedMultiplier' in effective ? effective.speedMultiplier : 1,
  windowScale: 'hitWindowScale' in effective ? effective.hitWindowScale : 1,
  noteColumns: beatmapToNoteColumns(effective),
  actionColumns: replayToActionColumns(replay.frames, beatmap.difficulty.keyCount),
}
```
