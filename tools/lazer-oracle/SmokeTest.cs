using NUnit.Framework;
using osu.Framework.Testing;
using osu.Game.Tests.Visual;

namespace LazerOracle
{
    [HeadlessTest]
    [TestFixture]
    public partial class SmokeTest : RateAdjustedBeatmapTestScene
    {
        [Test]
        public void Smoke()
        {
            AddStep("noop", () => { });
            AddAssert("true", () => true);
        }
    }
}
