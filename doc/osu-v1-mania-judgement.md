# osu!v1（stable）mania 判定逻辑

本文描述 `src/osu-v1/frames.ts` 里实际使用的判定逻辑。目标是复刻 osu!stable：**按列**推进、
判定时刻取回放帧，而不是用连续的理想时间。

## 输入

判定需要三样东西（都在 `OsuData` 里）：

| 字段 | 内容 |
| --- | --- |
| `noteColumns` | 每列的物件，按 `start` 升序；长条额外带 `end` |
| `actionColumns` | 每列的按键区间 `{ press, release }`，由回放的按键掩码边沿折叠而来 |
| `frameTimes` | 回放原始帧时间（升序去重） |

`frameTimes` 是必填字段：stable 的判定逐帧推进，物件的结算时刻是「不早于边界的第一帧」，
不是边界本身。`.osr` 一定带帧，`createOsuData` 会自动填成 `replayToFrameTimes(replay.frames)`。

## 判定窗口

基础窗口由 OD 决定（`baseWindows`）：

```
MAX  = 16
300  = 64 - 3 * OD
200  = 97 - 3 * OD
100  = 127 - 3 * OD
50   = 151 - 3 * OD
到期 = 188 - 3 * OD   （也是「最大提前输入」）
```

再乘以 `speedRate * windowScale`（DT/HT 与 HR/EZ 的作用），**乘完向下取整**——stable 的窗口
是整数，缩放之后同样取整。

## 关键帧

stable 每帧都推进，但真正会改变判定的只有两类时刻：

1. 按键边沿（`press` / `release`）；
2. 物件边界落到的那一帧。

所以这里不逐帧扫，而是把这些时刻收进一个集合逐帧重演。边界到帧的映射规则是
**「不早于该边界的第一个帧」**：

```
start - early        // 进入判定范围
start + W50          // 停止自动结算的起点
start + W50 + 1      // 变暗生效（dim 在 now > start + W50 时才为真）
end - W50            // 提前松手的下限
end + W50            // 按住时可以继续等
end + W100           // 到期
tick 网格（press + 100k）
```

少了任何一条都会错一档，尤其是 `start + W50 + 1`（变暗生效帧）。

## 每帧的列内处理

每一列完全独立：有自己的输入状态、自己的物件游标。每帧的顺序是固定的：

1. 更新这一列的 `held` / `wasHeld`（本帧是否按下、上一帧是否按下）；
2. 清空本帧的 `consumed`（一帧一列最多消费一个物件）；
3. 从游标处开始扫描该列尚未完结的物件。

对每个物件：

| 情况 | 处理 |
| --- | --- |
| 已判定且 `start > now` | **封锁整列**（后面的物件本帧都不再处理） |
| 本帧该列已被消费 | 跳过 |
| `now < start - early` | 跳过（还没进入判定范围） |
| `now >= end + W100` | 到期结算：未判定的直接判（正常就是 MISS） |
| 新按下边沿（`held && !wasHeld`） | 单点：记按下并判定；长条：记按下、判头、开始算 tick |
| 持续按住（`held && wasHeld`） | 只对长条生效：推进 tick |
| 已松开 | 长条且正按着 → 结算；其余情况等待变暗后结算 |

到期检查排在任何按键处理之前，这是 stable 的顺序——「先结算再过边沿」。

## 单点判定

按下时用 `|press - start|` 依次对照 MAX / 300 / 200 / 100 / 50 窗口，命中第一个满足
`<=` 的档位；没命中就是 MISS。到期仍未按下也是 MISS。

## 长条判定（V1：头尾合并）

V1 的长条只产生**一个**判定，用头和尾的合成误差决定档位。

先算两个「有效时刻」：

```
press < start - W50   → effStart = end - 1        （早得离谱，等于「没按头」）
press < start         → effStart = start + (start - press)   （提前按，按镜像算）
否则                   → effStart = press

仍按住                 → effEnd = now
release > end         → effEnd = end - (release - end)       （晚松，按镜像算）
否则                   → effEnd = release
```

再算 `headErr = |effStart - start|`、`tailErr = |effEnd - end|`、`combined = headErr + tailErr`：

| 档位 | 条件 |
| --- | --- |
| MISS | `effEnd < end - W50`（尾部根本没按住） |
| MAX | `headErr <= Wmax * 1.2` 且 `combined <= Wmax * 2.4` |
| 300 | `headErr <= W300 * 1.1` 且 `combined <= W300 * 2.2` |
| 200 | `headErr <= W200` 且 `combined <= W200 * 2` |
| 100 | `headErr <= W100` 且 `combined <= W100 * 2` |
| 50 | 其余 |

**破条（提前松手）封顶 200**：只要在 `end - W50` 之前松过手，最终判定最高只能是 200。

### 三个守卫（决定「什么时候才允许写判定」）

1. 还没到 `start + W50` 且从未按下 → 不判；
2. 还没到 `end - W50`：若正按着，继续等；若已松开，则记一次 **break**（`breakTime`），
   **不写判定**，之后可以再按回来；
3. 还按着且 `now < end + W50` → 继续等。

break 不是判定：它不进六档计数，但在时间轴里会把连击清零。

### tick

长条按住时每 100ms 产生一个 tick：

- 网格从**按下时刻**起算，每次只前进一格（`lastTick += 100`，不是重置成 `now`）；
- 判定条件是 `lastTick != -1 && start <= now <= end && now - lastTick >= 100`；
- tick 只加连击和血量，不进六档计数、不加分。

## 变暗与结算

`now > start + W50` 且未按住、未判定的物件会变暗（`isDimmed`）。变暗之后不再自动结算，
等玩家有输入时再看（松手会触发结算，按下会重新接上）。

回放结束后仍未判定的物件，按

```
max(end + W100, end + W50 + 1, start + W50 + 1)
```

补判。补判出来的 MISS，判定时刻会**回填到变暗那一帧**——stable 是在变暗时就把它判死的，
不回填会让所有漏接挤到回放结尾，连击断点全错。

## 已知偏差

- 97 张样本里 90 张档位计数完全一致。
- 剩 7 张（都是 7K）各差 1–5 个事件，net 差为 0，属于同一张谱不同回放时偶发。
- 同一套规则在
  [osumania4k_replay_analyser](https://github.com/SWt0619/osumania4k_replay_analyser)
  里与本实现逐物件比对为 0 / 181,577，说明残差来自「两边共用的规则 vs stable」，
  而不是两个实现之间的差异。
