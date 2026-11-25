// "Games" tab (route "/games"): big cards for every game in the phone app, with progress and rounds in progress.
import { Link } from "react-router-dom";
import { Icon, IconTile, games } from "@shared/icons";
import { modes } from "@shared/domain";
import { modeIcons, modeNames } from "@shared/quiz-meta";
import { Section, StatusMessage } from "@phone/ui";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { GameKey, continueItems, gameTitles, setupPath, useHomeData } from "./data";
import { gameStatLine } from "./HomeCards";
import "./home.css";

const list: { game: GameKey; text: string }[] = [
  { game: "quiz", text: "Multiple-choice questions in four modes." },
  { game: "flags", text: "Match flags and countries, region by region." },
  { game: "capitals", text: "Name capitals from memory – English, German or French." },
  { game: "recall", text: "Type every country or capital of a region." },
  { game: "elimination", text: "Chains of clues until only one place is left." },
];

const shortModeName = (mode: (typeof modes)[number]) => modeNames[mode].replace(" Quiz", "").replace(" Challenge", "");

export default function Games() {
  usePhoneChrome({ title: "Games" });
  const { data, error, reload } = useHomeData();
  const running = data ? continueItems(data) : [];

  return (
    <div className="ph-games">
      <Section title="Choose a game">
        <ul className="ph-stack">
          {list.map(({ game, text }) => {
            const inProgress = running.filter((item) => item.game === game).length;
            const stat = data ? gameStatLine(game, data) : null;
            return (
              <li key={game}>
                <article className="ph-games-card">
                  <Link to={setupPath[game]} className="ph-games-card-link">
                    <IconTile name={games[game].icon} tone={games[game].tone} size="lg" />
                    <span className="ph-games-card-body">
                      <strong className="ph-games-card-title">{gameTitles[game]}</strong>
                      <span className="ph-games-card-text">{text}</span>
                      {stat && <span className="ph-games-card-stat">{stat}</span>}
                      {inProgress > 0 && (
                        <span className="ph-home-pill ph-games-badge">
                          {inProgress} {inProgress === 1 ? "round" : "rounds"} in progress
                        </span>
                      )}
                    </span>
                    <span className="ph-games-card-go" aria-hidden="true">
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </Link>
                  {game === "quiz" && (
                    <ul className="ph-games-modes" aria-label="Quiz modes">
                      {modes.map((mode) => (
                        <li key={mode}>
                          <Link className="ph-games-mode" to={`${paths.quiz}?mode=${mode}`}>
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
      <StatusMessage tone="warning" retry={reload}>
        {error ? "Your progress could not be loaded. The games still work." : ""}
      </StatusMessage>
    </div>
  );
}
