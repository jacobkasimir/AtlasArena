// Phone Home hub (route "/"): player header (avatar, level, XP bar, streak, leaderboard), one "Next goal", the
// newest resumable round, today's challenge, Review my mistakes, achievements, region practice and chunky game
// cards. Information sits at the top; the actions sit in the lower half, and the one big primary action
// ("Play" / "Continue …") sticks to the bottom under the thumb.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@shared/api";
import { Icon } from "@shared/icons";
import { ActionBar, Button, GameButton, LinkGameButton, Section, StatusMessage, useFeel } from "@phone/ui";
import { usePhoneChrome } from "@phone/shell/chrome";
import {
  continueItems,
  dailyPlan,
  isOnlineOnly,
  nextGoal,
  playPath,
  practiceRegions,
  primaryAction,
  readableError,
  useHomeData,
  valueOf,
} from "./data";
import {
  AchievementsCard,
  BestsCard,
  ContinueList,
  DailyCard,
  Hero,
  HomeSkeleton,
  NextGoal,
  PracticeRegions,
  ProgressList,
  ReviewCard,
} from "./HomeCards";
import "./home.css";

/** Starts today's challenge on the server and opens it in the quiz area. */
function useDailyStart() {
  const navigate = useNavigate();
  const haptics = useFeel();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  async function start() {
    if (starting) return;
    setStarting(true);
    setMessage("");
    try {
      const view = await api.dailyStart();
      navigate(playPath.quiz(view.id));
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      haptics.error();
      setMessage(
        text.includes("DAILY_NOT_ENOUGH")
          ? "Not enough published questions for today's challenge yet."
          : isOnlineOnly(cause)
            ? "The daily challenge needs an online account – not available in the local demo."
            : `Could not start today's challenge: ${readableError(cause)}`,
      );
      setStarting(false);
    }
  }
  return { start, starting, message };
}

export default function Home() {
  usePhoneChrome({ title: "Atlas Arena" });
  const { data, error, loading, reload } = useHomeData();
  const daily = useDailyStart();

  if (!data) {
    if (error) {
      return (
        <div className="ph-home">
          <StatusMessage tone="error" retry={reload}>
            Your home could not be loaded: {error}
          </StatusMessage>
        </div>
      );
    }
    return <HomeSkeleton />;
  }

  const items = continueItems(data);
  const plan = dailyPlan(data.daily);
  const action = primaryAction(data);
  const bests = valueOf(data.bests) ?? [];
  const roundsUnchecked = [data.flags, data.capitals, data.recall].some((part) => part.state === "error");
  const streak = valueOf(data.daily)?.streak ?? null;
  const goal = nextGoal(data);
  const regions = practiceRegions(data);

  return (
    <div className="ph-home">
      <Hero dashboard={data.quiz} streak={streak} />

      <NextGoal goal={goal} onDailyStart={() => void daily.start()} starting={daily.starting} />

      {(items.length > 0 || roundsUnchecked) && (
        <Section title="Continue">
          {items.length > 0 && <ContinueList items={items} />}
          {roundsUnchecked && (
            <StatusMessage tone="warning" retry={reload}>
              Some games could not be checked for unfinished rounds.
            </StatusMessage>
          )}
        </Section>
      )}

      <Section title="Today">
        <div className="ph-stack">
          <DailyCard
            plan={plan}
            onStart={() => void daily.start()}
            starting={daily.starting}
            message={daily.message}
            retry={reload}
          />
          <ReviewCard part={data.review} retry={reload} />
          <AchievementsCard part={data.achievements} retry={reload} />
        </div>
      </Section>

      {regions.length > 0 && (
        <Section title="Practise a region">
          <PracticeRegions regions={regions} />
        </Section>
      )}

      <Section title="Your games">
        <ProgressList data={data} />
      </Section>

      {bests.length > 0 && (
        <Section title="Latest personal bests">
          <BestsCard bests={bests.slice(0, 3)} />
        </Section>
      )}

      <div className="ph-home-refresh">
        <StatusMessage tone="error">{error ? `Could not refresh: ${error}` : ""}</StatusMessage>
        <Button variant="ghost" block loading={loading} onClick={reload}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <ActionBar label="Main action">
        {action.kind === "daily-start" ? (
          <GameButton
            size="xl"
            block
            icon={<Icon name="calendar" size={24} />}
            loading={daily.starting}
            onClick={() => void daily.start()}
          >
            {action.label}
          </GameButton>
        ) : (
          <LinkGameButton
            size="xl"
            block
            icon={<Icon name={action.label === "Play" ? "gamepad" : "zap"} size={24} />}
            to={action.to}
          >
            {action.label}
          </LinkGameButton>
        )}
      </ActionBar>
    </div>
  );
}
