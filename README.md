# mania-judge

Work in progress.

Simulates osu!stable mania judgements.

## Status

- Implemented: judgements, combo, and life.
- Not implemented: score.
- Tap-only: accurate in current tests except for a few life mismatches.
- Hold: not expected to be exact yet because the precise stable hold algorithm is still unknown.
- Hold accuracy error across 47 fixtures: `0.00%` min, `0.39%` max, `0.16%` average.
- Mod coverage: `HT`, `DT`, `HR`, `EZ`, and `MR`.
- Not supported: `RD`.

## Usage

### Main entry

Use the main entry if you already have `osuData`. This path does not need the parser peer dependencies.

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

### Parser entries

Use these entries if you want to parse `.osu` and `.osr`. They require the peer dependencies `osu-classes`, `osu-mania-stable`, and `osu-parsers`.

```ts
import { parse } from 'mania-judge/osu-parsers'

const result = await parse(beatmapContent, replayBuffer)
console.log(result.osuData)
```

```ts
import { parseFromPath } from 'mania-judge/osu-parsers/node'

const result = await parseFromPath('map.osu', 'score.osr')
console.log(result.osuData)
```
