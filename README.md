# mania-judge

Simulates osu!mania judgements, combo, life and ScoreV1 from `.osu` + `.osr` data.

The design goal is a **faithful reproduction of osu!stable** rather than an approximation:
judgement is evaluated per column (each column only talks to its own notes and its own
input), and the whole run is judged first, then combo / life / score are derived from the
resulting judgement list.

- [中文说明](./README.zh-CN.md)
- [osu!v1 判定逻辑](./doc/osu-v1-mania-judgement.md)（中文）
- [osu!v1 时间轴逻辑](./doc/osu-v1-timeline.md)（中文）

## Install

```sh
npm install mania-judge
# or
pnpm add mania-judge
# or
yarn add mania-judge
```

ESM only, with bundled type declarations and no runtime dependencies.

## Status

Work in progress. Numbers below come from 97 replay fixtures (7K–18K mania maps) that are
compared against the counts / score / combo stored in the `.osr` header.

### v1 (osu!stable)

**Judgement** — column-based state machine driven by the replay's raw frame times.

- 90 / 97 fixtures match the header's six-tier counts exactly.
- The remaining 7 fixtures differ by 1–5 events out of 1.5k–14k objects (all 7K maps).
  This residual is **not** a deviation of this library from stable: the header stores the
  counts of the original play, while stable re-judges when replaying. On a full-map test
  (Life is Piano 7K, 1473 objects) the game's replay re-judgement gives
  783/508/138/**26**/8/**10** versus the header's 25/11, and matches this library exactly
  (max combo included). See [doc/osu-v1-mania-judgement.md](doc/osu-v1-mania-judgement.md).

**Timeline** — combo / life / ScoreV1 derived from the judgement list.

| Item | Exact | Note |
| --- | --- | --- |
| max combo | 73 / 97 | the rest are off by ±1 |
| ScoreV1 | 43 / 97 | the rest are off by a median of ±50 (≈0.01%), worst 1136 (0.15%) |

Judgement and timeline are tested separately (`tests/osu-v1-judgement.test.ts`,
`tests/osu-v1-timeline.test.ts`), with exact assertions and no tolerance.

### lazer

**tap-only is exact**: 38 / 38 fixtures match the header's six-tier counts, max combo exact on
37 / 38.

Long notes are implemented (head and tail judged separately, break → repress supported, tail capped
to Meh when the head was missed or the body broke) but **not exact yet**:

| Group | Exact | Total \|Δ\| | Per fixture |
| --- | --- | --- | --- |
| hold | 1 / 31 | 726 | ≈ 23 events |
| mods | 0 / 12 | 348 | ≈ 29 events |

The residual is pure misclassification between Perfect / Great / Good: the number of events and the
Miss / Meh totals match, and the error is the same size in both directions. It points at the timing
edge cases of the tail rather than at the event structure.

## Usage

```ts
import { v1, calcAccuracy } from 'mania-judge'

const judgements = v1.playOsu(osuData)
const frames = v1.generateFramesOsu(judgements, osuData.hp, ['HR'])
const last = frames.at(-1)!

console.log(last.resultCounts, last.maxCombo, last.life, last.score)
console.log(calcAccuracy(last.resultCounts, v1.accTable))
```

The third argument of `generateFramesOsu` is the replay's mod list; it only affects ScoreV1
(`NF` / `EZ` / `HT` halve the score).

```ts
// ScoreV1 on its own
const score = v1.calculateScoreV1(judgements.flat(), ['DT'])
```

### Loading a replay

This library has no runtime dependencies and does not touch files: it takes plain data, and
`createOsuData` accepts **any** object shape-compatible with `BeatmapLike` / `ReplayLike`.
With [`osu-mania-io`](https://github.com/zzzzv/osu-mania-io):

```ts
import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import { createOsuData } from 'mania-judge'

const beatmap = parseBeatmap(osuContent)
const replay = parseReplay(osrBuffer, beatmap.difficulty.keyCount)

// where mods get applied is up to you; the modded beatmap carries speedMultiplier / hitWindowScale
const effective = replay.mods !== 0
  ? (applyLegacyBeatmapMods(beatmap, replay.mods) ?? beatmap)
  : beatmap

const osuData = createOsuData(effective, replay)
```

Mod application stays outside the library on purpose: it needs the mod table, not the judging
engine.

## Development

- Copy `.env.example` to `.env` and point `OSU_STABLE_DIR` at your osu! install.
- Fixtures are generated from that install and are **not** committed:
  `node --env-file=.env --import tsx tests/gen-stable-json.ts <tap-only|hold|mods>`
  (same for `gen-lazer-json.ts`). A fresh clone has to generate them before `pnpm test`.
- `pnpm test` runs the whole suite. Judgement and timeline tests assert exact equality, so
  the failing cases are the current known gaps and are meant to be read as a to-do list.

## Credits

Thanks to [uuUlazis/osumania-replay-analyzer](https://github.com/uuUlazis/osumania-replay-analyzer):
the osu!stable judgement and scoring rules implemented here are ported from that project.
