import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate,
  useParams, useSearchParams
} from "react-router-dom";
import { api, configurationError, isDemo, supabase } from "./api";
import {
  avatars, categories, difficulties, level, Mode, modes, Difficulty, View, validUsername
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
function applyTheme(theme:string){
  if(theme==="system")delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme=theme;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",theme==="light"||(theme==="system"&&matchMedia("(prefers-color-scheme: light)").matches)?"#f5f8ff":"#0B1020");
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [userMenu, setUserMenu] = useState(false);
  const [menuMessage,setMenuMessage]=useState("");
  const [identity, setIdentity] = useState<{username:string; avatar:number; isAnonymous:boolean} | null>(null);
  const menuButtonRef=useRef<HTMLButtonElement>(null);
  useEffect(() => { let live=true; if (isDemo) { setIdentity(localStorage.getItem("atlas-demo-signed-out")==="yes"?null:{username:"Traveler",avatar:0,isAnonymous:true}); return; }
    supabase?.auth.getSession().then(({data})=>{if(live&&data.session?.user){const m=data.session.user.user_metadata??{};const isAnonymous=Boolean(data.session.user.is_anonymous);setIdentity({username:String(m.username??m.requested_username??"Explorer"),avatar:Number(m.avatar??0),isAnonymous});
      api.dashboard().then(d=>{if(live)setIdentity({username:d.profile.username,avatar:d.profile.avatar,isAnonymous})}).catch(()=>{});
    }});
    return () => { live=false; };
  }, [location.pathname]);
  useEffect(() => { if(!userMenu) return; const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setUserMenu(false);menuButtonRef.current?.focus()}};
    window.addEventListener("keydown",close); return ()=>window.removeEventListener("keydown",close);
  },[userMenu]);
  useEffect(() => {
    const title = document.querySelector("main h1") as HTMLElement | null;
    title?.focus({ preventScroll: true });
  }, [location.pathname]);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="border-b border-white/10">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-4">
        <Link to="/home" className="brand-link" aria-label="Atlas Arena – Startseite">
          <img className="brand-mark logo-light" src="/icons/light.jpg" alt="" />
          <img className="brand-mark logo-dark" src="/icons/dark.png" alt="" />
          <img className="brand-wordmark wordmark-light" src="/icons/text_light.jpg" alt="" />
          <img className="brand-wordmark wordmark-dark" src="/icons/text_dark.png" alt="" />
        </Link>
        <nav aria-label="Primary" className="topbar-nav flex flex-wrap gap-1 items-center">
          {identity && <><NavLink to="/home">Play</NavLink><NavLink to="/explorer">Explorer</NavLink>
          <NavLink className="topbar-icon" to="/profile" aria-label="Statistiken" title="Statistiken"><ChartIcon/></NavLink>
          <NavLink className="topbar-icon" to="/settings" aria-label="Einstellungen" title="Einstellungen"><SettingsIcon/></NavLink>
          <div className="user-menu-wrap"><button ref={menuButtonRef} className="user-menu-button" aria-label="Benutzermenü öffnen" aria-expanded={userMenu} aria-haspopup="menu" onClick={()=>setUserMenu(v=>!v)}><span aria-hidden="true">{avatars[identity.avatar] ?? avatars[0]}</span><span className="user-name">{identity.username}</span><span aria-hidden="true">⌄</span></button>
          {userMenu && <div className="user-menu" role="menu">
            {identity.isAnonymous&&<Link role="menuitem" to="/auth?mode=link" onClick={()=>setUserMenu(false)}>Konto erstellen und Spielstand sichern</Link>}
            {menuMessage&&<p className="error" role="alert">{menuMessage}</p>}
            {!identity.isAnonymous&&<button role="menuitem" onClick={async()=>{
              try {
                await api.signOut(); localStorage.removeItem("atlas-view-cache"); setIdentity(null); navigate("/",{replace:true});
              } catch(e) { setMenuMessage((e as Error).message||"Abmelden fehlgeschlagen. Deine Sitzung bleibt aktiv."); }
            }}>Abmelden</button>}
          </div>}</div></>}
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

function ChartIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-7m4 7V4"/></svg>}
function SettingsIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.2.9-1.4 2.4-1.4-.6a8 8 0 0 1-1.5.9l-.2 1.5h-2.8l-.2-1.5a8 8 0 0 1-1.5-.9l-1.4.6-1.4-2.4 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.4-2.4 1.4.6a8 8 0 0 1 1.5-.9l.2-1.5h2.8l.2 1.5a8 8 0 0 1 1.5.9l1.4-.6 1.4 2.4-1.2.9a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1)"/></svg>}

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
      <div className="welcome-actions mt-8">
        {!isDemo && <Link className="primary action-card action-card-featured" to="/auth?mode=guest"><span className="action-icon" aria-hidden="true">✦</span><span><strong>Als Gast spielen</strong><small>Sofort starten, ganz ohne Konto</small></span><span className="action-arrow" aria-hidden="true">→</span></Link>}
        {isDemo && <button className="primary action-card action-card-featured" disabled={pending} onClick={start}><span className="action-icon" aria-hidden="true">✦</span><span><strong>{pending ? "Wird vorbereitet …" : "Als Gast spielen"}</strong><small>Sofort starten, ganz ohne Konto</small></span><span className="action-arrow" aria-hidden="true">→</span></button>}
        {!isDemo && <Link className="secondary action-card" to="/auth?mode=signin"><span className="action-icon" aria-hidden="true">↗</span><span><strong>Anmelden</strong><small>Mit deinem Konto fortfahren</small></span><span className="action-arrow" aria-hidden="true">→</span></Link>}
        {!isDemo && <Link className="secondary action-card" to="/auth?mode=signup"><span className="action-icon" aria-hidden="true">＋</span><span><strong>Konto erstellen</strong><small>Fortschritt dauerhaft sichern</small></span><span className="action-arrow" aria-hidden="true">→</span></Link>}
      </div>
      <p className="text-sm muted mt-4">Dein Gastzugang funktioniert ohne Registrierung.</p>
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
    } catch (e) { setMessage(authMessage((e as Error).message)); }
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
        {!isDemo && <AccountActions/>}
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
function authMessage(message:string){const m=message.toLowerCase();if(m.includes("invalid login credentials"))return "E-Mail oder Passwort ist nicht korrekt.";if(m.includes("email not confirmed"))return "Bitte bestätige zuerst deine E-Mail-Adresse.";if(m.includes("user already registered")||m.includes("already been registered"))return "Für diese E-Mail gibt es bereits ein Konto. Melde dich an oder setze dein Passwort zurück.";if(m.includes("password")&&m.includes("least"))return "Das Passwort erfüllt die Mindestlänge nicht.";if(m.includes("email address")&&m.includes("already"))return "Diese E-Mail-Adresse wird bereits verwendet.";if(/duplicate|unique|username_taken/i.test(message))return "Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen.";return message;}

function Onboarding(){const [message,setMessage]=useState("");const [pending,setPending]=useState(false);const nav=useNavigate();
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setPending(true);setMessage("");const name=String(new FormData(e.currentTarget).get("username")??"").trim();
    try{if(!validUsername(name))throw new Error("Verwende 2–24 Zeichen: Buchstaben, Zahlen, Leerzeichen, _ oder -.");await api.claimUsername(name);if(isDemo)localStorage.setItem("atlas-demo-onboarded","yes");nav("/home",{replace:true});}
    catch(err){const m=(err as Error).message;setMessage(/duplicate|unique|username_taken/i.test(m)?"Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen.":m)}finally{setPending(false)}}
  return <section className="card max-w-lg mx-auto"><h1 className="heading">Wähle deinen Benutzernamen</h1><p className="muted mt-3">Dein Name ist für alle Spielkonten eindeutig.</p><form onSubmit={save} className="mt-5 space-y-4"><label>Benutzername<input name="username" minLength={2} maxLength={24} pattern="[A-Za-z0-9 _\-]+" required autoComplete="nickname"/></label><button className="primary">{pending?"Speichern…":"Weiter"}</button><p role="alert">{message}</p></form></section>}
function AccountActions(){const [user,setUser]=useState<{isAnonymous:boolean;email:string|null}|null>(null);useEffect(()=>{api.currentUser().then(setUser).catch(()=>setUser(null))},[]);const[theme,setTheme]=useState(localStorage.getItem("atlas-theme")??"system");
 return <div className="mt-5 space-y-4"><p className="muted">{user?.isAnonymous?"Gastkonto · Spielstand nur auf diesem Gerät gesichert.":`Konto · ${user?.email??""}`}</p>{user?.isAnonymous&&<Link className="primary" to="/auth?mode=link">Konto erstellen und Spielstand sichern</Link>}
 <label>Darstellung<select value={theme} onChange={e=>{const v=e.target.value;setTheme(v);if(v==="system")localStorage.removeItem("atlas-theme");else localStorage.setItem("atlas-theme",v);applyTheme(v)}}><option value="system">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label></div>}

function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [action, setAction] = useState(params.has("recovery") ? "change" : params.get("mode") ?? "choice");
  const [checkingSession,setCheckingSession]=useState(Boolean(supabase));
  const [activeSession,setActiveSession]=useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(()=>{if(!supabase)return;let active=true;supabase.auth.getSession().then(({data,error})=>{if(!active)return;const keepFlow=params.has("recovery")||action==="change"||action==="link"||action==="reset"||action==="guest";const hasSession=Boolean(data.session);setActiveSession(hasSession&&!keepFlow);setCheckingSession(false);if(hasSession&&!keepFlow)navigate("/home",{replace:true});}).catch(()=>{if(active)setCheckingSession(false)});return()=>{active=false}},[action,navigate,params]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const username = String(form.get("username") ?? "").trim();
    try {
      if (action === "signin") {
        await api.signIn(email, password);
        const u=await api.currentUser();
        if(u.requestedUsername) { try { await api.claimUsername(u.requestedUsername); } catch(e) { if(!String((e as Error).message).toLowerCase().includes("duplicate")&&!String((e as Error).message).toLowerCase().includes("username")) throw e; } }
        navigate("/home",{replace:true});
      } else if (action === "signup") {
        if(!validUsername(username)) throw new Error("Name: 2–24 Zeichen, Buchstaben, Zahlen, Leerzeichen, _ oder -.");
        const result=await api.signUp(email,password,username);
        setMessage(result.needsConfirmation ? "Bitte bestätige deine E-Mail. Danach kannst du dich regulär anmelden." : "Konto erstellt. Dein Profil wird eingerichtet.");
        if(!result.needsConfirmation) { await api.claimUsername(username); navigate("/home",{replace:true}); }
      } else if (action === "guest") {
        await api.guest(); navigate("/onboarding",{replace:true});
      } else if (action === "reset") {
        await api.resetPassword(email);
        setMessage("If the account exists, a recovery message has been requested.");
      } else if (action === "change") {
        await api.changePassword(password); navigate("/home");
      } else {
        await api.link(email, password);
        setMessage("Bestätige die E-Mail, falls Supabase dies verlangt. Deine Gast-ID und dein Fortschritt bleiben erhalten.");
      }
    } catch (e) { setMessage(authMessage((e as Error).message)); }
    finally { setPending(false); }
  }
  if(checkingSession||activeSession)return <Loading/>;
  const choose=(next:string)=>{setAction(next);setMessage("")};
  if(action==="choice") return <section className="auth-panel max-w-lg mx-auto">
    <p className="eyebrow">ATLAS ARENA · ACCOUNT</p><h1 tabIndex={-1} className="heading mt-2">Wie möchtest du starten?</h1>
    <p className="muted mt-3">Du kannst sofort losspielen oder deinen Fortschritt mit einem Konto sichern.</p>
    <div className="auth-choices mt-6">
      <button className="primary action-card action-card-featured" onClick={()=>choose("guest")}><span className="action-icon" aria-hidden="true">✦</span><span><strong>Als Gast spielen</strong><small>Ohne Registrierung direkt loslegen</small></span><span className="action-arrow" aria-hidden="true">→</span></button>
      {!isDemo&&<>
        <button className="secondary action-card" onClick={()=>choose("signin")}><span className="action-icon" aria-hidden="true">↗</span><span><strong>Anmelden</strong><small>Zu deinem Konto zurückkehren</small></span><span className="action-arrow" aria-hidden="true">→</span></button>
        <button className="secondary action-card" onClick={()=>choose("signup")}><span className="action-icon" aria-hidden="true">＋</span><span><strong>Konto erstellen</strong><small>Spielstand und Erfolge sichern</small></span><span className="action-arrow" aria-hidden="true">→</span></button>
      </>}
      {isDemo&&<p className="muted text-sm">Konten sind in der lokalen Demo nicht verfügbar.</p>}
    </div>
    <Link className="auth-back mt-5" to="/">← Zur Startseite</Link>
  </section>;
  return <section className="card max-w-lg mx-auto">
    <p className="eyebrow">ATLAS ARENA · {action==="signup"?"NEUES KONTO":action==="signin"?"WILLKOMMEN ZURÜCK":action==="guest"?"GASTZUGANG":"KONTO SICHERN"}</p>
    <h1 tabIndex={-1} className="heading mt-2">{action==="guest"?"Dein Abenteuer wartet.":action==="signup"?"Konto erstellen.":action==="signin"?"Schön, dass du da bist.":action==="reset"?"Passwort zurücksetzen.":action==="change"?"Neues Passwort setzen.":"Deine Entdeckungen bleiben."}</h1>
    {isDemo ? action==="guest" ? <form className="mt-5" onSubmit={submit}><button className="primary w-full" disabled={pending}>{pending?"Wird vorbereitet …":"Als Gast fortfahren"}</button></form> : <p className="muted mt-4">Kontofunktionen sind in der lokalen Demo nicht verfügbar.</p>
      : <form className="space-y-5 mt-5" onSubmit={submit}>
        {action === "signup" && <label>Benutzername<input name="username" required minLength={2} maxLength={24} pattern="[A-Za-z0-9 _\-]+" autoComplete="nickname"/></label>}
        {!["change","guest"].includes(action) && <label>E-Mail<input type="email" name="email" autoComplete="email" required/></label>}
        {! ["reset","guest"].includes(action) && <label>Passwort<input type="password" name="password" minLength={action==="signin"?undefined:12}
          autoComplete={action === "signin" ? "current-password" : "new-password"} required/></label>}
        <button className="primary w-full" disabled={pending}>{pending ? "Bitte warten…" : action==="signin"?"Anmelden":action==="guest"?"Als Gast fortfahren":action==="signup"?"Konto erstellen":action==="reset"?"Link zum Zurücksetzen senden":action==="change"?"Passwort speichern":"Spielstand sichern"}</button>
      </form>}
    {!isDemo&&<div className="auth-switches mt-5">
      <button className="auth-back" onClick={()=>choose("choice")}>← Andere Möglichkeit wählen</button>
      {action==="signin"&&<button className="auth-text-link" onClick={()=>choose("reset")}>Passwort vergessen?</button>}
      {action==="signin"&&<button className="auth-text-link" onClick={()=>choose("signup")}>Noch kein Konto? <strong>Konto erstellen</strong></button>}
      {action==="signup"&&<button className="auth-text-link" onClick={()=>choose("signin")}>Schon ein Konto? <strong>Anmelden</strong></button>}
      {action!=="guest"&&<button className="auth-text-link" onClick={()=>choose("guest")}>Stattdessen als Gast fortfahren</button>}
    </div>}
    <p className="mt-4" role="status">{message}</p>
  </section>;
}

function AuthRedirect() {
  const navigate=useNavigate(); const [state,setState]=useState<"loading"|"guest"|"account"|"out"|"error">(isDemo?(localStorage.getItem("atlas-demo-signed-out")==="yes"?"out":"guest"):"loading");
  useEffect(()=>{if(!supabase)return; let active=true; supabase.auth.getSession().then(({data,error})=>{if(active)setState(error?"error":!data.session?"out":data.session.user?.is_anonymous===false?"account":"guest");}).catch(()=>{if(active)setState("error")});
    const subscription=supabase.auth.onAuthStateChange?.((_e,s)=>setState(!s?"out":s.user.is_anonymous?"guest":"account"))?.data.subscription;return()=>{active=false;subscription?.unsubscribe()};},[]);
  useEffect(()=>{if(state==="guest"||state==="account") navigate("/home",{replace:true})},[state,navigate]);
  return state==="error"?<ErrorBox message="Deine Sitzung konnte nicht wiederhergestellt werden. Bitte prüfe die Verbindung und lade erneut." retry={()=>window.location.reload()}/>:state==="loading"?<Loading/>:<Welcome/>;
}
function Protected({children}:{children:JSX.Element}) {
  const location=useLocation(), navigate=useNavigate(); const [state,setState]=useState<"loading"|"guest"|"account"|"out"|"onboarding"|"error">("loading");
  useEffect(()=>{let active=true;
    if(isDemo){if(localStorage.getItem("atlas-demo-signed-out")==="yes"){setState("out");return()=>{active=false}}if(location.pathname==="/onboarding"){setState("guest");return()=>{active=false}}api.dashboard().then(d=>{if(active)setState(d.profile.username==="Traveler"&&!localStorage.getItem("atlas-demo-onboarded")?"onboarding":"guest")}).catch(()=>{if(active)setState("error")});return()=>{active=false}}
    if(!supabase)return;
    const resolve=async(session:any)=>{if(!session){if(active)setState("out");return}const kind=session.user?.is_anonymous===false?"account":"guest";if(location.pathname==="/onboarding"){if(active)setState(kind);return}
      try{const d=await api.dashboard();const confirmed=await api.usernameConfirmed();const requested=String(session.user?.user_metadata?.requested_username??"");
        if(!confirmed&&requested){try{await api.claimUsername(requested);if(active)setState(kind);return}catch(e){if(/duplicate|unique|username_taken/i.test((e as Error).message)){if(active)setState("onboarding");return}throw e}}
        if(active)setState(!confirmed||!validUsername(d.profile.username)?"onboarding":kind)
      }catch{if(active)setState("error")}};
    supabase.auth.getSession().then(({data,error})=>{if(error){if(active)setState("error")}else void resolve(data.session)});
    const subscription=supabase.auth.onAuthStateChange?.((_e,s)=>{void resolve(s)})?.data.subscription;return()=>{active=false;subscription?.unsubscribe()};},[location.pathname]);
  useEffect(()=>{if(state==="out")navigate(isDemo?"/":"/auth?mode=signin&next="+encodeURIComponent(location.pathname),{replace:true})},[state,location.pathname,navigate]);
  useEffect(()=>{if(state==="onboarding")navigate("/onboarding",{replace:true})},[state,navigate]);
  if(state==="loading"||state==="out"||state==="onboarding")return <Loading/>;
  if(state==="error")return <ErrorBox message="Sitzung oder Profil konnte nicht geladen werden. Bitte prüfe die Verbindung und lade erneut." retry={()=>location.pathname&&window.location.reload()}/>;
  return children;
}

function Settings() {
  const navigate = useNavigate();
  const [isAnonymous,setIsAnonymous] = useState<boolean|null>(null);
  const [consent, setConsent] = useState(analyticsEnabled());
  const [motion, setMotion] = useState(localStorage.getItem("atlas-motion") === "reduce");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [theme,setTheme] = useState(localStorage.getItem("atlas-theme") ?? "system");
  useEffect(()=>{api.currentUser().then(user=>setIsAnonymous(user.isAnonymous)).catch(()=>setIsAnonymous(null))},[]);
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
      <label>Darstellung<select value={theme} onChange={e=>{const v=e.target.value;setTheme(v);if(v==="system")localStorage.removeItem("atlas-theme");else localStorage.setItem("atlas-theme",v);applyTheme(v)}}><option value="system">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label>
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
        {isAnonymous===false&&<button className="secondary" disabled={pending} onClick={() => void run(async () => {
          await api.signOut();setAnalytics(false);navigate("/",{replace:true});
        })}>Sign out</button>}
        <button className="danger-button" disabled={pending} onClick={() => {
          if (prompt("Type DELETE to permanently delete this account and its progress.") !== "DELETE") return;
          void run(async () => {
            await api.deleteAccount();
            setAnalytics(false);
            navigate("/",{replace:true});
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
      <Route index element={<AuthRedirect/>}/>
      <Route path="home" element={<Protected><Home/></Protected>}/>
      <Route path="play/:id" element={<Protected><Game/></Protected>}/>
      <Route path="results/:id" element={<Protected><Results/></Protected>}/>
      <Route path="profile" element={<Protected><ProfilePage/></Protected>}/>
      <Route path="onboarding" element={<Protected><Onboarding/></Protected>}/>
      <Route path="settings" element={<Protected><Settings/></Protected>}/>
      <Route path="auth" element={<Auth/>}/>
      <Route path="explorer" element={<Protected><Explorer/></Protected>}/>
      <Route path="admin" element={<Protected><Admin/></Protected>}/>
      <Route path="*" element={<section className="card">
        <h1 tabIndex={-1} className="heading">Uncharted territory.</h1>
        <Link className="primary mt-5" to="/">Return home</Link>
      </section>}/>
    </Route>
  </Routes>;
}
