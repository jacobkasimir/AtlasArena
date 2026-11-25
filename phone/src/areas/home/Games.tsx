// "Games" tab (route "/games"): chunky cards in each game's tone for every game in the phone app (plus the
// Explorer atlas), with progress and rounds in progress. Each card is one big tappable link to the game's setup.
import { Link } from "react-router-dom";
import { Icon } from "@shared/icons";
import { modes } from "@shared/domain";
import { modeIcons, modeNames } from "@shared/quiz-meta";
import { Section, StatusMessage, feel } from "@phone/ui";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { GameKey, continueItems, gameIntros, gameTitles, setupPath, useHomeData } from "./data";
import { GameTile, gameStatLine } from "./HomeCards";
import "./home.css";

const list: GameKey[] = ["quiz", "flags", "capitals", "recall", "elimination"];

const shortModeName = (mode: (typeof modes)[number]) => modeNames[mode].replace(" Quiz", "").replace(" Challenge", "");

export default function Games() {
  usePhoneChrome({ title: "Games" });
  const { data, error, reload } = useHomeData();
  const running = data ? continueItems(data) : [];

  return (
    <div className="ph-games">
      <Section title="Choose a game">
        <ul className="ph-games-list">
          {list.map((game) => {
            const inProgress = running.filter((item) => item.game === game).length;
            return (
              <li key={game} className="ph-home-enter">
                <article className={`ph-games-card tone-${game}`} aria-label={gameTitles[game]}>
                  <GameTile
                    size="lg"
                    to={setupPath[game]}
                    title={gameTitles[game]}
                    text={gameIntros[game]}
                    stat={data ? gameStatLine(game, data) : null}
                    icon={game}
                    tone={game}
                    badge={
                      inProgress > 0 ? (
                        <span className="ph-home-pill ph-games-badge">
                          {inProgress} {inProgress === 1 ? "round" : "rounds"} in progress
                        </span>
                      ) : undefined
                    }
                  />
                  {game === "quiz" && (
                    <ul className="ph-games-modes" aria-label="Quiz modes">
                      {modes.map((mode) => (
                        <li key={mode}>
                          <Link className="ph-games-mode" to={`${paths.quiz}?mode=${mode}`} onClick={() => feel("tap")}>
                            <Icon name={modeIcons[mode]} size={16} />
                            {shortModeName(mode)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Learn">
        <ul className="ph-games-list">
          <li className="ph-home-enter">
            <article className="ph-games-card tone-explorer" aria-label="Explorer">
              <GameTile
                size="lg"
                to={paths.explorer}
                title="Explorer"
                text="A searchable atlas: capitals, flags, languages and neighbours."
                stat="Read-only · no score"
                icon="explorer"
                tone="explorer"
              />
            </article>
          </li>
        </ul>
      </Section>

      <StatusMessage tone="warning" retry={reload}>
        {error ? "Your progress could not be loaded. The games still work." : ""}
      </StatusMessage>
    </div>
  );
}
