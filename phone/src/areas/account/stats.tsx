// Statistics (/profile/statistics) and Achievements (/profile/achievements) for the phone Profile.
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
import { Card, Chip, ChipGroup, LinkButton, LoadingState, ProgressBar, Section, StatusMessage } from "@phone/ui";
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
  const [game, setGame] = useState<GameId | null>(null);
  if (error) return <LoadError message={error} retry={reload} />;
  if (!data) return <LoadingState label="Loading your statistics…" />;

  const { dashboard, stats, bests } = data;
  const visibleBests = bests.filter((best) => !game || best.game === game);
  return (
    <>
      <Section title="Quiz">
        <Card as="article">
          <div className="ph-account-card-head">
            <IconTile name={gameIcons.quiz.icon} tone={gameIcons.quiz.tone} size="sm" />
            <h3>Quiz</h3>
          </div>
          <dl className="ph-account-stats">
            <div>
              <dt>Completed games</dt>
              <dd>{dashboard.totals.games}</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{accuracy(dashboard.totals.correct, dashboard.totals.incorrect)}</dd>
            </div>
            {(["classic", "timed", "endless"] as Mode[]).map((mode) => (
              <div key={mode}>
                <dt>Best · {modeNames[mode]}</dt>
                <dd>{dashboard.best[mode] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Section>

      <Section title="Games">
        {gameList.map((item) => {
          const stat = stats[item.id];
          const rate = stat.answered ? Math.round((stat.correct / stat.answered) * 100) : 0;
          return (
            <Card as="article" key={item.id}>
              <div className="ph-account-card-head">
                <IconTile name={gameIcons[item.id].icon} tone={gameIcons[item.id].tone} size="sm" />
                <h3>{gameNames[item.id]}</h3>
              </div>
              <dl className="ph-account-stats">
                <div>
                  <dt>Rounds finished</dt>
                  <dd>{stat.rounds}</dd>
                </div>
                <div>
                  <dt>{item.id === "recall" ? "Found" : "Correct"}</dt>
                  <dd>{rate}%</dd>
                </div>
                <div>
                  <dt>Personal bests</dt>
                  <dd>{bests.filter((best) => best.game === item.id).length}</dd>
                </div>
                <div>
                  <dt>Time played</dt>
                  <dd>{formatClock(stat.timeMs)}</dd>
                </div>
              </dl>
              <p className="ph-muted text-sm mt-2">
                <strong>{stat.places}</strong> different {item.unit}
                {stat.lastPlayedAt ? ` · last played ${new Date(stat.lastPlayedAt).toLocaleDateString()}` : ""}
              </p>
            </Card>
          );
        })}
        <EliminationCard />
      </Section>

      <Section title="Personal bests">
        <ChipGroup label="Show bests for">
          <Chip pressed={game === null} onToggle={() => setGame(null)}>
            All games ({bests.length})
          </Chip>
          {gameList.map((item) => (
            <Chip key={item.id} pressed={game === item.id} onToggle={() => setGame(item.id)}>
              {gameNames[item.id]} ({bests.filter((best) => best.game === item.id).length})
            </Chip>
          ))}
        </ChipGroup>
        {visibleBests.length ? (
          <ul className="ph-account-list">
            {visibleBests.map((best, index) => (
              <li key={`${best.game}-${best.completedAt}-${index}`} className="ph-account-list-item">
                <div>
                  <p className="font-bold">
                    {!game && <span className="ph-account-tag">{gameNames[best.game]}</span>}
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
                    {new Date(session.createdAt).toLocaleString()} · {session.status}
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
            <LinkButton to={paths.games} variant="primary" block className="mt-3">
              Choose a game
            </LinkButton>
          </Card>
        )}
      </Section>
    </>
  );
}

/** Elimination puzzles are online only: the demo rejects with ONLINE_ONLY, shown as a note. */
function EliminationCard() {
  const { data, error, reload } = useLoad(() => api.elimCatalog());
  return (
    <Card as="article">
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
  return (
    <dl className="ph-account-stats">
      <div>
        <dt>Puzzles played</dt>
        <dd>
          {played.length} / {puzzles.length}
        </dd>
      </div>
      <div>
        <dt>Fully solved</dt>
        <dd>{solved.length}</dd>
      </div>
      <div>
        <dt>Rounds</dt>
        <dd>{puzzles.reduce((sum, puzzle) => sum + puzzle.plays, 0)}</dd>
      </div>
      <div>
        <dt>Fastest solve</dt>
        <dd>{fastest === null ? "—" : formatClock(fastest)}</dd>
      </div>
    </dl>
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

type Filter = "all" | "earned" | "open";

export function AchievementsScreen() {
  usePhoneChrome({ title: "Achievements", back: paths.profile });
  const { data, error, reload } = useLoad(() => api.achievements());
  if (error) {
    return isOnlineOnly(error) ? (
      <StatusMessage>
        Achievements need an online account and aren't available in the local demo. Your games still count toward
        your statistics and personal bests.
      </StatusMessage>
    ) : (
      <LoadError message={error} retry={reload} />
    );
  }
  if (!data) return <LoadingState label="Loading your achievements…" />;
  return <AchievementsGrid achievements={Array.isArray(data) ? data : []} />;
}

function AchievementsGrid({ achievements }: { achievements: Achievement[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const earned = achievements.filter((item) => item.earned).length;
  const visible = achievements.filter((item) => filter === "all" || (filter === "earned" ? item.earned : !item.earned));
  const groups = categoryNames
    .map((category) => ({ ...category, items: visible.filter((item) => (item.category ?? "quiz") === category.id) }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      <Card as="section" aria-label="Summary" className="grid gap-3">
        <p className="text-2xl font-black">
          {earned} <span className="ph-muted text-base font-bold">/ {achievements.length} badges earned</span>
        </p>
        <ProgressBar value={earned} max={achievements.length} label={`${earned} of ${achievements.length} badges earned`} />
        <ul className="ph-account-facts ph-account-facts-4" aria-label="Badges by tier">
          {tiers.map((tier) => (
            <TierFact key={tier} tier={tier} achievements={achievements} />
          ))}
        </ul>
      </Card>
      <Section title="Badges" className="mt-6">
        <ChipGroup label="Show badges">
          {(
            [
              ["all", "All"],
              ["earned", "Earned"],
              ["open", "Still to earn"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <Chip key={id} pressed={filter === id} onToggle={() => setFilter(id)}>
              {label}
            </Chip>
          ))}
        </ChipGroup>
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
          <ul className="ph-account-badges">
            {group.items.map((item) => (
              <li key={item.id} className="ph-account-badge" data-earned={item.earned}>
                <span className="ph-account-badge-icon" aria-hidden="true">
                  <Icon name={iconOf(item.icon)} size={22} />
                </span>
                <div className="ph-account-badge-body">
                  <strong>
                    {item.title} <span className="ph-account-tag">{tierNames[tierOf(item)]}</span>
                  </strong>
                  <p>{item.description}</p>
                  {item.earned ? (
                    <span className="text-sm font-bold inline-flex items-center gap-1">
                      <Icon name="check" size={14} /> Earned
                    </span>
                  ) : (
                    <ProgressBar
                      value={item.current}
                      max={item.target}
                      label="Progress"
                      showValue
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

function TierFact({ tier, achievements }: { tier: AchievementTier; achievements: Achievement[] }) {
  const all = achievements.filter((item) => tierOf(item) === tier);
  return (
    <li className="ph-account-fact">
      <strong>
        {all.filter((item) => item.earned).length}/{all.length}
      </strong>
      <small>{tierNames[tier]}</small>
    </li>
  );
}
