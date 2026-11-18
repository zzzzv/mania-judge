using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

using OsuLazer.Interop;

namespace LazerIndex;

/// <summary>一条 mania 分数，字段与判定/筛选需要的信息保持一致。</summary>
internal sealed record ScoreEntry(
    string Id,
    string? BeatmapHash,
    string? BeatmapPath,
    string? ReplayPath,
    long PlayedAt,
    int MaxCombo,
    double Accuracy,
    long TotalScore,
    string? ModsJson,
    string Rank);

internal sealed record IndexDocument(
    string DataDirectory,
    string ClientVersion,
    IReadOnlyList<ScoreEntry> Scores);

/// <summary>
/// 把本机 osu!lazer 的 mania 分数导出成一份索引 JSON。
/// 只做「读 realm + 定位文件」，解析谱面/回放、筛选条件、写 fixture 都在 TypeScript 侧。
/// </summary>
internal static class Program
{
    private const string Usage = """
        usage: lazer-index [--out <path>]

        读取本机 osu!lazer 的 client.realm，把 mania 分数导出成索引 JSON。
        --out  输出路径；省略时写到 stdout。
        """;

    private const string ManiaFilter = "Ruleset.ShortName == \"mania\"";

    /// <summary>展开深度 2 只为了拿到 Files → File.Hash，其他引用型字段一律不展开。</summary>
    private static readonly HashSet<string> SuppressedFields =
    [
        "User",
        "RealmUser",
        "BeatmapInfo",
        "Statistics",
        "MaximumStatistics",
        "Mods",
        "APIMods",
        "HitEvents",
        "HealthGraph",
        "Pauses",
        "Rank",
        "Filename",
    ];

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static int Main(string[] args)
    {
        string? outputPath = null;

        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--out" or "-o":
                    if (++index >= args.Length)
                        return Fail("--out 需要一个路径参数");
                    outputPath = args[index];
                    break;

                case "--help" or "-h":
                    Console.WriteLine(Usage);
                    return 0;

                default:
                    return Fail($"未知参数：{args[index]}");
            }
        }

        if (!LazerHost.IsInstalled)
            return Fail($"未找到 osu!lazer：{LazerHost.LazerDirectory}");

        if (!LazerHost.TryInitialize(out var initializeError))
            return Fail(initializeError ?? "osu!lazer 初始化失败");

        var database = new LazerDatabase();
        if (!database.Exists)
            return Fail($"未找到 client.realm：{database.ClientRealmPath}");

        var scores = ReadScores(database, new LazerFileStore(database.DataDirectory));
        var document = new IndexDocument(database.DataDirectory, LazerHost.ClientVersion ?? "unknown", scores);
        var json = JsonSerializer.Serialize(document, SerializerOptions);

        if (outputPath is null)
            Console.Out.Write(json);
        else
            File.WriteAllText(outputPath, json);

        Console.Error.WriteLine(
            $"lazer {document.ClientVersion}：{scores.Count} 条 mania 分数 -> {outputPath ?? "stdout"}");
        return 0;
    }

    private static List<ScoreEntry> ReadScores(LazerDatabase database, LazerFileStore fileStore)
    {
        var entries = new List<ScoreEntry>();

        foreach (var item in database.Query(LazerEntity.Scores, ManiaFilter, depth: 2, SuppressedFields))
        {
            if (item is not IDictionary<string, object?> score)
                continue;

            var beatmapHash = ReadString(score, "BeatmapHash");
            var replayHash = ReadReplayHash(score);

            entries.Add(new ScoreEntry(
                Id: ReadGuid(score, "ID"),
                BeatmapHash: beatmapHash,
                BeatmapPath: ResolvePath(fileStore, beatmapHash),
                ReplayPath: ResolvePath(fileStore, replayHash),
                PlayedAt: ReadUnixTime(score, "Date"),
                MaxCombo: ReadNumber(score, "MaxCombo"),
                Accuracy: ReadDouble(score, "Accuracy"),
                TotalScore: ReadNumber(score, "TotalScore"),
                ModsJson: ReadString(score, "ModsJson"),
                Rank: ReadRank(score)));
        }

        // 新的在前；同一毫秒的按 ID 兜底，保证每次导出顺序一致。
        entries.Sort((left, right) =>
        {
            var byDate = right.PlayedAt.CompareTo(left.PlayedAt);
            return byDate != 0 ? byDate : string.CompareOrdinal(right.Id, left.Id);
        });

        return entries;
    }

    /// <summary>回放文件是 <c>Files[0].File</c>，展开后可能是字典、字符串或对象引用。</summary>
    private static string? ReadReplayHash(IDictionary<string, object?> score)
    {
        if (!score.TryGetValue("Files", out var value) || value is not IEnumerable<object> files)
            return null;

        foreach (var entry in files)
        {
            var fileReference = entry is IDictionary<string, object?> usage && usage.TryGetValue("File", out var file)
                ? file
                : entry;

            var hash = ExtractHash(fileReference);
            if (hash is not null)
                return hash;
        }

        return null;
    }

    private static string? ExtractHash(object? fileReference) => fileReference switch
    {
        string text when TryReadHashFromReference(text) is { } hash => hash,
        IDictionary<string, object?> dictionary when dictionary.TryGetValue("Hash", out var hash) => hash as string,
        _ => null,
    };

    private static string? TryReadHashFromReference(string text)
    {
        var match = Regex.Match(text, "Hash\\s*=\\s*([0-9a-fA-F]{64})");
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }

    private static string? ResolvePath(LazerFileStore fileStore, string? hash) =>
        fileStore.TryGetFilePath(hash, out var path) ? path : null;

    /// <summary>主键 <c>ID</c> 是 <see cref="Guid"/>，不是字符串，转成 "D" 形式方便直接当键用。</summary>
    private static string ReadGuid(IDictionary<string, object?> score, string key) =>
        score.TryGetValue(key, out var value) && value is Guid guid ? guid.ToString("D") : string.Empty;

    private static string? ReadString(IDictionary<string, object?> score, string key) =>
        score.TryGetValue(key, out var value) ? value as string : null;

    private static int ReadNumber(IDictionary<string, object?> score, string key) =>
        score.TryGetValue(key, out var value) && value is not null
            ? Convert.ToInt32(value, CultureInfo.InvariantCulture)
            : 0;

    private static double ReadDouble(IDictionary<string, object?> score, string key) =>
        score.TryGetValue(key, out var value) && value is not null
            ? Convert.ToDouble(value, CultureInfo.InvariantCulture)
            : 0;

    /// <summary>
    /// <c>ScoreInfo.Passed</c> 是 [Ignored] 的（Realm 不存它，反射读到的永远是默认值 true），
    /// 失败与否只能靠持久化的 <c>RankInt</c> 判断：-1 是 F，0..7 是 D,C,B,A,S,SH,X,XH。
    /// </summary>
    private static readonly string[] RankNames = ["D", "C", "B", "A", "S", "SH", "X", "XH"];

    private static string ReadRank(IDictionary<string, object?> score)
    {
        var rank = ReadNumber(score, "RankInt");
        return rank >= 0 && rank < RankNames.Length ? RankNames[rank] : "F";
    }

    private static long ReadUnixTime(IDictionary<string, object?> score, string key) => score.TryGetValue(key, out var value)
        ? value switch
        {
            DateTimeOffset time => time.ToUnixTimeMilliseconds(),
            DateTime time => new DateTimeOffset(time.ToUniversalTime()).ToUnixTimeMilliseconds(),
            string text when DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
                => parsed.ToUnixTimeMilliseconds(),
            _ => 0,
        }
        : 0;

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
