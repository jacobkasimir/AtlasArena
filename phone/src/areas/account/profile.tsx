// Phone Profile (/profile/*): player header, links to Statistics, Achievements, the Leaderboard sheet,
// Edit profile and Account & data. Everything comes from existing RPCs via api.* (demo branch included).
import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, isDemo } from "@shared/api";
import { useLoad } from "@shared/components";
import { Leaderboard, LeaderboardPeriod, avatars, level } from "@shared/domain";
import { Icon } from "@shared/icons";
import { accuracy } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionCard,
  BottomSheet,
  Card,
  Chip,
  ChipGroup,
  LinkButton,
  LinkCard,
  LoadingState,
  ProgressBar,
  Section,
  StatusMessage,
} from "@phone/ui";
import { AccountScreen, EditProfileScreen } from "./account-data";
import { LoadError, readableError } from "./helpers";
import { AchievementsScreen, StatisticsScreen } from "./stats";
import "./account.css";

export default function ProfileArea() {
  return (
    <Routes>
      <Route index element={<ProfileOverview />} />
      <Route path="statistics" element={<StatisticsScreen />} />
      <Route path="achievements" element={<AchievementsScreen />} />
      <Route path="edit" element={<EditProfileScreen />} />
      <Route path="account" element={<AccountScreen />} />
      <Route path="*" element={<ProfileOverview />} />
    </Routes>
  );
}

function ProfileOverview() {
  usePhoneChrome({ title: "Profile" });
  const dashboard = useLoad(() => api.dashboard());
  const board = useLoad(() => api.leaderboard("all"));
  const user = useLoad(() => api.currentUser());
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  if (!dashboard.data) {
    return dashboard.error ? (
      <LoadError message={dashboard.error} retry={dashboard.reload} />
    ) : (
      <LoadingState label="Loading your profile…" />
    );
  }

  const { profile, totals } = dashboard.data;
  const you = board.data?.you ?? null;
  const inLevel = profile.xp % 500;
  const playerLevel = level(profile.xp);
  const isGuest = !isDemo && user.data?.isAnonymous === true;

  return (
    <>
      <Card as="section" className="ph-account-hero" aria-label="Your player card">
        <div className="ph-account-hero-top">
          <span className="ph-account-avatar" aria-hidden="true">
            {avatars[profile.avatar] ?? avatars[0]}
          </span>
          <div className="min-w-0">
            <p className="ph-account-name">{profile.username}</p>
            <p className="ph-muted text-sm">
              Level {playerLevel} · {profile.xp.toLocaleString()} XP
              {isDemo ? " · Local demo" : isGuest ? " · Guest" : ""}
            </p>
          </div>
        </div>
        <ProgressBar
          value={inLevel}
          max={500}
          label={`Level ${playerLevel}: ${inLevel} of 500 XP to level ${playerLevel + 1}`}
        />
        <p className="ph-muted text-sm">{500 - inLevel} XP to level {playerLevel + 1}</p>
        <ul className="ph-account-facts" aria-label="Streaks and rank">
          <li className="ph-account-fact">
            <strong>
              <Icon name="calendar" size={16} /> {you?.dailyStreak ?? 0}
            </strong>
            <small>day streak</small>
          </li>
          <li className="ph-account-fact">
            <strong>
              <Icon name="flame" size={16} /> {you?.bestStreak ?? 0}
            </strong>
            <small>best answer streak</small>
          </li>
          <li className="ph-account-fact">
            <strong>
              <Icon name="podium" size={16} /> {you?.rank ? `#${you.rank}` : "–"}
            </strong>
            <small>{you?.rank ? "all-time rank" : "not ranked yet"}</small>
          </li>
        </ul>
        <p className="text-sm">
          {totals.games} completed quiz {totals.games === 1 ? "game" : "games"} ·{" "}
          {accuracy(totals.correct, totals.incorrect)} accuracy
        </p>
      </Card>

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
          <LinkButton to={`${paths.signIn}?mode=link`} variant="primary" block icon={<Icon name="sparkles" />}>
            Create an account
          </LinkButton>
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
          text={you?.rank ? `You're #${you.rank} of ${board.data?.totalPlayers.toLocaleString()}` : "Ranked by XP from quiz games"}
          onClick={() => setLeaderboardOpen(true)}
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
        <LinkCard to={paths.settings} icon="settings" title="Settings" text="Sound, vibration, display and more" />
      </Section>

      <LeaderboardSheet open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} />
    </>
  );
}

const periods: { id: LeaderboardPeriod; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "week", label: "This week" },
];

function LeaderboardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  return (
    <BottomSheet open={open} onClose={onClose} title="Leaderboard">
      <ChipGroup label="Time period">
        {periods.map((item) => (
          <Chip key={item.id} pressed={period === item.id} onToggle={() => setPeriod(item.id)}>
            {item.label}
          </Chip>
        ))}
      </ChipGroup>
      <p className="ph-muted text-sm mt-2">
        {period === "week" ? "XP earned in quiz games over the last 7 days." : "Ranked by total XP from quiz games."}
      </p>
      {open && <LeaderboardBody period={period} />}
    </BottomSheet>
  );
}

function LeaderboardBody({ period }: { period: LeaderboardPeriod }) {
  const { data, error, reload } = useLoad(() => api.leaderboard(period), period);
  if (error) return <StatusMessage tone="error" retry={reload}>{readableError(error)}</StatusMessage>;
  if (!data) return <LoadingState label="Loading the leaderboard…" />;
  return <LeaderboardList board={data} />;
}

export function LeaderboardList({ board }: { board: Leaderboard }) {
  const week = board.period === "week";
  const you = board.you;
  const goal = !you?.rank
    ? week
      ? "Finish a scored quiz game this week to get on the weekly board."
      : "Finish a scored quiz game to join the leaderboard."
    : board.ahead
      ? `Earn ${board.ahead.gap.toLocaleString()} XP to pass ${board.ahead.username} for #${board.ahead.rank}.`
      : board.totalPlayers > 1
        ? `You lead the ${week ? "week" : "world"}. Keep your streak going!`
        : "You're the first ranked player.";
  return (
    <div className="grid gap-3 mt-3">
      {you && (
        <div className="ph-card" aria-label="Your standing" role="group">
          <p className="font-bold">
            {you.rank ? `#${you.rank}` : "Unranked"}
            {board.totalPlayers ? ` of ${board.totalPlayers.toLocaleString()}` : ""} · {you.points.toLocaleString()}{" "}
            {week ? "XP this week" : "XP"}
          </p>
          <p className="ph-muted text-sm mt-1">{goal}</p>
        </div>
      )}
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
            <li key={`${player.rank}-${player.username}`} className="ph-account-lb-row" data-you={player.isYou}>
              <span className="ph-account-lb-rank">#{player.rank}</span>
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
                {player.points.toLocaleString()}
                <small>{week ? "XP this week" : "XP"}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {board.totalPlayers > board.players.length && (
        <p className="ph-muted text-sm">
          Showing the top {board.players.length} of {board.totalPlayers.toLocaleString()} ranked players.
        </p>
      )}
    </div>
  );
}
