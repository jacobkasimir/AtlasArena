import { Link, useLocation } from "react-router-dom";
import { Icon, IconName } from "@shared/icons";
import { feel } from "@phone/ui";
import { gamePrefixes, isUnder, paths } from "./paths";

type Tab = { to: string; label: string; icon: IconName; active: (pathname: string) => boolean };

export const tabs: Tab[] = [
  { to: paths.home, label: "Home", icon: "home", active: (p) => p === paths.home },
  { to: paths.games, label: "Games", icon: "gamepad", active: (p) => gamePrefixes.some((prefix) => isUnder(p, prefix)) },
  { to: paths.profile, label: "Profile", icon: "user", active: (p) => isUnder(p, paths.profile) },
  { to: paths.settings, label: "Settings", icon: "settings", active: (p) => isUnder(p, paths.settings) },
];

/** Bottom navigation (thumb zone): icon + label, active pill, light haptic on switching. Hidden while the keyboard is
 * open and when a screen asks for it (rounds). */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="ph-tabbar" aria-label="Main">
      {tabs.map((tab) => {
        const active = tab.active(pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={active ? "ph-tab is-active" : "ph-tab"}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (!active) feel("select");
            }}
          >
            <span className="ph-tab-icon" aria-hidden="true">
              <Icon name={tab.icon} size={22} />
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
