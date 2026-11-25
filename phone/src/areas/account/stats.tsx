// Statistics (/profile/statistics: stat tiles per game, personal bests, recent quiz games) and Achievements
// (/profile/achievements: badge grid with locked/earned states and progress; tap opens a detail sheet).
// Numbers come from the server (or the demo engine); this file only displays them.
import { useState } from "react";
import { api } from "@shared/api";
import { useLoad } from "@shared/components";
import type { Achievement, AchievementCategory, AchievementTier, EliminationPuzzle, Mode } from "@shared/domain";
import {
  GameId,
  GameStat,
  GameStats,
  PersonalBest,
  bestScore,
  describeSetup,
  formatClock,
  gameNames,
  modeNames as gameModeNames,
} from "@shared/game-setup";
import { Icon, IconName, IconTile, games as gameIcons, iconNames } from "@shared/icons";
import { accuracy, modeNames } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  BottomSheet,
  Burst,
  Card,
  LinkGameButton,
  LoadingState,
  ProgressBar,
  Section,
  SegmentOption,
  SegmentedControl,
  StatGrid,
  StatTile,
  StatusMessage,
} from "@phone/ui";
import { LoadError, isOnlineOnly, readableError } from "./helpers";

const gameList: { id: GameId; to: string; unit: string }[] = [
  { id: "flags", to: paths.flags, unit: "flags recognised" },
  { id: "capitals", to: paths.capitals, unit: "countries answered right" },
  { id: "recall", to: paths.recall, unit: "places named" },
];

const emptyStat: GameStat = { rounds: 0, correct: 0, answered: 0, timeMs: 0, lastPlayedAt: null, places: 0 };

async function loadStatistics() {
  const [dashboard, stats, bests] = await Promise.all([api.dashboard(), api.gameStats(), api.personalBests()]);
  const read = (game: GameId): GameStat => ({
    ...emptyStat,
    ...(stats && typeof stats === "object" ? (stats as Partial<GameStats>)[game] : null),
  });
  return {
    dashboard,
    stats: { flags: read("flags"), capitals: read("capitals"), recall: read("recall") } as GameStats,
    bests: Array.isArray(bests) ? bests : ([] as PersonalBest[]),
  };
}

export function StatisticsScreen() {
  usePhoneChrome({ title: "Statistics", back: paths.profile });
  const { data, error, reload } = useLoad(loadStatistics);
  const [game, setGame] = useState<BestFilter>("all");
  if (error) return <LoadError message={error} retry={reload} />;
  if (!data) return <LoadingState label="Loading your statistics…" />;

  const { dashboard, stats, bests } = data;
  const visibleBests = bests.filter((best) => game === "all" || best.game === game);
  const countFor = (id: GameId) => bests.filter((best) => best.game === id).length;
  const bestOptions: SegmentOption<BestFilter>[] = [
    { value: "all", label: "All" },
    ...gameList.map((item) => ({ value: item.id, label: gameNames[item.id] })),
  ];
  return (
    <>
      <Section title="Quiz">
        <Card as="article" className="ph-account-game">
          <div className="ph-account-card-head">
            <IconTile name={gameIcons.quiz.icon} tone={gameIcons.quiz.tone} size="sm" />
            <h3>Quiz</h3>
          </div>
          <StatGrid label="Quiz statistics">
            <StatTile label="Completed games" icon="check" tone="quiz" value={dashboard.totals.games} />
            <StatTile
              label="Accuracy"
              icon="target"
              tone="quiz"
              value={accuracy(dashboard.totals.correct, dashboard.totals.incorrect)}
            />
            {(["classic", "timed", "endless"] as Mode[]).map((mode) => (
              <StatTile
                key={mode}
                label={`Best · ${modeNames[mode]}`}
                icon="trophy"
                tone="awards"
                value={dashboard.best[mode] ?? "—"}
                hint={dashboard.best[mode] == null ? "not played yet" : "points"}
              />
            ))}
          </StatGrid>
        </Card>
      </Section>

      <Section title="Games">
        {gameList.map((item) => {
          const stat = stats[item.id];
          const rate = stat.answered ? Math.round((stat.correct / stat.answered) * 100) : 0;
          const tone = gameIcons[item.id].tone;
          return (
            <Card as="article" key={item.id} className="ph-account-game">
              <div className="ph-account-card-head">
                <IconTile name={gameIcons[item.id].icon} tone={tone} size="sm" />
                <h3>{gameNames[item.id]}</h3>
              </div>
              <StatGrid label={`${gameNames[item.id]} statistics`}>
                <StatTile label="Rounds finished" icon="check" tone={tone} value={stat.rounds} />
                <StatTile
                  label={item.id === "recall" ? "Found" : "Correct"}
                  icon="target"
                  tone={tone}
                  value={`${rate}%`}
                />
                <StatTile label="Personal bests" icon="trophy" tone="awards" value={countFor(item.id)} />
                <StatTile label="Time played" icon="timer" tone={tone} value={formatClock(stat.timeMs)} />
              </StatGrid>
              <p className="ph-muted text-sm mt-2">
                <strong>{stat.places}</strong> different {item.unit}
                {stat.lastPlayedAt ? ` · last played ${new Date(stat.lastPlayedAt).toLocaleDateString("en-US")}` : ""}
              </p>
            </Card>
          );
        })}
        <EliminationCard />
      </Section>

      <Section title="Personal bests">
        <SegmentedControl<BestFilter> label="Show bests for" options={bestOptions} value={game} onChange={setGame} />
        <p className="ph-muted text-sm" role="status">
          {game === "all"
            ? `${bests.length} ${bests.length === 1 ? "best" : "bests"} in all games`
            : `${countFor(game)} ${countFor(game) === 1 ? "best" : "bests"} in ${gameNames[game]}`}
        </p>
        {visibleBests.length ? (
          <ul className="ph-account-list">
            {visibleBests.map((best, index) => (
              <li key={`${best.game}-${best.completedAt}-${index}`} className="ph-account-list-item">
                <span className="ph-account-best-icon" aria-hidden="true">
                  <Icon name="trophy" size={18} />
                </span>
                <div>
                  <p className="font-bold">
                    {game === "all" && <span className="ph-account-tag">{gameNames[best.game]}</span>}
                    {gameModeNames[best.mode] ?? best.mode}
                  </p>
                  <p className="ph-muted text-sm">
                    {describeSetup({
                      scope: best.scope,
                      region: best.region,
                      pool: best.pool,
                      picks: best.selectedCodes.length,
                      limit: best.timeLimitSeconds,
                    })}
                    {" · "}
                    {best.runCount} {best.runCount === 1 ? "run" : "runs"}
                  </p>
                </div>
                <p className="ph-account-score">
                  {bestScore(best)}
                  <small>{formatClock(best.elapsedMs)}</small>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ph-muted">No personal bests yet – play a whole set (not a random pick) to record one.</p>
        )}
        <p className="ph-muted text-sm">
          One best per setup: game, direction, catalog, region, difficulty and time limit. Ties go to the faster round.
        </p>
      </Section>

      <Section title="Recent quiz games">
        {dashboard.sessions.length ? (
          <ul className="ph-account-list">
            {dashboard.sessions.slice(0, 10).map((session) => (
              <li key={session.id} className="ph-account-list-item">
                <div>
                  <p className="font-bold">{modeNames[session.mode]}</p>
                  <p className="ph-muted text-sm">
                    {new Date(session.createdAt).toLocaleString("en-US")} · {session.status}
                  </p>
                </div>
                <p className="ph-account-score">
                  {session.score}
                  <small>points</small>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <p className="font-bold">Your first run is waiting</p>
            <p className="ph-muted text-sm mt-1">Finish a quiz game and your latest results will appear here.</p>
            <LinkGameButton to={paths.games} size="md" block className="mt-3">
              Choose a game
            </LinkGameButton>
          </Card>
        )}
      </Section>
    </>
  );
}

type BestFilter = GameId | "all";

/** Elimination puzzles are online only: the demo rejects with ONLINE_ONLY, shown as a note. */
function EliminationCard() {
  const { data, error, reload } = useLoad(() => api.elimCatalog());
  return (
    <Card as="article" className="ph-account-game">
      <div className="ph-account-card-head">
        <IconTile name={gameIcons.elimination.icon} tone={gameIcons.elimination.tone} size="sm" />
        <h3>Elimination</h3>
      </div>
      {error ? (
        isOnlineOnly(error) ? (
          <p className="ph-muted text-sm mt-2">Elimination needs an online account and isn't available in the local demo.</p>
        ) : (
          <div className="mt-2">
            <StatusMessage tone="error" retry={reload}>
              {readableError(error)}
            </StatusMessage>
          </div>
        )
      ) : !data ? (
        <LoadingState label="Loading Elimination…" />
      ) : (
        <EliminationStats puzzles={data} />
      )}
    </Card>
  );
}

function EliminationStats({ puzzles }: { puzzles: EliminationPuzzle[] }) {
  const played = puzzles.filter((puzzle) => puzzle.plays > 0);
  const solved = puzzles.filter((puzzle) => puzzle.best && puzzle.best.solved >= puzzle.total);
  const fastest = solved.reduce<number | null>(
    (best, puzzle) => (best === null || puzzle.best!.elapsedMs < best ? puzzle.best!.elapsedMs : best),
    null,
  );
  const tone = gameIcons.elimination.tone;
  return (
    <StatGrid label="Elimination statistics">
      <StatTile label="Puzzles played" icon="check" tone={tone} value={`${played.length} / ${puzzles.length}`} />
      <StatTile label="Fully solved" icon="target" tone={tone} value={solved.length} />
      <StatTile label="Rounds" icon="review" tone={tone} value={puzzles.reduce((sum, puzzle) => sum + puzzle.plays, 0)} />
      <StatTile label="Fastest solve" icon="timer" tone="awards" value={fastest === null ? "—" : formatClock(fastest)} />
    </StatGrid>
  );
}

// ---------- Achievements ----------

const tierNames: Record<AchievementTier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
const tiers: AchievementTier[] = ["bronze", "silver", "gold", "platinum"];
const categoryNames: { id: AchievementCategory; label: string }[] = [
  { id: "quiz", label: "Quiz" },
  { id: "progress", label: "Level" },
  { id: "daily", label: "Daily challenge" },
  { id: "flags", label: "Flags" },
  { id: "capitals", label: "Capitals" },
  { id: "recall", label: "Recall" },
  { id: "review", label: "Review" },
];
const iconOf = (name: string): IconName => ((iconNames as string[]).includes(name) ? (name as IconName) : "star");
const tierOf = (item: Achievement): AchievementTier => (tiers.includes(item.tier) ? item.tier : "bronze");
const categoryOf = (item: Achievement) =>
  categoryNames.find((category) => category.id === (item.category ?? "quiz"))?.label ?? "Quiz";

/** Progress toward a badge, clamped for display (the server decides when it is earned). */
function progressOf(item: Achievement) {
  const target = Math.max(1, Number(item.target) || 0);
  const current = Math.min(target, Math.max(0, Number(item.current) || 0));
  return { current, target, percent: Math.round((current / target) * 100) };
}

type Filter = "all" | "earned" | "open";
const filters: SegmentOption<Filter>[] = [
  { value: "all", label: "All" },
  { value: "earned", label: "Earned" },
  { value: "open", label: "Still to earn" },
];

export function AchievementsScreen() {
  usePhoneChrome({ title: "Achievements", back: paths.profile });
  const { data, error, reload } = useLoad(() => api.achievements());
  if (error) {
    return isOnlineOnly(error) ? (
      <div className="ph-stack">
        <StatusMessage>
          Achievements need an online account and aren't available in the local demo. Your games still count toward
          your statistics and personal bests.
        </StatusMessage>
        <LinkGameButton to={paths.games} size="md" block>
          Choose a game
        </LinkGameButton>
      </div>
    ) : (
      <LoadError message={error} retry={reload} />
    );
  }
  if (!data) return <LoadingState label="Loading your achievements…" />;
  return <AchievementsGrid achievements={Array.isArray(data) ? data : []} />;
}

function AchievementsGrid({ achievements }: { achievements: Achievement[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const earned = achievements.filter((item) => item.earned).length;
  const visible = achievements.filter((item) => filter === "all" || (filter === "earned" ? item.earned : !item.earned));
  const groups = categoryNames
    .map((category) => ({ ...category, items: visible.filter((item) => (item.category ?? "quiz") === category.id) }))
    .filter((group) => group.items.length > 0);
  const selected = achievements.find((item) => item.id === openId) ?? null;

  return (
    <>
      <section className="ph-account-ach-summary" aria-label="Summary">
        <span className="ph-account-ach-trophy" aria-hidden="true">
          <Icon name="trophy" size={30} />
        </span>
        <div className="grid gap-2">
          <p className="text-2xl font-black">
            {earned} <span className="ph-muted text-base font-bold">/ {achievements.length} badges earned</span>
          </p>
          <ProgressBar value={earned} max={Math.max(1, achievements.length)} label={`${earned} of ${achievements.length} badges earned`} />
        </div>
        <ul className="ph-account-facts ph-account-facts-4" aria-label="Badges by tier">
          {tiers.map((tier) => (
            <TierFact key={tier} tier={tier} achievements={achievements} />
          ))}
        </ul>
      </section>
      <Section title="Badges" className="mt-6">
        <SegmentedControl<Filter> label="Show badges" options={filters} value={filter} onChange={setFilter} />
        {groups.length === 0 && (
          <p className="ph-muted text-sm">
            {filter === "earned" ? "No badges yet – finish a game to earn your first." : "Every badge earned. Impressive!"}
          </p>
        )}
      </Section>
      {groups.map((group) => (
        <Section
          key={group.id}
          title={`${group.label} · ${group.items.filter((item) => item.earned).length}/${group.items.length}`}
        >
          <ul className="ph-account-ach-grid">
            {group.items.map((item) => (
              <li key={item.id}>
                <BadgeTile item={item} onOpen={() => setOpenId(item.id)} />
              </li>
            ))}
          </ul>
        </Section>
      ))}
      <AchievementSheet item={selected} onClose={() => setOpenId(null)} />
    </>
  );
}

/** Round medallion: tier ring, game icon, lock when not earned. */
function Medallion({ item, size = "md" }: { item: Achievement; size?: "md" | "lg" }) {
  return (
    <span
      className={size === "lg" ? "ph-account-medallion is-lg" : "ph-account-medallion"}
      data-tier={tierOf(item)}
      data-earned={item.earned}
      aria-hidden="true"
    >
      <Icon name={iconOf(item.icon)} size={size === "lg" ? 40 : 26} />
      {!item.earned && (
        <span className="ph-account-medallion-lock">
          <Icon name="lock" size={size === "lg" ? 16 : 12} />
        </span>
      )}
    </span>
  );
}

function BadgeTile({ item, onOpen }: { item: Achievement; onOpen: () => void }) {
  const progress = progressOf(item);
  const status = item.earned ? "Earned" : `Locked, ${progress.current} of ${progress.target}`;
  return (
    <button
      type="button"
      className="ph-account-ach"
      data-earned={item.earned}
      aria-haspopup="dialog"
      aria-label={`${item.title}, ${tierNames[tierOf(item)]}. ${status}`}
      onClick={onOpen}
    >
      <Medallion item={item} />
      <span className="ph-account-ach-title">{item.title}</span>
      {item.earned ? (
        <span className="ph-account-ach-state">
          <Icon name="check" size={14} /> Earned
        </span>
      ) : (
        <span className="ph-account-ach-meter">
          <span style={{ width: `${progress.percent}%` }} />
        </span>
      )}
    </button>
  );
}

function AchievementSheet({ item, onClose }: { item: Achievement | null; onClose: () => void }) {
  const progress = item ? progressOf(item) : null;
  return (
    <BottomSheet open={item !== null} onClose={onClose} title={item?.title ?? "Achievement"}>
      {item && progress && (
        <div className="ph-account-ach-detail" data-earned={item.earned}>
          <div className="ph-account-ach-detail-medal">
            {item.earned && <Burst fireKey={item.id} count={18} />}
            <Medallion item={item} size="lg" />
          </div>
          <p className="ph-account-ach-detail-tags">
            <span className="ph-account-tag">{tierNames[tierOf(item)]}</span>
            <span className="ph-account-tag">{categoryOf(item)}</span>
          </p>
          <p>{item.description}</p>
          {item.earned ? (
            <p className="ph-account-ach-earned" role="status">
              <Icon name="check" size={18} /> Earned – nice work!
            </p>
          ) : (
            <>
              <ProgressBar value={progress.current} max={progress.target} label="Progress" showValue />
              <p className="ph-muted text-sm">
                <Icon name="lock" size={14} /> Locked · {progress.target - progress.current} to go. Progress is
                counted by the server after each finished game.
              </p>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function TierFact({ tier, achievements }: { tier: AchievementTier; achievements: Achievement[] }) {
  const all = achievements.filter((item) => tierOf(item) === tier);
  return (
    <li className="ph-account-fact" data-tier={tier}>
      <strong>
        {all.filter((item) => item.earned).length}/{all.length}
      </strong>
      <small>{tierNames[tier]}</small>
    </li>
  );
}
