import { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, IconName, IconTile, Tone } from "@shared/icons";

/** Plain surface. Use `as="section"` / `"article"` / `"li"` where it carries meaning. */
export function Card({
  as: Tag = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return <Tag className={["ph-card", className].filter(Boolean).join(" ")} {...rest} />;
}

type RowContent = {
  title: ReactNode;
  /** One short line under the title. */
  text?: ReactNode;
  /** Game / feature icon tile on the left. */
  icon?: IconName;
  tone?: Tone;
  /** Shown on the right instead of the chevron (e.g. a badge). */
  trailing?: ReactNode;
};

function RowInner({ title, text, icon, tone = "neutral", trailing }: RowContent) {
  return (
    <>
      {icon && <IconTile name={icon} tone={tone} />}
      <span className="ph-link-card-text">
        <strong>{title}</strong>
        {text && <small>{text}</small>}
      </span>
      {trailing ?? (
        <span className="ph-chevron" aria-hidden="true">
          <Icon name="chevronRight" size={20} />
        </span>
      )}
    </>
  );
}

/** Full-width tappable row that navigates (≥ 64 px high). */
export function LinkCard({ to, ...content }: RowContent & { to: string }) {
  return (
    <Link to={to} className="ph-link-card">
      <RowInner {...content} />
    </Link>
  );
}

/** Full-width tappable row that runs an action. */
export function ActionCard({ onClick, disabled, ...content }: RowContent & { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="ph-link-card" onClick={onClick} disabled={disabled}>
      <RowInner {...content} />
    </button>
  );
}

/** A titled group on a screen. The title is an h2 (the top bar holds the page h1). */
export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={["ph-section", className].filter(Boolean).join(" ")}>
      {title && <h2 className="ph-section-title">{title}</h2>}
      {children}
    </section>
  );
}
