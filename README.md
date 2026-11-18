# mania-judge

Simulates osu!mania judgements, combo, life and score from `.osu` + `.osr` data — for both
**osu!stable (V1)** and **osu!lazer** (ScoreV1 and the standardised score respectively).

The design goal is a **faithful reproduction** rather than an approximation: judgement is
evaluated per column (each column only talks to its own notes and its own input), and the whole
run is judged first, then combo / life / score are derived from the resulting judgement list.

- [中文说明](./README.zh-CN.md)
- [osu!v1（stable）规则](./doc/osu-v1.md)（中文）
- [osu!lazer 规则](./doc/osu-lazer.md)（中文）

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

Numbers come from replay fixtures (7K–18K mania maps), compared against the counts / combo / score
stored in the `.osr` header. The header records the original play, while replaying re-judges, so
treat it as an approximate baseline — see [doc/osu-v1.md](doc/osu-v1.md) and
[doc/osu-lazer.md](doc/osu-lazer.md).

### v1 (osu!stable)

| Item | Exact | Deviation |
| --- | --- | --- |
| six-tier counts | 94 / 97 | the other 3 differ by two events each (one up, one down, net 0) |
| max combo | 90 / 97 | 1–5 |
| ScoreV1 | 47 / 97 | median 49, worst 1136 |

The v1 score residual is concentrated on long-note maps: the health write path is only partly known
(single-tap maps are 39 / 40 exact).

### lazer

| Item | Exact | Deviation |
| --- | --- | --- |
| six-tier counts | tap-only 77 / 78 · LN 3 / 31 · mods 0 / 17 | LN 626 events in total (≈ 20 per fixture), mods 436 (≈ 26) |
| max combo | 71 / 78 · 24 / 31 · 13 / 17 | 0–2 |
| standardised score | 20 / 78 · 0 / 31 · 0 / 17 | median 0 / 91 / −28, worst 1106 / 1741 / 948 |

The lazer residual is misclassification between Perfect / Great / Good — the total event count and
the Miss / Meh totals match, and the error is the same size in both directions; the score figure is
amplified by the combo term. Both rulesets are tested with exact assertions and no tolerance, so
failing fixtures are the known-gap list (`tests/osu-v1-*.test.ts`, `tests/osu-lazer-*.test.ts`).

## Usage

```ts
import { v1, calcAccuracy } from 'mania-judge'

const judgements = v1.playOsu(osuData)
const frames = v1.generateFramesOsu(judgements, osuData.hp)
const last = frames.at(-1)!

console.log(last.resultCounts, last.maxCombo, last.life, last.score)
console.log(calcAccuracy(last.resultCounts, v1.accTable))
```

The third argument of `generateFramesOsu` / `calculateScoreV1` is the **score multiplier**: pass a
number directly, or pass the mod list and let the ruleset resolve it. `v1` only reacts to
`NF` / `EZ` / `HT` (each ×0.5):

```ts
v1.generateFramesOsu(judgements, osuData.hp, ['HT'])   // 0.5
v1.generateFramesOsu(judgements, osuData.hp, 0.5)      // same thing
v1.calculateScoreV1(judgements.flat(), ['HT'])
v1.scoreMultiplier(['HT'])                             // 0.5
```

For lazer the same shape works, with life and the standardised score:

```ts
import { lazer } from 'mania-judge'

const judgements = lazer.playOsu(osuData)
const frames = lazer.generateFramesOsu(judgements, osuData.hp)

console.log(frames.at(-1)!.score)  // TotalScoreWithoutMods, 0 ~ 1,000,000
console.log(frames.at(-1)!.life)   // 0 ~ 1
```

Same third argument, resolved with the mania mod table (`HT` 0.3, `EZ` + `HT` 0.15, `DT` 1):

```ts
lazer.generateFramesOsu(judgements, osuData.hp, ['HT'])   // TotalScore
lazer.generateFramesOsu(judgements, osuData.hp, 0.3)      // same
lazer.scoreMultiplier(['HT'])                             // 0.3
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

// where mods get applied is up to you; the modded beatmap carries speedMultiplier / difficultyMultiplier
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
- The replay row table is stored as `[time, mask]` (bit i = column i pressed); tests expand it
  into `OsuData` with `toOsuData` from `tests/fixture-frames.ts`.
- `pnpm test` runs the whole suite. Judgement and timeline tests assert exact equality, so
  the failing cases are the current known gaps and are meant to be read as a to-do list.

### Ruleset docs

- `doc/osu-v1.md` — osu!stable (V1): judgement, timeline, accuracy
- `doc/osu-lazer.md` — osu!lazer: judgement, timeline, accuracy (against the `.osr` header, the real
  lazer source and a real in-game replay verification)

### Debug tools

| Tool | Purpose |
| --- | --- |
| `pnpm check:osr-stats <tap-only\|hold\|mods> [--verbose] [--timeline]` | whole-map smoke gate: six-bucket counts and accuracy vs the `.osr` header; `--timeline` adds `maxCombo` and score deviation stats |
| `pnpm probe:slice <fixture.json> <outDir> [seconds=30]` | cut a real replay into short segment probes (keeps 500ms of lead-in state) |
| `pnpm probe:compare <fixtureDir> <oracleDir>` | per-object diff between this library and real lazer dumps |
| `pnpm tosu:capture <out.json> [--interval 20]` | record live in-game judgement counts via [tosu](https://github.com/tosuapp/tosu) |

`tools/lazer-oracle` runs the real lazer judging code headless and dumps per-object results;
`tools/lazer-index` exports the local lazer score index used to build fixtures. Whole-map dumps
are slow and skew the tick grid — prefer segments (a 30s segment takes ~3s).

Note on `.osr` statistics: they record the judgement **at play time**, possibly from an older
build. lazer re-judges the same replay with current code and does not reproduce them exactly
(verified against a real in-game capture), so they are only a smoke gate — use the segment
oracle for exact comparison.

## Credits

Thanks to [uuUlazis/osumania-replay-analyzer](https://github.com/uuUlazis/osumania-replay-analyzer):
the osu!stable judgement and scoring rules implemented here are ported from that project.
