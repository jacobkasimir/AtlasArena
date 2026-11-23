import { FormEvent, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { Mode, avatarLabels, avatars, categories, countryFlagAvatarCount, level } from "./domain";
import { accuracy, modeNames } from "./quiz-meta";

import { AccountActions, GuestSessionRecovery, authMessage } from "./Auth";
import { Statistics } from "./Statistics";

export function AvatarPicker({ value }: { value: number }) {
  const initial = Number.isInteger(value) && value >= 0 && value < avatars.length ? value : 0;
  const [selected, setSelected] = useState(initial);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  function choose(index: number) {
    setSelected(index);
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }
  return (
    <div className="avatar-picker">
      <input type="hidden" name="avatar" value={selected} />
      <button
        ref={triggerRef}
        type="button"
        className="avatar-picker-trigger"
        aria-expanded={open}
        aria-controls="avatar-picker-options"
        aria-label={`Choose avatar. Current selection: ${avatarLabels[selected]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar-picker-trigger-emoji" aria-hidden="true">
          {avatars[selected]}
        </span>
        <span className="avatar-picker-trigger-copy">
          <small>Selected avatar</small>
          <strong>{avatarLabels[selected]}</strong>
        </span>
        <span className="avatar-picker-trigger-count">{avatars.length} options</span>
        <span className={`avatar-picker-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="avatar-picker-panel">
          <p className="avatar-picker-panel-label">
            Choose an avatar <span>{countryFlagAvatarCount} country flags</span>
          </p>
          <div
            className="avatar-picker-grid"
            id="avatar-picker-options"
            role="radiogroup"
            aria-label="Choose an avatar"
          >
            {avatars.map((avatar, index) => (
              <label key={index} className="player-avatar-choice" title={avatarLabels[index]}>
                <input
                  type="radio"
                  name="avatar-picker-choice"
                  value={index}
                  checked={selected === index}
                  onChange={() => choose(index)}
                  aria-label={avatarLabels[index]}
                />
                <span aria-hidden="true">{avatar}</span>
                <span className="sr-only">{avatarLabels[index]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export function ProfilePage() {
  const { onProfileUpdated } = useOutletContext<{ onProfileUpdated: (username: string, avatar: number) => void }>();
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useLoad(() => api.dashboard(offset), offset);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data)
    return error ? (
      <>
        <ErrorBox message={error} retry={reload} />
        {error.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload} />}
      </>
    ) : (
      <Loading />
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const username = String(form.get("username"));
      const avatar = Number(form.get("avatar"));
      await api.saveProfile({
        username,
        avatar,
        favorites: form.getAll("favorites").map(String),
      });
      onProfileUpdated(username, avatar);
      setMessage("Profile saved.");
      reload();
    } catch (e) {
      setMessage(authMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="profile-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">YOUR ATLAS</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Your explorer profile
          </h1>
        </div>
        <p className="muted">Your identity, progress, and personal bests.</p>
      </div>
      <div className="profile-layout mt-6">
        <form className="card profile-form space-y-5" onSubmit={save} key={data.profile.username}>
          <label>
            Username
            <input
              name="username"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9 _\-]+"
              defaultValue={data.profile.username}
            />
          </label>
          <fieldset>
            <legend className="mb-3">Choose an avatar</legend>
            <AvatarPicker value={data.profile.avatar} />
          </fieldset>
          <fieldset>
            <legend className="mb-3">Favorite topics</legend>
            <div className="player-favorite-grid">
              {categories.map((c) => (
                <label className="player-favorite-choice" key={c}>
                  <input
                    type="checkbox"
                    name="favorites"
                    value={c}
                    defaultChecked={data.profile.favorites.includes(c)}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary" disabled={saving}>
            Save profile
          </button>
          <p role="status">{message}</p>
        </form>
        <section className="card profile-summary">
          <div className="profile-avatar-display">
            <span aria-hidden="true">{avatars[data.profile.avatar]}</span>
            <div>
              <p className="eyebrow">PERSONAL EXPLORER</p>
              <strong>{data.profile.username}</strong>
            </div>
          </div>
          <h2 className="text-2xl font-bold mt-4">Level {level(data.profile.xp)}</h2>
          <p className="muted">
            {data.profile.xp} XP · {500 - (data.profile.xp % 500)} XP to next level
          </p>
          <progress className="w-full my-5" max={500} value={data.profile.xp % 500} aria-label="Level progress" />
          <p>
            {data.totals.games} completed games · {accuracy(data.totals.correct, data.totals.incorrect)} accuracy
          </p>
          <h3 className="font-bold mt-6 mb-2">Quiz best scores</h3>
          {(["classic", "timed", "endless"] as Mode[]).map((m) => (
            <p key={m} className="flex justify-between py-2 border-b border-line/15">
              <span>{modeNames[m]}</span>
              <strong>{data.best[m] ?? "—"}</strong>
            </p>
          ))}
          <h3 className="font-bold mt-6 mb-2">Favorite topics</h3>
          <div className="profile-favorite-tags">
            {data.profile.favorites.length ? (
              data.profile.favorites.map((category) => <span key={category}>{category}</span>)
            ) : (
              <span className="muted">No favorite topics selected</span>
            )}
          </div>
          {!isDemo && <AccountActions />}
          {data.profile.admin && (
            <Link className="secondary mt-3" to="/admin">
              Content administration
            </Link>
          )}
        </section>
      </div>
      <Statistics />
      <div className="section-heading mt-9 mb-4">
        <div>
          <p className="eyebrow">YOUR JOURNEY</p>
          <h2 className="text-2xl font-bold mt-2">Recent quiz games</h2>
        </div>
        <span className="muted text-sm">{data.sessions.length} recent</span>
      </div>
      {!data.sessions.length && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            ◎
          </span>
          <h3 className="font-bold mt-3">Your first run is waiting</h3>
          <p className="muted mt-2">Complete an adventure and your latest results will appear here.</p>
          <Link className="primary mt-4" to="/home">
            Choose a challenge
          </Link>
        </div>
      )}
      <div className="session-list grid gap-2">
        {data.sessions.map((s) => (
          <div key={s.id} className="card flex flex-wrap justify-between gap-3">
            <div>
              <strong>{modeNames[s.mode]}</strong>
              <p className="muted text-sm">
                {new Date(s.createdAt).toLocaleString()} · {s.status}
              </p>
            </div>
            <span>{s.score} points</span>
            {s.status !== "abandoned" && (
              <Link className="secondary" to={`/${s.status === "completed" ? "results" : "play"}/${s.id}`}>
                {s.status === "completed" ? "Review" : "Resume"}
              </Link>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button className="secondary" disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 20))}>
          Previous
        </button>
        <button className="secondary" disabled={data.sessions.length < 20} onClick={() => setOffset((n) => n + 20)}>
          Next
        </button>
      </div>
    </div>
  );
}
