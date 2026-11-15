# mania-judge

从 `.osu` + `.osr` 数据复现 osu!mania 的判定、连击、血量与 ScoreV1。

设计目标是**精确复刻 osu!stable**，而不是近似：判定按列计算（每一列只与自己的物件、
自己的输入发生关系），并且先完成全部判定，再据此派生连击 / 血量 / 分数。

- [English](./README.md)
- [osu!v1 判定逻辑](./doc/osu-v1-mania-judgement.md)
- [osu!v1 时间轴逻辑](./doc/osu-v1-timeline.md)

## 安装

```sh
npm install mania-judge
# 或
pnpm add mania-judge
# 或
yarn add mania-judge
```

只有 ESM 产物，自带类型声明，无运行时依赖。

## 现状

仍在开发中。下面的数字来自 97 张回放样本（7K–18K 的 mania 谱面），对照的是 `.osr`
文件头里记录的判定计数 / 分数 / 连击。

### v1（osu!stable）

**判定** —— 按列推进的状态机，驱动时钟来自回放的原始帧时间。

- **90 / 97** 张谱的六档判定计数与回放头完全一致。
- 剩下 7 张各差 1–5 个事件（物件总数 1.5k–14k，全部是 7K 谱）。同一套规则在
  [osumania4k_replay_analyser](https://github.com/SWt0619/osumania4k_replay_analyser) 里
  与本库逐物件比对是 **0 / 181,577** 差异，所以这部分残差是「两边共用的规则与 stable
  的偏差」，不是两个实现之间的差异。

**时间轴** —— 由判定结果派生连击 / 血量 / ScoreV1。

| 项目 | 完全一致 | 说明 |
| --- | --- | --- |
| 最大连击 | 73 / 97 | 其余差 ±1 |
| ScoreV1 | 43 / 97 | 其余中位偏差 ±50（约 0.01%），最大 1136（0.15%） |
| 血量 | — | `.osr` 不记录过程血条，没有真值可用 |

判定层与时间轴层的测试是分开的（`tests/osu-v1-judgement.test.ts`、
`tests/osu-v1-timeline.test.ts`），都使用精确断言、不留容差。

### lazer

**tap-only 已经是准的**：38 / 38 张谱的六档计数与回放头完全一致，最大连击 37 / 38 张精确。

长条已实现（头尾分开判定、支持断条后补按、头 miss 或断条时尾部封顶到 Meh），但**还不精确**：

| 分组 | 完全一致 | \|Δ\| 合计 | 每张谱 |
| --- | --- | --- | --- |
| hold | 1 / 31 | 726 | 约 23 个事件 |
| mods | 0 / 12 | 348 | 约 29 个事件 |

残差是纯粹的「Perfect / Great / Good 之间的错档」：事件总数对得上、Miss 与 Meh 的总数也对得上，
且两个方向的误差大小相当。这说明问题在尾判的时间边界细节，而不是事件结构。

## 用法

```ts
import { v1, calcAccuracy } from 'mania-judge'

const judgements = v1.playOsu(osuData)
const frames = v1.generateFramesOsu(judgements, osuData.hp, ['HR'])
const last = frames.at(-1)!

console.log(last.resultCounts, last.maxCombo, last.life, last.score)
console.log(calcAccuracy(last.resultCounts, v1.accTable))
```

`generateFramesOsu` 的第三个参数是回放的 mod 列表，只影响 ScoreV1（`NF` / `EZ` / `HT`
会把分数减半）。

```ts
// 单独算 ScoreV1
const score = v1.calculateScoreV1(judgements.flat(), ['DT'])
```

### 从文件加载回放

本库没有运行时依赖、也不碰文件，只接收普通数据；`createOsuData` 接受任何与
`BeatmapLike` / `ReplayLike` 结构兼容的对象，不绑定具体解析库。用
[`osu-mania-io`](https://github.com/zzzzv/osu-mania-io) 的话：

```ts
import { parseBeatmap } from 'osu-mania-io/beatmap'
import { parseReplay } from 'osu-mania-io/replay'
import { applyLegacyBeatmapMods } from 'osu-mania-io/mod'
import { createOsuData } from 'mania-judge'

const beatmap = parseBeatmap(osuContent)
const replay = parseReplay(osrBuffer, beatmap.difficulty.keyCount)

// mod 应用在哪一层由你决定；应用后的谱面会带 speedMultiplier / hitWindowScale
const effective = replay.mods !== 0
  ? (applyLegacyBeatmapMods(beatmap, replay.mods) ?? beatmap)
  : beatmap

const osuData = createOsuData(effective, replay)
```

mod 计算刻意留在库外：它需要的是 mod 表，不是判定引擎。

## 开发

- 把 `.env.example` 复制成 `.env`，把 `OSU_STABLE_DIR` 指向本机 osu! 安装目录。
- 样本由脚本从该目录生成，**不入库**：`node --env-file=.env --import tsx tests/gen-stable-json.ts <tap-only|hold|mods>`
  （lazer 用 `gen-lazer-json.ts`）。新克隆的仓库要先生成样本，`pnpm test` 才有数据。
- `pnpm test` 跑全量。判定层与时间轴层都是精确断言，**失败用例就是当前的已知差异清单**，
  应当当作待办来读，而不是把断言放宽。

## 致谢

感谢 [uuUlazis/osumania-replay-analyzer](https://github.com/uuUlazis/osumania-replay-analyzer)，
本项目的 osu!stable 判定与计分规则参考该项目实现。
