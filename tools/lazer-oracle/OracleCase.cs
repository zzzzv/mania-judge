using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using NUnit.Framework;
using osu.Framework.Audio;
using osu.Framework.Screens;
using osu.Framework.Testing;
using osu.Framework.Timing;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.ControlPoints;
using osu.Game.Beatmaps.Timing;
using osu.Game.Replays;
using osu.Game.Rulesets;
using osu.Game.Rulesets.Judgements;
using osu.Game.Rulesets.Mania;
using osu.Game.Rulesets.Mania.Beatmaps;
using osu.Game.Rulesets.Mania.Objects;
using osu.Game.Rulesets.Mania.Replays;
using osu.Game.Rulesets.Mania.Scoring;
using osu.Game.Rulesets.Mania.UI;
using osu.Game.Rulesets.Mods;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Scoring;
using osu.Game.Scoring;
using osu.Game.Screens.Play;
using osu.Game.Storyboards;
using osu.Game.Tests.Beatmaps;
using osu.Game.Tests.Visual;

namespace LazerOracle
{
    /// <summary>
    /// 用真正的 lazer 播一遍回放，逐条导出 JudgementResult。
    /// 输入：fixture JSON（osuData 部分）。输出：同名 .oracle.json。
    /// </summary>
    [HeadlessTest]
    [TestFixture]
    public partial class OracleCase : RateAdjustedBeatmapTestScene
    {
        private ReplayPlayer player = null!;
        private readonly List<JudgementResult> results = new();
        private IBeatmap playable = null!;
        private Replay currentReplay = null!;
        private readonly Stopwatch wall = new();
        private readonly StopwatchClock fastSource = new();
        private readonly FramedClock fastClock;

        public OracleCase()
        {
            fastClock = new FramedClock(fastSource);
        }

        protected override void Update()
        {
            base.Update();
            fastClock.ProcessFrame();
        }

        [Test]
        public void RunAll()
        {
            string inDir = Environment.GetEnvironmentVariable("ORACLE_DIR")!;
            string outDir = Environment.GetEnvironmentVariable("ORACLE_OUT_DIR")!;
            Directory.CreateDirectory(outDir);

            foreach (string inPath in Directory.GetFiles(inDir, "*.json").OrderBy(p => p, StringComparer.Ordinal))
            {
                string caseName = Path.GetFileNameWithoutExtension(inPath);
                string outPath = Path.Combine(outDir, caseName + ".oracle.json");

                if (File.Exists(outPath))
                    continue;

                AddStep($"build {caseName}", () =>
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(inPath));
                    var osuData = doc.RootElement.GetProperty("osuData");

                    double speedRate = osuData.TryGetProperty("speedRate", out var s) ? s.GetDouble() : 1;
                    double windowScale = osuData.TryGetProperty("windowScale", out var w) ? w.GetDouble() : 1;

                    var (raw, replay) = CaseBuilder.Build(osuData);
                    currentReplay = replay;
                    playable = CaseBuilder.Prepare(raw, speedRate * windowScale);

                    fastSource.Rate = SpinRate;
                    fastSource.Start();
                    Beatmap.Value = new OracleWorkingBeatmap(playable, fastClock, Audio);
                });

                AddStep("set ruleset", () => Ruleset.Value = playable.BeatmapInfo.Ruleset);
                AddStep("push player", () => pushPlayer());
                AddUntilStep("player loaded", () => player.IsCurrentScreen());
                AddStep("skip intro", () =>
                {
                    if (gameplayClock().CurrentTime < 0)
                        player.Seek(0);
                    wall.Restart();
                });

                // AddUntilStep 的超时固定是 10s，长谱面单步跑不完，所以按**已产生的结果条数**
                // 切片等待（时钟不可靠：GameplayClockContainer 可能跑在判定时钟前面）。
                int expectedRows = CaseBuilder.ReadExpectedRows(inPath);

                // 低倍速（rate 1）时判定按真实时间推进，一步能覆盖的行数远小于加速时
                int rowsPerPhase = SpinRate < 2 ? 80 : PhaseRows;
                int phases = Math.Max(4, (expectedRows + rowsPerPhase - 1) / rowsPerPhase);

                for (int phase = 1; phase <= phases; phase++)
                {
                    int target = (int)((long)expectedRows * phase / phases);

                    AddUntilStep($"judged {target}", () =>
                        player.GameplayState.HasCompleted || results.Count >= target);
                }

                AddUntilStep("all judged", () =>
                    player.GameplayState.HasCompleted || results.Count >= expectedRows);
                AddStep($"write {caseName}", () =>
                {
                    Console.WriteLine($"[oracle] {caseName}: {results.Count} results in {wall.ElapsedMilliseconds} ms (rate {SpinRate})");
                    File.WriteAllText(outPath, DumpJson(caseName));
                });
                AddStep("exit", () => player.Exit());
                AddUntilStep("exited", () => !player.IsCurrentScreen());
            }
        }

        /** 每个等待步最多推进多少条结果（每条约 0.5ms 墙钟）。 */
        private const int PhaseRows = 4000;

        /** 单步等待超时：低倍速（rate 1）真实回放时一步可能跑几十秒。 */
        private const int StepTimeout = 300_000;

        private GameplayClockContainer gameplayClock() => player.ChildrenOfType<GameplayClockContainer>().Single();

        private void pushPlayer()
        {
            var score = new Score
            {
                Replay = currentReplay,
                ScoreInfo = new ScoreInfo
                {
                    Ruleset = playable.BeatmapInfo.Ruleset,
                    BeatmapInfo = playable.BeatmapInfo,
                }
            };

            var p = new ReplayPlayer(score);
            p.OnLoadComplete += _ =>
            {
                p.GameplayState.ScoreProcessor.NewJudgement += r =>
                {
                    if (player == p)
                        results.Add(r);
                };
            };

            results.Clear();
            LoadScreen(player = p);
        }

        private static double SpinRate => double.Parse(Environment.GetEnvironmentVariable("ORACLE_RATE") ?? "100");

        private string DumpJson(string caseName)
        {
            var rows = results.Select(r => new Dictionary<string, object?>
            {
                ["part"] = PartOf(r.HitObject),
                ["column"] = r.HitObject is ManiaHitObject m ? m.Column : -1,
                ["start"] = r.HitObject.StartTime,
                ["end"] = r.HitObject.GetEndTime(),
                ["type"] = r.Type.ToString(),
                ["abs"] = r.TimeAbsolute,
            }).ToList();

            var sample = ((ManiaBeatmap)playable).HitObjects.Select(h => h.HitWindows).OfType<ManiaHitWindows>().FirstOrDefault();

            var processor = player?.GameplayState.ScoreProcessor;

            var meta = new
            {
                od = playable.Difficulty.OverallDifficulty,
                perfect = sample?.WindowFor(HitResult.Perfect) ?? -1,
                great = sample?.WindowFor(HitResult.Great) ?? -1,
                meh = sample?.WindowFor(HitResult.Meh) ?? -1,
                miss = sample?.WindowFor(HitResult.Miss) ?? -1,
                score = processor?.TotalScore.Value ?? 0,
                scoreWithoutMods = processor?.TotalScoreWithoutMods.Value ?? 0,
                accuracy = processor?.Accuracy.Value ?? 0,
                maxCombo = processor?.HighestCombo.Value ?? 0,
            };

            return JsonSerializer.Serialize(new { @case = caseName, meta, order = rows });
        }

        private static string PartOf(HitObject h) => h switch
        {
            HeadNote => "head",
            TailNote => "tail",
            HoldNoteBody => "body",
            HoldNote => "hold",
            Note => "note",
            _ => h.GetType().Name,
        };

        protected override WorkingBeatmap CreateWorkingBeatmap(IBeatmap beatmap, Storyboard storyboard = null)
            => new OracleWorkingBeatmap(beatmap, fastClock, Audio);

        private class OracleWorkingBeatmap : ClockBackedTestWorkingBeatmap
        {
            private readonly IBeatmap playable;

            public OracleWorkingBeatmap(IBeatmap playable, IFrameBasedClock clock, AudioManager audio)
                : base(playable, null, clock, audio)
            {
                this.playable = playable;
            }

            public override IBeatmap GetPlayableBeatmap(IRulesetInfo ruleset, IReadOnlyList<Mod> mods, CancellationToken token) => playable;
        }
    }

    public static class CaseBuilder
    {
        /// <summary>
        /// 这一局最终会产生多少条判定结果：tap 1 条，长条 4 条（head / tail / body / 本体）。
        /// 用来分片等待，避免单步超过 10s。
        /// </summary>
        public static int ReadExpectedRows(string fixturePath)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(fixturePath));
            int rows = 0;

            foreach (var column in doc.RootElement.GetProperty("osuData").GetProperty("noteColumns").EnumerateArray())
            {
                foreach (var note in column.EnumerateArray())
                {
                    bool isHold = note.TryGetProperty("end", out var e) && e.ValueKind == JsonValueKind.Number;
                    rows += isHold ? 4 : 1;
                }
            }

            return rows;
        }

        public static (IBeatmap raw, Replay replay) Build(JsonElement osuData)
        {
            double od = osuData.GetProperty("od").GetDouble();
            double hp = osuData.GetProperty("hp").GetDouble();

            var allNoteColumns = osuData.GetProperty("noteColumns");
            int keyCount = allNoteColumns.GetArrayLength();

            var maniaInfo = new ManiaRuleset().RulesetInfo;
            // 参数化构造出的 RulesetInfo.ShortName 是空的，会让 ManiaBeatmapConverter 走「非当前 ruleset」的重排分支。
            maniaInfo.ShortName = ManiaRuleset.SHORT_NAME;
            maniaInfo.Name = "osu!mania";

            var beatmap = new ManiaBeatmap(new StageDefinition(keyCount));
            beatmap.BeatmapInfo.Ruleset = maniaInfo;
            // 必须走 Beatmap.Difficulty（它会把 clone 同步到 BeatmapInfo.Difficulty）
            beatmap.Difficulty = new BeatmapDifficulty
            {
                OverallDifficulty = (float)od,
                DrainRate = (float)hp,
                CircleSize = keyCount,
                ApproachRate = 5,
                SliderMultiplier = 1.4f,
                SliderTickRate = 1,
            };
            beatmap.BeatmapInfo.ID = Guid.Empty;
            beatmap.ControlPointInfo.Add(0, new TimingControlPoint { Time = 0, BeatLength = 500, TimeSignature = new TimeSignature(4) });

            foreach (var column in allNoteColumns.EnumerateArray())
            {
                foreach (var note in column.EnumerateArray())
                {
                    int col = note.GetProperty("column").GetInt32();
                    double start = note.GetProperty("start").GetDouble();

                    if (note.TryGetProperty("end", out var endEl) && endEl.ValueKind == JsonValueKind.Number)
                        beatmap.HitObjects.Add(new HoldNote { StartTime = start, EndTime = endEl.GetDouble(), Column = col });
                    else
                        beatmap.HitObjects.Add(new Note { StartTime = start, Column = col });
                }
            }

            // ── 回放帧：直接吃 fixture 的原始行表 `[time, mask]`（一行一次推进，不去重不排序） ──
            var replay = new Replay();

            foreach (var row in osuData.GetProperty("frames").EnumerateArray())
            {
                double t = row[0].GetDouble();
                int mask = row[1].GetInt32();

                var actions = new List<ManiaAction>();
                for (int i = 0; i < keyCount; i++)
                {
                    if ((mask & (1 << i)) != 0)
                        actions.Add(ManiaAction.Key1 + i);
                }

                replay.Frames.Add(new ManiaReplayFrame(t, actions.ToArray()));
            }

            // 补一个收尾帧：回放最后一行之后时钟要继续走，才能把剩余物件判成漏接
            double lastObjectEnd = beatmap.HitObjects.Count == 0 ? 0 : beatmap.HitObjects.Max(h => h.GetEndTime());
            double tailTime = lastObjectEnd + 2000;

            if (replay.Frames.Count == 0 || replay.Frames[^1].Time < tailTime)
                replay.Frames.Add(new ManiaReplayFrame(tailTime));

            replay.HasReceivedAllFrames = true;

            return (beatmap, replay);
        }

        /// <summary>
        /// 生成可玩谱面，并把 rate/window 合成倍率灌进每个 ManiaHitWindows。
        /// fixture 的时间轴已是 mod 之后的时基，故此处不施加任何 mod。
        /// </summary>
        public static IBeatmap Prepare(IBeatmap raw, double windowMultiplier)
        {
            var mb = (ManiaBeatmap)raw;

            // 不走 BeatmapConverter：本工程直接构造 mania 物件，转换器只会重排列数。
            mb.HitObjects.Sort((a, b) => a.StartTime.CompareTo(b.StartTime));

            foreach (var h in mb.HitObjects)
                h.ApplyDefaults(mb.ControlPointInfo, mb.Difficulty);

            foreach (var h in mb.HitObjects)
                patch(h, windowMultiplier);

            Console.WriteLine($"[oracle] playable objs={mb.HitObjects.Count} cols={mb.TotalColumns} "
                              + $"maxcol={mb.HitObjects.Max(h => h.Column)} od={mb.Difficulty.OverallDifficulty}");

            return mb;
        }

        private static void patch(HitObject h, double m)
        {
            if (h.HitWindows is ManiaHitWindows mhw)
            {
                mhw.DifficultyMultiplier = 1;
                mhw.SpeedMultiplier = m;
            }

            if (h is HoldNote hold)
            {
                patch(hold.Head, m);
                patch(hold.Tail, m);
            }
        }
    }
}
