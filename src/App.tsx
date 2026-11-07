import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate,
  useParams, useSearchParams
} from "react-router-dom";
import { api, configurationError, isDemo } from "./api";
import {
  avatars, categories, difficulties, level, Mode, modes, Difficulty, View
} from "./domain";
import { ErrorBox, Feedback, Loading, download, useLoad } from "./components";
import { analyticsEnabled, readEvents, setAnalytics, track } from "./analytics";

const Admin = lazy(() => import("./Admin"));
const Explorer = lazy(() => import("./Explorer"));

const names: Record<Mode, string> = {
  classic: "Classic Quiz", practice: "Practice",
  timed: "Timed Challenge", endless: "Endless"
};
const descriptions: Record<Mode, string> = {
  classic: "Ten questions. Four options. One new personal best.",
  practice: "Take your time. Learn from every answer. No XP pressure.",
  timed: "One minute. How far can your knowledge take you?",
  endless: "Three lives. Rising difficulty. Find your limit."
};

function Layout() {
  const location = useLocation();
  useEffect(() => {
    const title = document.querySelector("main h1") as HTMLElement | null;
    title?.focus({ preventScroll: true });
  }, [location.pathname]);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="border-b border-white/10">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-4">
        <Link to="/" className="flex items-center gap-3 font-black tracking-wider">
          <span className="logo" aria-hidden="true">A</span>
          ATLAS <span className="text-mint">ARENA</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap gap-1">
          <NavLink to="/home">Play</NavLink>
          <NavLink to="/explorer">Explorer</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </div>
    </header>
    {isDemo && <div className="demo-banner">
      LOCAL DEMO · Progress stays in this browser · Public, unverified sample questions
    </div>}
    <main id="main" className="shell py-8 md:py-12">
      <Suspense fallback={<Loading />}><Outlet /></Suspense>
    </main>
    <footer className="shell py-8 text-sm muted border-t border-white/10">
      Built for curious minds. No ads. No public chat.
      <span className="block mt-2">Maps and multiplayer are planned, not playable features.</span>
    </footer>
  </>;
}

function Welcome() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function start() {
    setPending(true); setError("");
    try { await api.guest(); navigate("/home"); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="grid md:grid-cols-2 gap-12 items-center py-8">
    <section>
      <p className="eyebrow">THE WORLD IS YOUR PLAYGROUND</p>
      <h1 tabIndex={-1} className="text-5xl md:text-7xl font-black leading-tight mt-5">
        Stay curious.<br /><span className="text-mint">Play the world.</span>
      </h1>
      <p className="muted text-lg mt-6 max-w-lg">
        Chase your next personal best, discover somewhere new, and turn what you know
        into your next great run.
      </p>
      <div className="flex flex-wrap gap-3 mt-8">
        <button className="primary" disabled={pending} onClick={start}>
          {pending ? "Preparing…" : "Play as Guest"} <span aria-hidden="true">→</span>
        </button>
        {!isDemo && <Link className="secondary" to="/auth">Sign in / create account</Link>}
      </div>
      <p className="text-sm muted mt-4">No account required. Your first adventure starts here.</p>
      <ErrorBox message={error} />
    </section>
    <div className="globe-card" aria-hidden="true">
      <svg viewBox="0 0 400 400" className="w-full max-w-md mx-auto">
        <defs>
          <radialGradient id="ocean"><stop stopColor="#1B2842"/><stop offset="1" stopColor="#0B1020"/></radialGradient>
        </defs>
        <circle cx="200" cy="200" r="150" fill="url(#ocean)" stroke="#35D0C5" strokeWidth="2"/>
        <g fill="none" stroke="#35D0C5" opacity=".35">
          <ellipse cx="200" cy="200" rx="75" ry="150"/>
          <ellipse cx="200" cy="200" rx="120" ry="150"/>
          <ellipse cx="200" cy="200" rx="150" ry="55"/>
          <ellipse cx="200" cy="200" rx="150" ry="105"/>
          <path d="M50 200h300M200 50v300"/>
        </g>
        <circle cx="282" cy="123" r="7" fill="#35D0C5"/>
        <circle cx="112" cy="226" r="7" fill="#8B7CF8"/>
        <path d="M112 226Q170 70 282 123" fill="none" stroke="#8B7CF8" strokeDasharray="5 7"/>
      </svg>
      <p className="text-center font-mono text-sm muted">EXPLORE · LEARN · LEVEL UP</p>
    </div>
  </div>;
}

function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>((modes as readonly string[]).includes(params.get("mode") ?? "")
    ? params.get("mode") as Mode : "classic");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    (difficulties as readonly string[]).includes(params.get("difficulty") ?? "")
      ? params.get("difficulty") as Difficulty : "easy");
  const [category, setCategory] = useState("all");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { data, error: loadError, reload } = useLoad(() => api.dashboard());
  const country = params.get("country") ?? undefined;

  async function start(e: FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try {
      const s = await api.play(mode, category === "all" ? [] : [category],
        difficulty, country, country && mode === "practice" ? 4 : 10);
      track("game_started", { mode, category, difficulty });
      navigate("/play/" + s.id);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }

  return <>
    <div className="flex justify-between flex-wrap gap-4 items-end">
      <div>
        <p className="eyebrow">YOUR NEXT ADVENTURE</p>
        <h1 tabIndex={-1} className="heading mt-2">Welcome back{data ? `, ${data.profile.username}` : ""}.</h1>
      </div>
      {data && <p className="pill">Level {level(data.profile.xp)} · {data.profile.xp} XP</p>}
    </div>
    <ErrorBox message={loadError} retry={reload}/>
    {loadError.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload}/>}
    {data && <div className="grid grid-cols-3 gap-3 my-7">
      <Stat title="Completed" value={data.totals.games}/>
      <Stat title="Accuracy" value={accuracy(data.totals.correct, data.totals.incorrect)}/>
      <Stat title="Classic best" value={data.best.classic ?? "—"}/>
    </div>}
    {data?.sessions.filter(s => s.status === "awaiting_answer" || s.status === "showing_feedback")
      .map(s => <Link className="card block mb-3 border-mint/40" key={s.id} to={"/play/" + s.id}>
        Resume {names[s.mode]} <span aria-hidden="true">→</span>
      </Link>)}
    <form onSubmit={start} className="mt-8">
      <fieldset>
        <legend className="text-xl font-bold mb-4">Choose your challenge</legend>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {modes.map((m, i) => <label key={m} className={`mode-card ${mode === m ? "selected" : ""}`}>
            <input className="sr-only" type="radio" name="mode" value={m}
              checked={mode === m} onChange={() => setMode(m)}/>
            <span className="text-2xl text-mint" aria-hidden="true">{["◎", "◇", "◷", "∞"][i]}</span>
            <span className="block font-bold text-lg mt-4">{names[m]}</span>
            <span className="block text-sm muted mt-2">{descriptions[m]}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="card mt-5 grid md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
        <label>Category
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="all">All available geography</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>{mode === "endless" ? "Starting difficulty" : "Difficulty"}
          <select value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}>
            {difficulties.map(d => <option key={d}>{d}</option>)}
          </select>
        </label>
        <button className="primary" disabled={pending || !!loadError}>
          {pending ? "Creating session…" : "Start adventure →"}
        </button>
      </div>
      {country && <p className="muted mt-3">
        Country-focused practice: {country}. Four questions requested.
        {" "}<Link className="text-mint underline" to="/home">Clear country filter</Link>
      </p>}
      <p className="text-sm muted mt-3">
        Exact filters are respected. Empty or insufficient pools are reported, never replaced.
        {isDemo && " The sample bank currently supports Easy; other tiers return an honest empty-pool message."}
      </p>
      <ErrorBox message={error}/>
    </form>
  </>;
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return <div className="card p-4">
    <p className="muted text-xs sm:text-sm">{title}</p>
    <p className="text-xl sm:text-3xl font-black mt-2">{value}</p>
  </div>;
}
function GuestSessionRecovery({ retry }: { retry: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function restore() {
    setPending(true); setError("");
    try { await api.guest(); retry(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="mt-3">
    <p className="muted">Your existing guest session is restored when available. A new guest is created only if this browser has no session.</p>
    <button className="secondary mt-3" disabled={pending} onClick={restore}>
      {pending ? "Restoring…" : "Continue as guest"}
    </button>
    <ErrorBox message={error}/>
  </div>;
}
function accuracy(correct: number, incorrect: number) {
  return correct + incorrect ? `${Math.round(100 * correct / (correct + incorrect))}%` : "—";
}

function Game() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  const finalizedEvent = useRef(false);

  function accept(v: View) {
    offset.current = Date.parse(v.serverNow) - Date.now();
    setView(old => !old || old.id !== v.id || v.version >= old.version ? v : old);
  }
  async function refresh() {
    try { accept(await api.view(id)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    setView(undefined); finalizedEvent.current = false; void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  const remaining = view?.deadline
    ? Math.max(0, Date.parse(view.deadline) - now - offset.current) : null;

  useEffect(() => {
    if (view?.deadline && remaining === 0
      && view.status !== "completed" && view.status !== "abandoned") {
      void refresh();
      const retry = setInterval(() => void refresh(), 2000);
      return () => clearInterval(retry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0, view?.status, id]);

  useEffect(() => {
    if (view?.status === "completed") {
      if (!finalizedEvent.current) {
        finalizedEvent.current = true;
        track("game_completed", {
          mode: view.mode, correct: view.stats.correct, incorrect: view.stats.incorrect,
          responseDurationMs: Math.round(view.stats.averageMs * view.answered)
        });
      }
      navigate("/results/" + view.id, { replace: true });
    }
  }, [view, navigate]);

  async function action(kind: "answer" | "next", option?: string) {
    if (!view || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError("");
    try {
      const next = kind === "answer"
        ? await api.answer(id, view.current!.id, option!)
        : await api.next(id);
      accept(next);
    } catch (e) {
      setError((e as Error).message + " If the connection failed, reload state before retrying.");
    } finally { pendingRef.current = false; setPending(false); }
  }

  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.repeat || view?.status !== "awaiting_answer" || remaining === 0) return;
      const index = Number(e.key) - 1;
      const option = view.current?.options[index];
      if (option) { e.preventDefault(); void action("answer", option.id); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!view) return <><Loading/><ErrorBox message={error} retry={refresh}/></>;
  if (view.status === "abandoned") return <section className="card">
    <h1 tabIndex={-1} className="heading">This run was abandoned.</h1>
    <Link className="primary mt-5" to="/home">Choose a new challenge</Link>
  </section>;

  return <div className="max-w-3xl mx-auto">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="eyebrow">{names[view.mode]} · {view.current?.difficulty ?? view.difficulty}</p>
      <button className="secondary" disabled={pending} onClick={async () => {
        if (!confirm("Abandon this run? No XP will be awarded.")) return;
        try { await api.abandon(id); navigate("/home"); }
        catch (e) { setError((e as Error).message); }
      }}>Leave run</button>
    </div>
    <div className="grid grid-cols-3 gap-3 my-6">
      <Stat title="Score" value={view.stats.score}/>
      <Stat title={view.mode === "endless" ? "Lives" : "Answered"}
        value={view.mode === "endless" ? Math.max(0, 3 - view.stats.incorrect)
          : `${view.answered}/${view.total}`}/>
      <Stat title={remaining !== null ? "Time left" : "Streak"}
        value={remaining !== null ? `${Math.ceil(remaining / 1000)}s` : view.stats.streak}/>
    </div>
    {remaining !== null && <div className="mb-6">
      <label className="sr-only" htmlFor="time-progress">Session time remaining</label>
      <progress id="time-progress" max={60000} value={remaining} className="w-full"/>
      <p className="text-sm muted mt-2">60-second session. Server receipt determines whether an answer is on time.</p>
    </div>}
    {view.current && <section className="card">
      <p className="muted text-sm capitalize">{view.current.subcategory}</p>
      <h1 tabIndex={-1} className="text-2xl md:text-3xl font-bold mt-3 mb-6">{view.current.prompt}</h1>
      <div className="grid gap-3">
        {view.current.options.map((o, i) =>
          <button key={o.id} className="answer text-left"
            disabled={pending || view.status !== "awaiting_answer" || remaining === 0}
            onClick={() => void action("answer", o.id)}>
            <span className="keycap" aria-hidden="true">{i + 1}</span>{o.label}
          </button>)}
      </div>
    </section>}
    <ErrorBox message={error} retry={refresh}/>
    {view.feedback && <div className="mt-4">
      <Feedback review={view.feedback}/>
      <button autoFocus className="primary w-full mt-4" disabled={pending || remaining === 0}
        onClick={() => void action("next")}>{pending ? "Loading…" : "Next question →"}</button>
    </div>}
    {remaining === 0 && view.status !== "completed" &&
      <p className="mt-4" role="status">Time is up. Confirming the final result…</p>}
  </div>;
}

function Results() {
  const { id = "" } = useParams();
  const { data: v, error, reload } = useLoad(() => api.view(id), id);
  if (!v) return <><Loading/><ErrorBox message={error} retry={reload}/></>;
  if (v.status !== "completed") return <section className="card">
    <h1 tabIndex={-1} className="heading">This run has not completed.</h1>
    <Link className="primary mt-4" to={"/play/" + id}>Resume run</Link>
  </section>;
  return <>
    <p className="eyebrow">ADVENTURE COMPLETE · {names[v.mode]}</p>
    <h1 tabIndex={-1} className="heading mt-3">A little more world. A little more you.</h1>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 my-7">
      <Stat title="Final score" value={v.stats.score}/>
      <Stat title="Accuracy" value={accuracy(v.stats.correct, v.stats.incorrect)}/>
      <Stat title="XP earned" value={v.stats.xp}/>
      <Stat title="Correct / incorrect" value={`${v.stats.correct} / ${v.stats.incorrect}`}/>
      <Stat title="Average response" value={`${(v.stats.averageMs / 1000).toFixed(1)}s`}/>
      <Stat title="Best streak" value={v.stats.bestStreak}/>
    </div>
    <p className="muted text-sm">
      Average response time is the sum of accepted answer response times divided by accepted
      answers. It excludes explanation screens and unanswered questions.
      Practice earns no competitive XP.
    </p>
    <div className="flex flex-wrap gap-3 my-6">
      <Link className="primary" to={`/home?mode=${v.mode}&difficulty=${v.difficulty}`}>Play again</Link>
      <Link className="secondary" to="/home">Change mode</Link>
    </div>
    <h2 className="text-2xl font-bold mb-4">Your answer review</h2>
    <div className="grid gap-4">
      {v.reviews.length === 0 && <p className="muted">No answers were accepted in this run.</p>}
      {[...v.reviews].sort((a, b) => Number(a.correct) - Number(b.correct)).map(r =>
        <article key={r.questionId}>
          <h3 className="font-semibold mb-2">{r.prompt}</h3>
          <Feedback review={r}/>
        </article>)}
    </div>
  </>;
}

function ProfilePage() {
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useLoad(() => api.dashboard(offset), offset);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data) return <><Loading/><ErrorBox message={error} retry={reload}/>
    {error.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload}/>}
  </>;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      await api.saveProfile({
        username: String(form.get("username")),
        avatar: Number(form.get("avatar")),
        favorites: form.getAll("favorites").map(String)
      });
      setMessage("Profile saved."); reload();
    } catch (e) { setMessage((e as Error).message); }
    finally { setSaving(false); }
  }
  return <>
    <h1 tabIndex={-1} className="heading">Your explorer profile</h1>
    <div className="grid md:grid-cols-2 gap-6 mt-6">
      <form className="card space-y-5" onSubmit={save} key={data.profile.username}>
        <label>Username<input name="username" required minLength={2} maxLength={24}
          pattern="[A-Za-z0-9 _\-]+" defaultValue={data.profile.username}/></label>
        <label>Avatar<select name="avatar" defaultValue={data.profile.avatar}>
          {avatars.map((a, i) => <option key={i} value={i}>Avatar {i + 1} {a}</option>)}
        </select></label>
        <fieldset>
          <legend className="mb-3">Favorite categories</legend>
          <div className="grid grid-cols-2 gap-2">
            {categories.map(c => <label className="check" key={c}>
              <input type="checkbox" name="favorites" value={c}
                defaultChecked={data.profile.favorites.includes(c)}/>{c}
            </label>)}
          </div>
        </fieldset>
        <button className="primary" disabled={saving}>Save profile</button>
        <p role="status">{message}</p>
      </form>
      <section className="card">
        <p className="text-5xl" aria-label={`Avatar ${data.profile.avatar + 1}`}>{avatars[data.profile.avatar]}</p>
        <h2 className="text-2xl font-bold mt-4">Level {level(data.profile.xp)}</h2>
        <p className="muted">{data.profile.xp} XP · {500 - data.profile.xp % 500} XP to next level</p>
        <progress className="w-full my-5" max={500} value={data.profile.xp % 500} aria-label="Level progress"/>
        <p>{data.totals.games} completed games · {accuracy(data.totals.correct, data.totals.incorrect)} accuracy</p>
        <h3 className="font-bold mt-6 mb-2">Best scores by mode</h3>
        {(["classic", "timed", "endless"] as Mode[]).map(m =>
          <p key={m} className="flex justify-between py-2 border-b border-white/10">
            <span>{names[m]}</span><strong>{data.best[m] ?? "—"}</strong>
          </p>)}
        {!isDemo && <Link className="secondary mt-5" to="/auth">Secure guest progress / sign in</Link>}
        {data.profile.admin && <Link className="secondary mt-3" to="/admin">Content administration</Link>}
      </section>
    </div>
    <h2 className="text-2xl font-bold mt-9 mb-4">Recent sessions</h2>
    {!data.sessions.length && <p className="muted">No games yet. Your first run is waiting.</p>}
    <div className="space-y-2">
      {data.sessions.map(s => <div key={s.id} className="card flex flex-wrap justify-between gap-3">
        <div><strong>{names[s.mode]}</strong><p className="muted text-sm">{new Date(s.createdAt).toLocaleString()} · {s.status}</p></div>
        <span>{s.score} points</span>
        {s.status !== "abandoned" && <Link className="secondary"
          to={`/${s.status === "completed" ? "results" : "play"}/${s.id}`}>
          {s.status === "completed" ? "Review" : "Resume"}
        </Link>}
      </div>)}
    </div>
    <div className="flex gap-3 mt-4">
      <button className="secondary" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous</button>
      <button className="secondary" disabled={data.sessions.length < 20} onClick={() => setOffset(n => n + 20)}>Next</button>
    </div>
  </>;
}

function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [action, setAction] = useState(params.has("recovery") ? "change" : "link");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      if (action === "signin") {
        if (!confirm("Signing into a different existing account does not merge this guest's progress. Continue?")) return;
        await api.signIn(email, password); navigate("/home");
      } else if (action === "reset") {
        await api.resetPassword(email);
        setMessage("If the account exists, a recovery message has been requested.");
      } else if (action === "change") {
        await api.changePassword(password); navigate("/home");
      } else {
        await api.link(email, password);
        setMessage("Account update requested. Follow the email confirmation link if required. This upgrades the current guest identity; it does not merge accounts.");
      }
    } catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  }
  return <section className="card max-w-lg mx-auto">
    <h1 tabIndex={-1} className="heading">Keep your discoveries.</h1>
    {isDemo ? <p className="muted mt-4">Account features require Supabase. Local demo data is not imported into server accounts.</p>
      : <form className="space-y-5 mt-5" onSubmit={submit}>
        <label>Account action<select value={action} onChange={e => setAction(e.target.value)}>
          <option value="link">Create account from this guest</option>
          <option value="signin">Sign in to an existing account</option>
          <option value="reset">Request password reset</option>
          {params.has("recovery") && <option value="change">Set a new password</option>}
        </select></label>
        {action !== "change" && <label>Email<input type="email" name="email" autoComplete="email" required/></label>}
        {action !== "reset" && <label>Password<input type="password" name="password" minLength={12}
          autoComplete={action === "signin" ? "current-password" : "new-password"} required/></label>}
        <button className="primary w-full" disabled={pending}>{pending ? "Working…" : "Continue"}</button>
      </form>}
    <p className="mt-4" role="status">{message}</p>
  </section>;
}

function Settings() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState(analyticsEnabled());
  const [motion, setMotion] = useState(localStorage.getItem("atlas-motion") === "reduce");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function run(task: () => Promise<unknown>) {
    setPending(true); setMessage("");
    try { await task(); }
    catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="max-w-2xl">
    <h1 tabIndex={-1} className="heading">Make yourself at home.</h1>
    <section className="card mt-6 space-y-5">
      <h2 className="text-xl font-bold">Comfort and privacy</h2>
      <label className="check"><input type="checkbox" checked={motion} onChange={e => {
        setMotion(e.target.checked);
        localStorage.setItem("atlas-motion", e.target.checked ? "reduce" : "system");
        document.documentElement.dataset.motion = e.target.checked ? "reduce" : "system";
      }}/>Reduce motion in addition to the system preference</label>
      <p className="muted">No sound effects are enabled. For untimed play, choose Classic or Practice.</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={e => {
        setConsent(e.target.checked); setAnalytics(e.target.checked);
      }}/>Keep a local diagnostic event log (optional)</label>
      <p className="muted text-sm">Up to 100 events, on this device only. No advertising, tracking cookies, or analytics transmission.</p>
      <button className="secondary" onClick={() => download("atlas-diagnostics.json", readEvents())}>Export local diagnostics</button>
    </section>
    <section className="card mt-5 space-y-4">
      <h2 className="text-xl font-bold">Your data</h2>
      <p className="muted">
        Progress is retained until you delete it. Demo data is device-local.
        Server records belong to your authenticated identity. Anonymous progress can be lost
        if browser credentials are cleared before linking an account.
      </p>
      <div className="flex flex-wrap gap-3">
        <button className="secondary" disabled={pending} onClick={() => void run(async () => {
          download("atlas-data.json", await api.exportData());
        })}>Export my data</button>
        <button className="secondary" disabled={pending} onClick={() => void run(async () => {
          await api.signOut(); navigate("/");
        })}>Sign out</button>
        <button className="danger-button" disabled={pending} onClick={() => {
          if (prompt("Type DELETE to permanently delete this account and its progress.") !== "DELETE") return;
          void run(async () => {
            await api.deleteAccount();
            setAnalytics(false);
            navigate("/");
          });
        }}>Delete {isDemo ? "demo data" : "account"}</button>
      </div>
      <p role="status">{message}</p>
    </section>
    <section className="card mt-5">
      <h2 className="text-xl font-bold">Install and offline use</h2>
      <p className="muted mt-3">
        Use your browser's install command when available. On iPhone/iPad, use Safari's
        Share → Add to Home Screen. After a production build has loaded and cached,
        the app shell and local demo can work offline. Supabase games, sign-in, and
        administration require connectivity. Browser storage may be evicted.
      </p>
      <p className="muted mt-3">
        This software is not a legal compliance certification. A deployed service needs
        a reviewed privacy notice, operator contact details, retention policy,
        hosting agreements, and age/consent assessment.
      </p>
    </section>
  </div>;
}

export default function App() {
  if (configurationError) return <main className="shell py-10"><ErrorBox message={configurationError}/></main>;
  return <Routes>
    <Route element={<Layout/>}>
      <Route index element={<Welcome/>}/>
      <Route path="home" element={<Home/>}/>
      <Route path="play/:id" element={<Game/>}/>
      <Route path="results/:id" element={<Results/>}/>
      <Route path="profile" element={<ProfilePage/>}/>
      <Route path="settings" element={<Settings/>}/>
      <Route path="auth" element={<Auth/>}/>
      <Route path="explorer" element={<Explorer/>}/>
      <Route path="admin" element={<Admin/>}/>
      <Route path="*" element={<section className="card">
        <h1 tabIndex={-1} className="heading">Uncharted territory.</h1>
        <Link className="primary mt-5" to="/">Return home</Link>
      </section>}/>
    </Route>
  </Routes>;
}
