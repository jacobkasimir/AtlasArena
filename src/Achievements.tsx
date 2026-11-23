// Achievement badges: tiered hexagon badges, and the full grid grouped by category with tier totals and filters.
import { useState } from "react";
import type { Achievement, AchievementCategory, AchievementTier } from "./domain";
import { Icon, iconNames, type IconName } from "./icons";
import { Meter } from "./setup-ui";

export const tierNames: Record<AchievementTier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
const tiers: AchievementTier[] = ["bronze", "silver", "gold", "platinum"];
const categories: { id: AchievementCategory; label: string }[] = [
  { id: "quiz", label: "Quiz" },
  { id: "progress", label: "Level" },
  { id: "daily", label: "Daily challenge" },
  { id: "flags", label: "Flags" },
  { id: "capitals", label: "Capitals" },
  { id: "recall", label: "Recall" },
  { id: "review", label: "Review" },
];

const iconOf = (name: string): IconName => (iconNames as string[]).includes(name) ? (name as IconName) : "star";
// Older servers sent no tier; treat those badges as bronze.
const tierOf = (item: Achievement): AchievementTier => tiers.includes(item.tier) ? item.tier : "bronze";

export function Badge({ item, size = "md" }: { item: Achievement; size?: "sm" | "md" | "lg" }) {
  const px = size === "lg" ? 30 : size === "sm" ? 15 : 22;
  return (
    <span className={`badge badge-${size} tier-${tierOf(item)}${item.earned ? " is-earned" : " is-locked"}`}
      title={`${item.title} · ${tierNames[tierOf(item)]}`} aria-hidden="true">
      <span className="badge-inner"><Icon name={iconOf(item.icon)} size={px} /></span>
    </span>
  );
}

type Filter = "all" | "earned" | "open";

export function AchievementsGrid({ achievements }: { achievements: Achievement[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const earned = achievements.filter((item) => item.earned).length;
  const visible = achievements.filter((item) => filter === "all" || (filter === "earned" ? item.earned : !item.earned));
  const groups = categories
    .map((category) => ({ ...category, items: visible.filter((item) => (item.category ?? "quiz") === category.id) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="achievements">
      <div className="achievements-summary">
        <div className="achievements-total">
          <strong>{earned}</strong><span>/ {achievements.length}</span>
          <small>badges earned</small>
          <Meter done={earned} total={achievements.length} label={`${earned} of ${achievements.length} badges earned`} />
        </div>
        <ul className="achievements-tiers" aria-label="Badges by tier">
          {tiers.map((tier) => {
            const all = achievements.filter((item) => tierOf(item) === tier);
            return (
              <li key={tier} className={`tier-${tier}`}>
                <span className="tier-dot" aria-hidden="true" />
                <span>{tierNames[tier]}</span>
                <strong>{all.filter((item) => item.earned).length}/{all.length}</strong>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="chips mt-4" role="group" aria-label="Show badges">
        {([["all", "All"], ["earned", "Earned"], ["open", "Still to earn"]] as [Filter, string][]).map(([id, label]) => (
          <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      {groups.length === 0 && <p className="muted text-sm mt-4">{filter === "earned" ? "No badges yet – finish a game to earn your first." : "Every badge earned. Impressive!"}</p>}
      {groups.map((group) => (
        <section key={group.id} className="achievements-group" aria-label={group.label}>
          <h4>{group.label}<span>{group.items.filter((item) => item.earned).length}/{group.items.length}</span></h4>
          <ul className="achievements-grid">
            {group.items.map((item) => (
              <li key={item.id} className={`achievement-card tier-${tierOf(item)}${item.earned ? " is-earned" : ""}`}>
                <Badge item={item} />
                <div className="achievement-body">
                  <div className="achievement-head">
                    <strong>{item.title}</strong>
                    <span className="tier-pill">{tierNames[tierOf(item)]}</span>
                  </div>
                  <p>{item.description}</p>
                  {item.earned ? (
                    <span className="achievement-done"><Icon name="check" size={13} /> Earned</span>
                  ) : (
                    <div className="achievement-progress">
                      <Meter done={item.current} total={item.target} label={`${item.current} of ${item.target}`} />
                      <small>{item.current.toLocaleString()} / {item.target.toLocaleString()}</small>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
