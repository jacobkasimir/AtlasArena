// Phone quiz setup: mode, difficulty, topic (bottom sheet) and length. Shows the published question counts from
// arena_quiz_catalog and disables combinations that can't fill a round (same filter as arena_start).
// A ModeHero in the quiz tone names the chosen mode; the mode itself is a SegmentedControl; Start is a GameButton.
import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@shared/api";
import { useLoad } from "@shared/components";
import { Difficulty, Mode, difficulties, modes } from "@shared/domain";
import { Icon } from "@shared/icons";
import { loadSetup, saveSetup } from "@shared/prefs";
import { accuracy, modeDescriptions, modeIcons, modeNames } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionBar,
  ActionCard,
  BottomSheet,
  Button,
  Card,
  Chip,
  ChipGroup,
  GameButton,
  LinkCard,
  ModeHero,
  Section,
  SegmentedControl,
  StatusMessage,
} from "@phone/ui";
import type { SegmentOption } from "@phone/ui";
import {
  availableQuestions,
  canFill,
  capitalize,
  friendlyQuizError,
  initialSetup,
  neededQuestions,
  practiceLengths,
  topicLabel,
  visibleTopics,
} from "./quiz-logic";

/** Short labels so four modes fit one row at 360 px; the hero shows the full name. */
const modeOptions: SegmentOption<Mode>[] = modes.map((m) => ({
  value: m,
  label: m === "classic" ? "Classic" : m === "timed" ? "Timed" : modeNames[m],
}));

export function QuizSetup() {
  usePhoneChrome({ title: "Quiz", back: true });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(() => initialSetup(params, loadSetup("quiz")), [params]);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [category, setCategory] = useState(initial.category);
  const [count, setCount] = useState(initial.count);
  const country = initial.country;
  const [topicOpen, setTopicOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const startingRef = useRef(false);

  const dashboard = useLoad(() => api.dashboard());
  const catalog = useLoad(() => api.quizCatalog().catch(() => null));
  const rows = Array.isArray(catalog.data) ? catalog.data : null;

  const needed = neededQuestions(mode, count);
  const countFor = (topic: string, level: Difficulty) => availableQuestions(rows, mode, topic, level);
  const fits = (topic: string, level: Difficulty) => canFill(rows, { mode, category: topic, difficulty: level, count });
  const ready = Boolean(country) || fits(category, difficulty);

  const unfinished = (dashboard.data?.sessions ?? []).filter(
    (s) => s.status === "awaiting_answer" || s.status === "showing_feedback",
  );

  async function start() {
    if (startingRef.current || !ready) return;
    startingRef.current = true;
    setPending(true);
    setError("");
    saveSetup("quiz", { mode, difficulty, category, count });
    try {
      const view = await api.play(mode, category === "all" ? [] : [category], difficulty, country, count);
      navigate(`${paths.quiz}/play/${view.id}`);
    } catch (cause) {
      setError(friendlyQuizError((cause as Error).message));
      startingRef.current = false;
      setPending(false);
    }
  }

  const lengthText =
    mode === "timed"
      ? "60 seconds on the clock"
      : mode === "endless"
        ? "3 lives, as many questions as you can"
        : mode === "classic"
          ? "10 questions"
          : `${count} questions`;
  const summary = `${modeNames[mode]} · ${capitalize(difficulty)} · ${topicLabel(category)}${mode === "practice" ? " · no XP" : ""}`;

  return (
    <div className="ph-quiz-setup ph-stack">
      {dashboard.error && (
        <StatusMessage tone="error" retry={dashboard.reload}>
          {friendlyQuizError(dashboard.error)}
        </StatusMessage>
      )}

      {unfinished.length > 0 && (
        <Section title="Continue a round">
          <div className="ph-stack">
            {unfinished.slice(0, 3).map((s) => (
              <LinkCard
                key={s.id}
                to={`${paths.quiz}/play/${s.id}`}
                icon={modeIcons[s.mode]}
                tone="quiz"
                title={`Resume ${modeNames[s.mode]}`}
                text={`${capitalize(s.difficulty)} · ${s.correct + s.incorrect} answered · ${s.score.toLocaleString()} pts`}
              />
            ))}
          </div>
        </Section>
      )}

      <ModeHero
        title={modeNames[mode]}
        subtitle={modeDescriptions[mode]}
        icon={modeIcons[mode]}
        tone="quiz"
        badge={
          mode === "practice" ? (
            "Practice · not ranked"
          ) : dashboard.data?.best[mode] != null ? (
            <>
              <Icon name="trophy" size={16} /> Best {dashboard.data.best[mode]!.toLocaleString()}
            </>
          ) : undefined
        }
      />

      <Section title="Mode">
        <SegmentedControl label="Mode" options={modeOptions} value={mode} onChange={setMode} />
      </Section>

      <Section title={mode === "endless" ? "Starting difficulty" : "Difficulty"}>
        <ChipGroup label="Difficulty">
          {difficulties.map((d) => {
            const available = countFor(category, d);
            return (
              <Chip
                key={d}
                pressed={difficulty === d}
                disabled={!country && !fits(category, d) && d !== difficulty}
                onToggle={() => setDifficulty(d)}
              >
                {capitalize(d)}
                {available !== null && !country && <span className="ph-quiz-count"> · {available}</span>}
              </Chip>
            );
          })}
        </ChipGroup>
        {mode === "endless" && (
          <p className="ph-muted ph-quiz-hint">Every five correct answers unlock the next tier.</p>
        )}
      </Section>

      <Section title="Topic">
        {country ? (
          <Card>
            <p>
              Practising one country: <strong>{country}</strong>.
            </p>
          </Card>
        ) : (
          <ActionCard
            onClick={() => setTopicOpen(true)}
            icon="layers"
            tone="quiz"
            title={topicLabel(category)}
            text={
              rows
                ? `${countFor(category, difficulty) ?? 0} published questions${needed > 1 ? ` · a round needs ${needed}` : ""}`
                : "Tap to choose a topic"
            }
          />
        )}
      </Section>

      <Section title="Length">
        {mode === "practice" && !country ? (
          <ChipGroup label="Questions per round">
            {practiceLengths.map((length) => {
              const enough = canFill(rows, { mode, category, difficulty, count: length });
              return (
                <Chip
                  key={length}
                  pressed={count === length}
                  disabled={!enough && count !== length}
                  onToggle={() => setCount(length)}
                >
                  {length} questions
                </Chip>
              );
            })}
          </ChipGroup>
        ) : (
          <p className="ph-muted">{lengthText}</p>
        )}
      </Section>

      {dashboard.data && (
        <Section title="Your quiz record">
          <Card>
            <dl className="ph-quiz-record">
              <div>
                <dt>Games finished</dt>
                <dd>{dashboard.data.totals.games}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>{accuracy(dashboard.data.totals.correct, dashboard.data.totals.incorrect)}</dd>
              </div>
            </dl>
          </Card>
        </Section>
      )}

      {!ready && (
        <StatusMessage tone="warning">
          Not enough questions for this combination yet – pick another difficulty or topic.
        </StatusMessage>
      )}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}

      <p id="ph-quiz-summary" className="sr-only">
        {summary}
      </p>
      <ActionBar label="Start">
        <GameButton
          variant="primary"
          size="xl"
          block
          loading={pending}
          disabled={!ready}
          icon={<Icon name={modeIcons[mode]} size={22} />}
          onClick={() => void start()}
          aria-describedby="ph-quiz-summary"
        >
          {pending ? "Starting…" : "Start game"}
        </GameButton>
      </ActionBar>

      <BottomSheet
        open={topicOpen}
        onClose={() => setTopicOpen(false)}
        title="Choose a topic"
        footer={
          <Button variant="primary" block onClick={() => setTopicOpen(false)}>
            Done
          </Button>
        }
      >
        {rows && (
          <p className="ph-muted ph-quiz-hint">
            Numbers show published questions for {modeNames[mode]} · {capitalize(difficulty)}
            {needed > 1 ? ` – a round needs ${needed}` : ""}.
          </p>
        )}
        <ChipGroup label="Topic">
          {visibleTopics(rows, category).map((topic) => {
            const available = countFor(topic, difficulty);
            return (
              <Chip
                key={topic}
                pressed={category === topic}
                disabled={!fits(topic, difficulty) && topic !== category}
                onToggle={() => setCategory(topic)}
              >
                {topicLabel(topic)}
                {available !== null && <span className="ph-quiz-count"> · {available}</span>}
              </Chip>
            );
          })}
        </ChipGroup>
      </BottomSheet>
    </div>
  );
}
