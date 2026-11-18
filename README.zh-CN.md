# mania-judge

从 `.osu` + `.osr` 数据复现 osu!mania 的判定、连击、血量与分数 —— **osu!stable（V1）** 与
**osu!lazer** 两套规则都有（分别是 ScoreV1 与标准分）。

设计目标是**精确复刻**，而不是近似：判定按列计算（每一列只与自己的物件、自己的输入发生关系），
并且先完成全部判定，再据此派生连击 / 血量 / 分数。

- [English](./README.md)
- [osu!v1（stable）规则](./doc/osu-v1.md)
- [osu!lazer 规则](./doc/osu-lazer.md)

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

下面的数字来自回放样本（7K–18K 的 mania 谱面），对照的是 `.osr` 抬头里记录的判定计数 / 连击 /
分数。抬头记的是当初游玩那一刻，而播放回放时会重新判定，所以它只是近似基准 —— 详见
[doc/osu-v1.md](doc/osu-v1.md) 与 [doc/osu-lazer.md](doc/osu-lazer.md)。

### v1（osu!stable）

| 项目 | 完全一致 | 偏差 |
| --- | --- | --- |
| 六档计数 | 94 / 97 | 其余 3 张各差 2 个事件（一升一降，net 为 0） |
| 最大连击 | 90 / 97 | 1–5 |
| ScoreV1 | 47 / 97 | 中位 49，最大 1136 |

v1 的分数残差集中在长条谱：health 的写入路径只掌握了一部分（单点谱 39 / 40 精确）。

### lazer

| 项目 | 完全一致 | 偏差 |
| --- | --- | --- |
| 六档计数 | tap-only 77 / 78 · LN 3 / 31 · mods 0 / 17 | LN 合计 626 个事件（每张约 20），mods 合计 436 个（每张约 26） |
| 最大连击 | 71 / 78 · 24 / 31 · 13 / 17 | 0–2 |
| 标准分 | 20 / 78 · 0 / 31 · 0 / 17 | 中位 0 / 91 / −28，最大 1106 / 1741 / 948 |

lazer 的残差是「Perfect / Great / Good 之间的错档」：事件总数与 Miss / Meh 总数对得上，两个方向的
误差大小相当；分数那一列被连击项放大。两套规则都用精确断言、不留容差，失败的样本就是待办清单
（`tests/osu-v1-*.test.ts`、`tests/osu-lazer-*.test.ts`）。

## 用法

```ts
import { v1, calcAccuracy } from 'mania-judge'

const judgements = v1.playOsu(osuData)
const frames = v1.generateFramesOsu(judgements, osuData.hp)
const last = frames.at(-1)!

console.log(last.resultCounts, last.maxCombo, last.life, last.score)
console.log(calcAccuracy(last.resultCounts, v1.accTable))
```

`generateFramesOsu` / `calculateScoreV1` 的第三个参数是**分数倍率**：可以直接给数字，也可以给
mod 缩写列表让规则集自己换算。`v1` 只认 `NF` / `EZ` / `HT`（各 ×0.5）：

```ts
v1.generateFramesOsu(judgements, osuData.hp, ['HT'])   // 0.5
v1.generateFramesOsu(judgements, osuData.hp, 0.5)      // 等价
v1.calculateScoreV1(judgements.flat(), ['HT'])
v1.scoreMultiplier(['HT'])                             // 0.5
```

lazer 侧的入口形状相同，只是多了血量与标准分：

```ts
import { lazer } from 'mania-judge'

const judgements = lazer.playOsu(osuData)
const frames = lazer.generateFramesOsu(judgements, osuData.hp)

console.log(frames.at(-1)!.score)  // TotalScoreWithoutMods，0 ~ 1,000,000
console.log(frames.at(-1)!.life)   // 0 ~ 1
```

第三个参数同样是分数倍率，但按 mania 的倍率表换算（`HT` 0.3、`EZ` + `HT` 0.15、`DT` 1）：

```ts
lazer.generateFramesOsu(judgements, osuData.hp, ['HT'])   // TotalScore
lazer.generateFramesOsu(judgements, osuData.hp, 0.3)      // 等价
lazer.scoreMultiplier(['HT'])                             // 0.3
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

// mod 应用在哪一层由你决定；应用后的谱面会带 speedMultiplier / difficultyMultiplier
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
- 样本里的回放行表存成 `[time, mask]`（mask 第 i 位 = 第 i 列按下），测试用
  `tests/fixture-frames.ts` 的 `toOsuData` 展开成 `OsuData`。
- `pnpm test` 跑全量。判定层与时间轴层都是精确断言，**失败用例就是当前的已知差异清单**，
  应当当作待办来读，而不是把断言放宽。


### 排查工具

| 工具 | 用途 |
| --- | --- |
| `pnpm check:osr-stats <tap-only\|hold\|mods> [--verbose] [--timeline]` | 整谱冒烟门禁：六档计数与精度对照 `.osr` 抬头；加 `--timeline` 再给 `maxCombo` / 分数的偏差统计 |
| `pnpm probe:slice <fixture.json> <输出目录> [秒数=30]` | 把真实回放切成短片段探针（自动带 500ms 前导状态） |
| `pnpm probe:compare <fixture目录> <oracle目录>` | 逐物件对比本库与真 lazer 的判定结果 |
| `pnpm tosu:capture <输出.json> [--interval 20]` | 通过 [tosu](https://github.com/tosuapp/tosu) 抓游戏内实时判定计数 |

`tools/lazer-oracle` 用无头方式跑真 lazer 判定并导出逐物件结果，`tools/lazer-index` 导出本机
lazer 分数索引用于生成样本。整谱真值跑得慢且会歪曲 tick 网格，**优先用片段**（30s 片段约 3s）。

关于 `.osr` 抬头：它记录的是**当初游玩那一刻**的判定，可能来自旧版客户端；lazer 用当前代码重播
同一份回放并不能逐条复现（已用游戏内实测确认）。所以它只能当冒烟门禁，精确对账请用片段 oracle。

## 致谢

感谢 [uuUlazis/osumania-replay-analyzer](https://github.com/uuUlazis/osumania-replay-analyzer)，
本项目的 osu!stable 判定与计分规则参考该项目实现。
