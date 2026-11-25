// Phone Profile (/profile/*): game-style player card (avatar with level badge, XP bar, day streak, rank and record
// tiles), links to Statistics, Achievements, the Leaderboard sheet (own row pinned), Edit profile and Account & data.
// Everything comes from existing RPCs via api.* (demo branch included); the server decides XP, level and rank.
import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, isDemo } from "@shared/api";
import { useLoad } from "@shared/components";
import { Leaderboard, LeaderboardPeriod, LeaderboardPlayer, avatars, level } from "@shared/domain";
import { Icon } from "@shared/icons";
import { accuracy } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionCard,
  BottomSheet,
  Card,
  LinkCard,
  LinkGameButton,
  LoadingState,
  Section,
  SegmentOption,
  SegmentedControl,
  StatGrid,
  StatTile,
  StatusMessage,
  StreakMeter,
  XP_PER_LEVEL,
  useCountUp,
} from "@phone/ui";
import { AccountScreen, EditProfileScreen } from "./account-data";
import { LoadError, readableError } from "./helpers";
import { AchievementsScreen, StatisticsScreen } from "./stats";
import "./account.css";

export default function ProfileArea() {
  return (
    <Routes>
      <Route index element={<ProfileOverview />} />
      <Route path="leaderboard" element={<ProfileOverview leaderboard />} />
      <Route path="statistics" element={<StatisticsScreen />} />
      <Route path="achievements" element={<AchievementsScreen />} />
      <Route path="edit" element={<EditProfileScreen />} />
      <Route path="account" element={<AccountScreen />} />
      <Route path="*" element={<ProfileOverview />} />
    </Routes>
  );
}

/** State marker: the sheet was opened from the Profile screen, so closing can simply go back one entry. */
type LeaderboardState = { fromProfile?: boolean } | null;

/**
 * Profile overview. At /profile/leaderboard the Leaderboard sheet is open on top (Home links there directly);
 * closing it returns to /profile. The route is the open state, so the device Back button closes the sheet too.
 */
function ProfileOverview({ leaderboard = false }: { leaderboard?: boolean }) {
  usePhoneChrome({ title: "Profile" });
  const navigate = useNavigate();
  const location = useLocation();
  const dashboard = useLoad(() => api.dashboard());
  const board = useLoad(() => api.leaderboard("all"));
  const user = useLoad(() => api.currentUser());
  const openLeaderboard = () => navigate(`${paths.profile}/leaderboard`, { state: { fromProfile: true } });
  const closeLeaderboard = () => {
    if ((location.state as LeaderboardState)?.fromProfile) navigate(-1);
    else navigate(paths.profile, { replace: true });
  };

  if (!dashboard.data) {
    return dashboard.error ? (
      <LoadError message={dashboard.error} retry={dashboard.reload} />
    ) : (
      <LoadingState label="Loading your profile…" />
    );
  }

  const { profile, totals } = dashboard.data;
  const you = board.data?.you ?? null;
  const playerLevel = level(profile.xp);
  const isGuest = !isDemo && user.data?.isAnonymous === true;

  return (
    <>
      <section className="ph-account-hero" aria-label="Your player card">
        <div className="ph-account-hero-top">
          <span className="ph-account-avatar-wrap">
            <span className="ph-account-avatar ph-account-avatar-xl" aria-hidden="true">
              {avatars[profile.avatar] ?? avatars[0]}
            </span>
            <span className="ph-account-level" aria-hidden="true">
              {playerLevel}
            </span>
          </span>
          <div className="ph-account-hero-id">
            <p className="ph-account-name">{profile.username}</p>
            <p className="ph-muted text-sm">
              Level {playerLevel} · {profile.xp.toLocaleString("en-US")} XP
              {isDemo ? " · Local demo" : isGuest ? " · Guest" : ""}
            </p>
            <p className="ph-account-streak">
              <StreakMeter streak={you?.dailyStreak ?? 0} />
              <span>day streak</span>
            </p>
          </div>
        </div>
        <LevelBar xp={profile.xp} />
        <StatGrid label="Rank and records">
          <StatTile
            label="Rank"
            icon="podium"
            tone="awards"
            value={you?.rank ? `#${you.rank}` : "–"}
            hint={you?.rank ? "all time" : "not ranked yet"}
          />
          <StatTile label="Best streak" icon="flame" tone="daily" value={you?.bestStreak ?? 0} hint="answers in a row" />
          <StatTile label="Quiz games" icon="quiz" tone="quiz" value={totals.games} hint="completed" />
          <StatTile
            label="Accuracy"
            icon="target"
            tone="review"
            value={accuracy(totals.correct, totals.incorrect)}
            hint="in quiz games"
          />
        </StatGrid>
      </section>

      {isDemo && (
        <StatusMessage>
          Local demo: your progress stays in this browser. Accounts, achievements and the global leaderboard need the
          online version.
        </StatusMessage>
      )}
      {isGuest && (
        <Card as="section" className="mt-4 grid gap-3" aria-label="Save your progress">
          <p className="font-bold">You're playing as a guest</p>
          <p className="ph-muted text-sm">
            Your progress is tied to this device. Create an account to keep it and play on any device.
          </p>
          <LinkGameButton to={`${paths.signIn}?mode=link`} size="md" block icon={<Icon name="sparkles" />}>
            Create an account
          </LinkGameButton>
        </Card>
      )}

      <Section title="Progress" className="mt-6">
        <LinkCard
          to={`${paths.profile}/statistics`}
          icon="trending"
          tone="quiz"
          title="Statistics"
          text="Every game, personal bests and recent quiz games"
        />
        <LinkCard
          to={`${paths.profile}/achievements`}
          icon="medal"
          tone="awards"
          title="Achievements"
          text={isDemo ? "Online accounts only" : "Badges and what's left to earn"}
        />
        <ActionCard
          icon="podium"
          tone="daily"
          title="Leaderboard"
          text={
            you?.rank
              ? `You're #${you.rank} of ${board.data?.totalPlayers.toLocaleString("en-US")}`
              : "Ranked by XP from quiz games"
          }
          onClick={openLeaderboard}
        />
      </Section>

      <Section title="You">
        <LinkCard to={`${paths.profile}/edit`} icon="user" title="Edit profile" text="Username, avatar and favorite topics" />
        <LinkCard
          to={`${paths.profile}/account`}
          icon="shield"
          title="Account & data"
          text="Download your data, sign out or delete your account"
        />
        <LinkCard to={paths.settings} icon="settings" title="Settings" text="Vibration, sound, display and more" />
      </Section>

      <LeaderboardSheet open={leaderboard} onClose={closeLeaderboard} />
    </>
  );
}

/** Level progress from the server's XP total (fills once on show; static under reduced motion). */
function LevelBar({ xp }: { xp: number }) {
  const playerLevel = level(xp);
  const inLevel = Math.max(0, xp) % XP_PER_LEVEL;
  const shown = useCountUp((inLevel / XP_PER_LEVEL) * 100, { durationMs: 900, delayMs: 150 });
  return (
    <div className="ph-xp">
      <div className="ph-xp-line">
        <strong>Level {playerLevel}</strong>
        <span>
          {(XP_PER_LEVEL - inLevel).toLocaleString("en-US")} XP to level {playerLevel + 1}
        </span>
      </div>
      <div
        className="ph-xp-track"
        role="progressbar"
        aria-label={`Level ${playerLevel}: ${inLevel} of ${XP_PER_LEVEL} XP to level ${playerLevel + 1}`}
        aria-valuemin={0}
        aria-valuemax={XP_PER_LEVEL}
        aria-valuenow={inLevel}
        aria-valuetext={`${inLevel} of ${XP_PER_LEVEL} XP`}
      >
        <div className="ph-xp-fill" style={{ width: `${shown}%` }} />
      </div>
    </div>
  );
}

const periods: SegmentOption<LeaderboardPeriod>[] = [
  { value: "all", label: "All time" },
  { value: "week", label: "This week" },
];

function LeaderboardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const { data, error, reload } = useLoad<Leaderboard | null>(
    () => (open ? api.leaderboard(period) : Promise.resolve(null)),
    `${open}:${period}`,
  );
  const board = open && data ? data : null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Leaderboard"
      closeOnBack={false}
      footer={board?.you ? <PinnedStanding board={board} /> : undefined}
    >
      <SegmentedControl<LeaderboardPeriod> label="Time period" options={periods} value={period} onChange={setPeriod} />
      <p className="ph-muted text-sm mt-2">
        {period === "week" ? "XP earned in quiz games over the last 7 days." : "Ranked by total XP from quiz games."}
      </p>
      {error ? (
        <StatusMessage tone="error" retry={reload}>
          {readableError(error)}
        </StatusMessage>
      ) : board ? (
        <LeaderboardList board={board} />
      ) : (
        <LoadingState label="Loading the leaderboard…" />
      )}
    </BottomSheet>
  );
}

const podium = ["gold", "silver", "bronze"] as const;

function LeaderRow({ player, week, as: Tag = "li" }: { player: LeaderboardPlayer; week: boolean; as?: "li" | "div" }) {
  const medal = player.rank && player.rank <= 3 ? podium[player.rank - 1] : undefined;
  return (
    <Tag className="ph-account-lb-row" data-you={player.isYou}>
      <span className="ph-account-lb-rank" data-medal={medal}>
        {medal && <Icon name={medal === "gold" ? "crown" : "medal"} size={16} />}
        {player.rank ? `#${player.rank}` : "–"}
      </span>
      <span className="ph-account-lb-avatar" aria-hidden="true">
        {avatars[player.avatar] ?? avatars[0]}
      </span>
      <span className="flex-1 min-w-0">
        <strong className="block truncate">
          {player.username}
          {player.isYou && <span className="ph-account-tag ml-2">You</span>}
        </strong>
        <small className="ph-muted">
          Level {player.level} · best streak {player.bestStreak} · daily streak {player.dailyStreak}
        </small>
      </span>
      <span className="ph-account-score">
        {player.points.toLocaleString("en-US")}
        <small>{week ? "XP this week" : "XP"}</small>
      </span>
    </Tag>
  );
}

/** Your own row, pinned to the bottom of the sheet with the next goal (always visible while scrolling). */
function PinnedStanding({ board }: { board: Leaderboard }) {
  const week = board.period === "week";
  const you = board.you;
  if (!you) return null;
  const goal = !you.rank
    ? week
      ? "Finish a scored quiz game this week to get on the weekly board."
      : "Finish a scored quiz game to join the leaderboard."
    : board.ahead
      ? `Earn ${board.ahead.gap.toLocaleString("en-US")} XP to pass ${board.ahead.username} for #${board.ahead.rank}.`
      : board.totalPlayers > 1
        ? `You lead the ${week ? "week" : "world"}. Keep your streak going!`
        : "You're the first ranked player.";
  return (
    <div className="ph-account-lb-you" role="group" aria-label="Your standing">
      <LeaderRow player={{ ...you, isYou: true }} week={week} as="div" />
      <p className="ph-muted text-sm">
        {you.rank && board.totalPlayers ? `#${you.rank} of ${board.totalPlayers.toLocaleString("en-US")} · ` : ""}
        {goal}
      </p>
    </div>
  );
}

export function LeaderboardList({ board }: { board: Leaderboard }) {
  const week = board.period === "week";
  return (
    <div className="grid gap-3 mt-3">
      {isDemo && (
        <p className="ph-muted text-sm">
          The demo keeps progress in this browser, so only you are on this board. Sign in online to compete with other
          players.
        </p>
      )}
      {board.players.length === 0 && !isDemo && (
        <p className="ph-muted text-sm">
          {week ? "Nobody has earned XP in the last 7 days yet – be the first." : "No ranked players yet – be the first."}
        </p>
      )}
      {board.players.length > 0 && (
        <ol className="grid gap-2" aria-label="Ranking">
          {board.players.map((player) => (
            <LeaderRow key={`${player.rank}-${player.username}`} player={player} week={week} />
          ))}
        </ol>
      )}
      {board.totalPlayers > board.players.length && (
        <p className="ph-muted text-sm">
          Showing the top {board.players.length} of {board.totalPlayers.toLocaleString("en-US")} ranked players.
        </p>
      )}
    </div>
  );
}
