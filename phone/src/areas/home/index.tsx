// Phone Home hub (route "/"): greeting + level, continue unfinished rounds, today's challenge, review, achievements
// and progress per game. The one primary action sits in the sticky bar at the bottom, under the thumb.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@shared/api";
import { ActionBar, Button, LinkButton, Section, StatusMessage, useHaptics } from "@phone/ui";
import { usePhoneChrome } from "@phone/shell/chrome";
import {
  continueItems,
  dailyPlan,
  isOnlineOnly,
  playPath,
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
  ProgressList,
  ReviewCard,
} from "./HomeCards";
import "./home.css";

/** Starts today's challenge on the server and opens it in the quiz area. */
function useDailyStart() {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  async function start() {
    if (starting) return;
    haptics.tap();
    setStarting(true);
    setMessage("");
    try {
      const view = await api.dailyStart();
      navigate(playPath.quiz(view.id));
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
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

  return (
    <div className="ph-home">
      <Hero dashboard={data.quiz} streak={streak} />

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

      <Section title="Your progress">
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
          <Button variant="primary" size="lg" block loading={daily.starting} onClick={() => void daily.start()}>
            {action.label}
          </Button>
        ) : (
          <LinkButton variant="primary" size="lg" block to={action.to}>
            {action.label}
          </LinkButton>
        )}
      </ActionBar>
    </div>
  );
}
