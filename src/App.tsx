import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate,
  useOutletContext, useParams, useSearchParams
} from "react-router-dom";
import { api, configurationError, isDemo, supabase } from "./api";
import {
  avatarLabels, avatars, categories, countryFlagAvatarCount, difficulties, level, Mode, modes, Difficulty, ResultView, View,
  challengeSetupUrl, setsNewPersonalBest, validUsername
} from "./domain";
import { ErrorBox, Feedback, Loading, OfflineBanner, download, useLoad } from "./components";
import { analyticsEnabled, readEvents, setAnalytics, track } from "./analytics";

const Admin = lazy(() => import("./Admin"));
const Explorer = lazy(() => import("./Explorer"));
const Flags = lazy(() => import("./Flags"));
const Capitals = lazy(() => import("./Capitals"));
const RegionRecallSetup = lazy(() => import("./RegionRecallSetup"));

const names: Record<Mode, string> = {
  classic: "Classic Quiz", practice: "Practice",
  timed: "Timed Challenge", endless: "Endless"
};
const descriptions: Record<Mode, string> = {
  classic: "Ten questions. Four options. One new personal best.",
  practice: "Take your time. Learn from every answer. No XP pressure.",
  timed: "One minute. How far can your knowledge take you?",
  endless: "Three lives. Build a correct streak to unlock tougher tiers."
};
function applyTheme(theme:string){
  if(theme==="system")delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme=theme;
  const meta=document.querySelector('meta[name="theme-color"]');
  const prefersLight=typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: light)").matches;
  if(meta)meta.setAttribute("content",theme==="light"||(theme==="system"&&prefersLight)?"#f5f8ff":"#0B1020");
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [playerWindow, setPlayerWindow] = useState(false);
  const [playerSection, setPlayerSection] = useState<"statistics"|"profile"|"appearance">("statistics");
  const [confirmAccountAction, setConfirmAccountAction] = useState(false);
  const [menuMessage,setMenuMessage]=useState("");
  const [identity, setIdentity] = useState<{username:string; avatar:number; isAnonymous:boolean; isAdmin:boolean; userId:string} | null>(null);
  const menuButtonRef=useRef<HTMLButtonElement>(null);
  useEffect(() => { let live=true; if (isDemo) { setIdentity(localStorage.getItem("atlas-demo-signed-out")==="yes"?null:{username:"Traveler",avatar:0,isAnonymous:true,isAdmin:false,userId:"demo"}); return; }
    supabase?.auth.getSession().then(({data})=>{if(live&&data.session?.user){const user=data.session.user;const m=user.user_metadata??{};const isAnonymous=Boolean(user.is_anonymous);const isAdmin=Boolean(identity?.userId===user.id&&identity.isAdmin);setIdentity({username:String(m.username??m.requested_username??"Explorer"),avatar:Number(m.avatar??0),isAnonymous,isAdmin,userId:user.id});
      api.dashboard().then(d=>{if(live)setIdentity({username:d.profile.username,avatar:d.profile.avatar,isAnonymous,isAdmin:Boolean(d.profile.admin),userId:user.id})}).catch(()=>{});
    }});
    return () => { live=false; };
  }, [location.pathname]);
  function cancelAccountChange(){setConfirmAccountAction(false);setPlayerWindow(false);menuButtonRef.current?.focus()}
  async function confirmAccountChange(){
    if(!identity)return;
    if(identity.isAnonymous){setPlayerWindow(false);navigate("/auth?mode=link");return;}
    try { await api.signOut(); localStorage.removeItem("atlas-view-cache"); setIdentity(null); setPlayerWindow(false); setConfirmAccountAction(false); navigate("/",{replace:true}); }
    catch(e){setMenuMessage((e as Error).message||"Sign out failed. Your session is still active.");setConfirmAccountAction(false);}
  }
  useEffect(() => {
    const title = document.querySelector("main h1") as HTMLElement | null;
    title?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(()=>{if(typeof window.matchMedia!=="function")return;const media=window.matchMedia("(prefers-color-scheme: light)");const update=()=>{if(!localStorage.getItem("atlas-theme")){const meta=document.querySelector('meta[name="theme-color"]');meta?.setAttribute("content",media.matches?"#f5f8ff":"#0B1020")}};media.addEventListener("change",update);return()=>media.removeEventListener("change",update)},[]);
  const updateProfileIdentity=(username:string,avatar:number)=>setIdentity(current=>current?{...current,username,avatar}:current);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="app-header border-b border-line/15">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-4">
        <Link to="/home" className="brand-link" aria-label="Atlas Arena – Startseite">
          <img className="brand-mark logo-light" src="/icons/light-transparent.png" alt="" />
          <img className="brand-mark logo-dark" src="/icons/dark.png" alt="" />
          <img className="brand-wordmark wordmark-light" src="/icons/text_light-transparent.png" alt="" />
          <img className="brand-wordmark wordmark-dark" src="/icons/text_dark.png" alt="" />
        </Link>
        <nav aria-label="Primary" className="topbar-nav flex flex-wrap gap-1 items-center">
          {identity && <><NavLink to="/home">Play</NavLink><NavLink to="/flags">Flags</NavLink><NavLink to="/recall">Recall</NavLink><NavLink to="/capitals">Capitals</NavLink><NavLink to="/explorer">Explorer</NavLink>
          {identity.isAdmin && <NavLink className="admin-nav-link" to="/admin" aria-label="Admin-Bereich">Admin</NavLink>}
          <NavLink className="topbar-icon" to="/profile" aria-label="Your Atlas — personal explorer and statistics" title="Your Atlas · Personal explorer"><ChartIcon/></NavLink>
          <NavLink className="topbar-icon" to="/settings" aria-label="Einstellungen" title="Einstellungen"><SettingsIcon/></NavLink>
          <div className="player-controls"><button ref={menuButtonRef} className="user-menu-button" aria-label={`Open player panel for ${identity.username}`} aria-expanded={playerWindow} aria-haspopup="dialog" onClick={()=>{setConfirmAccountAction(false);setMenuMessage("");setPlayerWindow(true)}}><span className="player-avatar" aria-hidden="true">{avatars[identity.avatar] ?? avatars[0]}</span><span className="user-name">{identity.username}</span></button>
            {!isDemo&&<button className="account-action-icon" type="button" aria-label={identity.isAnonymous?"Sign in or link an account":"Sign out"} title={identity.isAnonymous?"Sign in or link an account":"Sign out"} onClick={()=>{setPlayerSection("profile");setMenuMessage("");setConfirmAccountAction(true);setPlayerWindow(true)}}>{identity.isAnonymous?<SignInIcon/>:<SignOutIcon/>}</button>}</div></>}
        </nav>
      </div>
    </header>
    {identity&&playerWindow&&<PlayerWindow identity={identity} section={playerSection} setSection={setPlayerSection} confirming={confirmAccountAction} setConfirming={setConfirmAccountAction} message={menuMessage} onProfileUpdated={updateProfileIdentity} onClose={()=>{setPlayerWindow(false);setConfirmAccountAction(false);menuButtonRef.current?.focus()}} onCancelConfirm={cancelAccountChange} onConfirm={confirmAccountChange}/>}
    {isDemo && <div className="demo-banner">
      LOCAL DEMO · Progress stays in this browser · Public, unverified sample questions
    </div>}
    <OfflineBanner/>
    <main id="main" className="shell py-8 md:py-12">
      <Suspense fallback={<Loading />}><Outlet context={{onProfileUpdated:updateProfileIdentity}} /></Suspense>
    </main>
    <footer className="shell py-8 text-sm muted border-t border-line/15">
      Built for curious minds. No ads. No public chat.
      <span className="block mt-2">Maps and multiplayer are planned, not playable features.</span>
    </footer>
  </>;
}

function ChartIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-7m4 7V4"/></svg>}
function SettingsIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.2.9-1.4 2.4-1.4-.6a8 8 0 0 1-1.5.9l-.2 1.5h-2.8l-.2-1.5a8 8 0 0 1-1.5-.9l-1.4.6-1.4-2.4 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.4-2.4 1.4.6a8 8 0 0 1 1.5-.9l.2-1.5h2.8l.2 1.5a8 8 0 0 1 1.5.9l1.4-.6 1.4 2.4-1.2.9a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1)"/></svg>}
function SignOutIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9"/></svg>}
function SignInIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v14h-5M10 8l-4 4 4 4m-4-4h10"/></svg>}

type PlayerIdentity = {username:string;avatar:number;isAnonymous:boolean;isAdmin:boolean;userId:string};
function AvatarPicker({value}:{value:number}){
  const initial=Number.isInteger(value)&&value>=0&&value<avatars.length?value:0;const [selected,setSelected]=useState(initial);const [open,setOpen]=useState(false);const triggerRef=useRef<HTMLButtonElement>(null);
  function choose(index:number){setSelected(index);setOpen(false);window.setTimeout(()=>triggerRef.current?.focus(),0)}
  return <div className="avatar-picker"><input type="hidden" name="avatar" value={selected}/><button ref={triggerRef} type="button" className="avatar-picker-trigger" aria-expanded={open} aria-controls="avatar-picker-options" aria-label={`Choose avatar. Current selection: ${avatarLabels[selected]}`} onClick={()=>setOpen(value=>!value)}><span className="avatar-picker-trigger-emoji" aria-hidden="true">{avatars[selected]}</span><span className="avatar-picker-trigger-copy"><small>Selected avatar</small><strong>{avatarLabels[selected]}</strong></span><span className="avatar-picker-trigger-count">{avatars.length} options</span><span className={`avatar-picker-chevron ${open?"is-open":""}`} aria-hidden="true"/></button>{open&&<div className="avatar-picker-panel"><p className="avatar-picker-panel-label">Choose an avatar <span>{countryFlagAvatarCount} country flags</span></p><div className="avatar-picker-grid" id="avatar-picker-options" role="radiogroup" aria-label="Choose an avatar">{avatars.map((avatar,index)=><label key={index} className="player-avatar-choice" title={avatarLabels[index]}><input type="radio" name="avatar-picker-choice" value={index} checked={selected===index} onChange={()=>choose(index)} aria-label={avatarLabels[index]}/><span aria-hidden="true">{avatar}</span><span className="sr-only">{avatarLabels[index]}</span></label>)}</div></div>}</div>
}
function PlayerWindow({identity,section,setSection,confirming,setConfirming,message,onProfileUpdated,onClose,onCancelConfirm,onConfirm}:{identity:PlayerIdentity;section:"statistics"|"profile"|"appearance";setSection:(section:"statistics"|"profile"|"appearance")=>void;confirming:boolean;setConfirming:(value:boolean)=>void;message:string;onProfileUpdated:(username:string,avatar:number)=>void;onClose:()=>void;onCancelConfirm:()=>void;onConfirm:()=>void}){
  const {data,error,reload}=useLoad(()=>api.dashboard());
  const dialogRef=useRef<HTMLElement>(null);
  const [collapsed,setCollapsed]=useState(false);
  const [profileMessage,setProfileMessage]=useState("");
  const [profileSaving,setProfileSaving]=useState(false);
  async function savePlayerProfile(event:FormEvent<HTMLFormElement>){event.preventDefault();setProfileSaving(true);setProfileMessage("");const form=new FormData(event.currentTarget);const username=String(form.get("username")??"");const avatar=Number(form.get("avatar")??0);try{await api.saveProfile({username,avatar,favorites:form.getAll("favorites").map(String)});onProfileUpdated(username,avatar);setProfileMessage("Profile saved.");reload()}catch(e){setProfileMessage(authMessage((e as Error).message))}finally{setProfileSaving(false)}}
  useEffect(()=>{(confirming?document.querySelector<HTMLElement>(".account-confirm-dialog"):dialogRef.current?.querySelector<HTMLElement>(".player-window-close"))?.focus();const old=document.body.style.overflow;document.body.style.overflow="hidden";const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){if(confirming)onCancelConfirm();else onClose();return}if(e.key==="Tab"){const scope=confirming?document.querySelector<HTMLElement>(".account-confirm-dialog"):dialogRef.current;const nodes=scope?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,input');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};window.addEventListener("keydown",key);return()=>{window.removeEventListener("keydown",key);document.body.style.overflow=old}},[onClose,onCancelConfirm,confirming]);
  return <div className="player-window-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!confirming)onClose()}}><section ref={dialogRef} className="player-window" role="dialog" aria-modal="true" aria-labelledby="player-window-title" tabIndex={-1}>
    <header className="player-window-header"><div className="player-window-identity"><span className="player-window-avatar" aria-hidden="true">{avatars[identity.avatar]??avatars[0]}</span><div><p className="eyebrow">YOUR ATLAS</p><h2 id="player-window-title">{identity.username}</h2></div></div><button type="button" className="player-window-close" aria-label="Close player panel" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div className={`player-window-layout ${collapsed?"sidebar-collapsed":""}`}><aside className="player-sidebar" aria-label="Player panel sections"><button className="player-sidebar-toggle" aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}><span aria-hidden="true">{collapsed?"›":"‹"}</span>{!collapsed&&<span>Collapse</span>}</button>
      {([["statistics","Statistics",<ChartIcon key="stats"/>],["profile","Profile settings",<span key="profile" className="sidebar-avatar" aria-hidden="true">{avatars[identity.avatar]??avatars[0]}</span>],["appearance","Appearance",<SettingsIcon key="appearance"/>]] as const).map(([id,label,icon])=><button key={id} className={`player-sidebar-item ${section===id?"is-active":""}`} aria-current={section===id?"page":undefined} title={collapsed?label:undefined} onClick={()=>setSection(id)}>{icon}<span>{!collapsed&&label}</span></button>)}
    </aside><div className="player-window-content">
      {section==="statistics"?<><div className="player-section-heading"><p className="eyebrow">YOUR PROGRESS</p><h3>Statistics</h3></div>{error?<ErrorBox message={error} retry={reload}/>:!data?<Loading/>:<><div className="player-stat-grid"><div className="player-stat-card"><span>Completed</span><strong>{data.totals.games}</strong></div><div className="player-stat-card"><span>Accuracy</span><strong>{accuracy(data.totals.correct,data.totals.incorrect)}</strong></div><div className="player-stat-card"><span>Experience</span><strong>{data.profile.xp.toLocaleString()} XP</strong></div><div className="player-stat-card"><span>Level</span><strong>{level(data.profile.xp)}</strong></div></div><section className="player-best-scores"><h4>Personal bests</h4>{(["classic","timed","endless"] as Mode[]).map(mode=><p key={mode}><span>{names[mode]}</span><strong>{data.best[mode]??"—"}</strong></p>)}</section></>}</>
      :section==="profile"?<><div className="player-section-heading"><p className="eyebrow">PLAYER DETAILS</p><h3>Profile settings</h3></div>{data?<form className="player-profile-form" onSubmit={savePlayerProfile} key={data.profile.username}><label>Username<input name="username" required minLength={2} maxLength={24} pattern="[A-Za-z0-9 _\\-]+" defaultValue={data.profile.username}/></label><fieldset><legend>Choose an avatar</legend><AvatarPicker value={data.profile.avatar}/></fieldset><fieldset><legend>Favorite topics</legend><div className="player-favorite-grid">{categories.map(category=><label className="player-favorite-choice" key={category}><input type="checkbox" name="favorites" value={category} defaultChecked={data.profile.favorites.includes(category)}/><span>{category}</span></label>)}</div></fieldset><button className="primary" disabled={profileSaving}>{profileSaving?"Saving…":"Save profile"}</button><p role="status" className="player-profile-message">{profileMessage}</p></form>:error?<ErrorBox message={error} retry={reload}/>:<Loading/>}{!isDemo&&identity.isAnonymous&&<Link className="secondary" to="/auth?mode=link" onClick={onClose}>Create an account to save progress</Link>}{data?.profile.admin&&<Link className="secondary" to="/admin" onClick={onClose}>Content administration</Link>}</>
      :<><div className="player-section-heading"><p className="eyebrow">PERSONALIZE</p><h3>Appearance</h3></div><div className="player-appearance-card"><p className="muted">Choose how Atlas Arena looks on this device.</p><ThemeControl/></div><Link className="secondary" to="/settings" onClick={onClose}>More settings <span aria-hidden="true">→</span></Link></>}
      <div className="player-account-row">{!isDemo&&<button className="secondary player-account-button" onClick={()=>setConfirming(true)}>{identity.isAnonymous?<><SignInIcon/>Sign in or link account</>:<><SignOutIcon/>Sign out</>}</button>}{message&&<p className="error" role="alert">{message}</p>}</div>
    </div></div>
  </section>{confirming&&<div className="account-confirm-backdrop"><section className="account-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="account-confirm-title" aria-describedby="account-confirm-description"><span className="account-confirm-symbol" aria-hidden="true">{identity.isAnonymous?<SignInIcon/>:<SignOutIcon/>}</span><p className="eyebrow">ACCOUNT</p><h2 id="account-confirm-title">{identity.isAnonymous?"Continue to sign in?":"Sign out of Atlas Arena?"}</h2><p id="account-confirm-description" className="muted">{identity.isAnonymous?"You can link an account to keep your guest progress when you switch devices.":"You will return to the sign-in screen. Your saved progress will remain on your account."}</p>{message&&<p className="error" role="alert">{message}</p>}<div className="player-window-actions"><button className="secondary" onClick={onCancelConfirm}>Cancel</button><button className="primary" onClick={onConfirm}>{identity.isAnonymous?"Continue to sign in":"Sign out"}</button></div></section></div>}</div>
}

function Welcome() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function start() {
    setPending(true); setError("");
    try { await api.guest(); navigate("/onboarding",{replace:true}); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="hero-shell grid md:grid-cols-[1.05fr_.95fr] gap-10 lg:gap-16 items-center py-8 md:py-12">
    <section className="hero-copy">
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
    <div className="globe-card map-grid" aria-hidden="true">
      <img className="marketing-icon" src="/icons/marketing_icon.png" alt="" />
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
  const [category, setCategory] = useState(()=>categories.includes(params.get("category")??"")?params.get("category")!:"all");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryPickerRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { data, error: loadError, reload } = useLoad(() => api.dashboard());
  const leaderboard = useLoad(() => api.leaderboard());
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const leaderboardButtonRef = useRef<HTMLButtonElement>(null);
  const leaderboardCloseRef = useRef<HTMLButtonElement>(null);
  const leaderboardDialogRef = useRef<HTMLElement>(null);
  const country = params.get("country") ?? undefined;
  const countParam=Number(params.get("count"));
  const questionCount=Number.isInteger(countParam)&&countParam>=1&&countParam<=10?countParam:(country&&mode==="practice"?4:10);

  useEffect(()=>{
    if(!categoryOpen)return;
    const outside=(event:MouseEvent)=>{if(!categoryPickerRef.current?.contains(event.target as Node))setCategoryOpen(false)};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){setCategoryOpen(false);categoryTriggerRef.current?.focus()}};
    document.addEventListener("mousedown",outside);window.addEventListener("keydown",key);
    return()=>{document.removeEventListener("mousedown",outside);window.removeEventListener("keydown",key)};
  },[categoryOpen]);

  useEffect(() => {
    if (!leaderboardOpen) return;
    leaderboardCloseRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setLeaderboardOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = leaderboardDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'
      );
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys);
      document.body.style.overflow = previousOverflow;
      leaderboardButtonRef.current?.focus();
    };
  }, [leaderboardOpen]);

  async function start(e: FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try {
      const s = await api.play(mode, category === "all" ? [] : [category],
        difficulty, country, questionCount);
      track("game_started", { mode, category, difficulty });
      navigate("/play/" + s.id);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }

  return <div className="home-shell">
    {data && <section className="home-stats-bar" aria-label="Your game statistics">
      <div className="home-stat-item"><span>Completed</span><strong>{data.totals.games}</strong></div>
      <div className="home-stat-item"><span>Accuracy</span><strong>{accuracy(data.totals.correct, data.totals.incorrect)}</strong></div>
      <div className="home-stat-item"><span>Classic best</span><strong>{data.best.classic ?? "—"}</strong></div>
      <button ref={leaderboardButtonRef} className="home-stat-item home-rank-button" type="button" aria-label={leaderboard.data?.currentRank ? `Your server rank is ${leaderboard.data.currentRank}. Open top 25 players` : "Open server leaderboard"} aria-haspopup="dialog" onClick={() => setLeaderboardOpen(true)}>
        <span>Server rank</span><strong>{leaderboard.data?.currentRank ? `#${leaderboard.data.currentRank}` : "#—"}</strong><small>Top 25 players <span aria-hidden="true">↗</span></small>
      </button>
    </section>}
    <div className="section-heading home-heading">
      <div>
        <p className="eyebrow">YOUR NEXT ADVENTURE</p>
        <h1 tabIndex={-1} className="heading mt-2">Welcome back{data ? `, ${data.profile.username}` : ""}.</h1>
      </div>
      {data && <p className="pill">Level {level(data.profile.xp)} · {data.profile.xp} XP</p>}
    </div>
    <ErrorBox message={loadError} retry={reload}/>
    {loadError.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload}/>}
    {data?.sessions.filter(s => s.status === "awaiting_answer" || s.status === "showing_feedback")
      .map(s => <Link className="resume-card card block mb-3" key={s.id} to={"/play/" + s.id}>
        <span><strong>Resume {names[s.mode]}</strong><small className="muted">Your run is ready when you are.</small></span><span aria-hidden="true">→</span>
      </Link>)}
    <form onSubmit={start} className="challenge-form mt-8">
      <fieldset id="challenge-mode-picker" className="challenge-fieldset">
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
      <div className="challenge-filters card mt-5 grid md:grid-cols-[1fr_1.4fr_auto] gap-5 items-end">
        <div className="category-picker" ref={categoryPickerRef}><span className="challenge-label">Question category</span><button ref={categoryTriggerRef} type="button" className="category-picker-trigger" aria-haspopup="listbox" aria-expanded={categoryOpen} aria-controls="category-picker-options" onClick={()=>setCategoryOpen(value=>!value)}><span><small>Choose category</small><strong>{category==="all"?"All available geography":category}</strong></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
          {categoryOpen&&<div className="category-picker-menu"><div className="category-picker-menu-heading"><span>Choose a topic</span><small>{categories.length} topics</small></div><div id="category-picker-options" role="listbox" aria-label="Question category">{[{id:"all",label:"All available geography"},...categories.map(value=>({id:value,label:value}))].map(option=><button key={option.id} type="button" role="option" aria-selected={category===option.id} className={`category-picker-option ${category===option.id?"is-selected":""}`} onClick={()=>{setCategory(option.id);setCategoryOpen(false);categoryTriggerRef.current?.focus()}}><span className="category-option-label">{option.id==="all"&&<span className="category-option-glyph" aria-hidden="true">✦</span>}{option.label}</span>{category===option.id&&<span className="category-picker-check" aria-hidden="true">✓</span>}</button>)}</div></div>}
        </div>
        <fieldset id="difficulty-picker" className="difficulty-picker"><legend className="challenge-label">{mode === "endless" ? "Starting difficulty" : "Difficulty"}</legend><div className="difficulty-options">{difficulties.map((d,i)=><label key={d} className={`difficulty-option ${d==="easy"?"is-easy":""} ${d==="expert"?"is-expert":""} ${difficulty===d?"is-selected":""}`}><input className="sr-only" type="radio" name="difficulty" value={d} checked={difficulty===d} onChange={()=>setDifficulty(d)}/><span className="difficulty-mark" aria-hidden="true">{["◌","◉","◆","✦"][i]}</span><span>{d}</span></label>)}</div></fieldset>
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
    {leaderboardOpen && <div className="leaderboard-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setLeaderboardOpen(false); }}>
      <section ref={leaderboardDialogRef} className="leaderboard-dialog" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title" aria-describedby="leaderboard-description" tabIndex={-1}>
        <header className="leaderboard-header">
          <div><p className="eyebrow">ATLAS ARENA · GLOBAL</p><h2 id="leaderboard-title" className="text-2xl font-black mt-1">Top 25 players</h2><p id="leaderboard-description" className="muted text-sm mt-1">Players ranked by earned XP.</p></div>
          <button ref={leaderboardCloseRef} type="button" className="leaderboard-close secondary" aria-label="Close leaderboard" onClick={() => setLeaderboardOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </header>
        {leaderboard.error && <ErrorBox message={leaderboard.error} retry={leaderboard.reload}/>}
        {!leaderboard.data && !leaderboard.error && <div className="leaderboard-loading" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true"/>Loading leaderboard…</div>}
        {leaderboard.data && <>
          {isDemo ? <div className="empty-state mt-5"><span className="empty-icon" aria-hidden="true">◎</span><h3 className="font-bold mt-3">Server leaderboard unavailable</h3><p className="muted mt-2">Local demo progress is stored in this browser and isn’t ranked on the server.</p></div> : <>
            {leaderboard.data.currentRank && leaderboard.data.currentRank > 25 && <p className="leaderboard-your-rank">Your rank: <strong>#{leaderboard.data.currentRank}</strong> · outside the top 25</p>}
            {!leaderboard.data.currentRank && <p className="leaderboard-your-rank">Complete a scored game to join the XP leaderboard.</p>}
            {leaderboard.data.players.length ? <div className="leaderboard-table-scroll" role="region" aria-label="Top 25 players" tabIndex={0}>
              <table className="leaderboard-table">
                <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">XP</th></tr></thead>
                <tbody>{leaderboard.data.players.map(player => <tr key={`${player.rank}-${player.username}`} className={player.rank === leaderboard.data?.currentRank ? "is-you" : ""}>
                  <td><span className="leaderboard-position">{player.rank <= 3 ? ["①", "②", "③"][player.rank - 1] : `#${player.rank}`}</span></td>
                  <td><span className="leaderboard-player"><span aria-hidden="true">{avatars[player.avatar] ?? avatars[0]}</span><strong>{player.username}</strong>{player.rank === leaderboard.data?.currentRank && <span className="leaderboard-you-tag">You</span>}</span></td>
                  <td className="leaderboard-xp">{player.xp.toLocaleString()} XP</td>
                </tr>)}</tbody>
              </table>
            </div> : <div className="empty-state mt-5"><span className="empty-icon" aria-hidden="true">◎</span><h3 className="font-bold mt-3">No ranked players yet</h3><p className="muted mt-2">Be the first to earn XP in a scored game.</p></div>}
          </>}
        </>}
      </section>
    </div>}
  </div>;
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return <div className="card stat-card p-4">
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
  const [leaveDialogOpen,setLeaveDialogOpen]=useState(false);
  const [deletePending,setDeletePending]=useState(false);
  const leaveDialogRef=useRef<HTMLElement>(null);
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

  useEffect(()=>{
    if(!leaveDialogOpen)return;
    leaveDialogRef.current?.querySelector<HTMLElement>(".leave-run-cancel")?.focus();
    const oldOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setLeaveDialogOpen(false);return}if(event.key!=="Tab")return;const nodes=leaveDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};
    window.addEventListener("keydown",onKey);return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow=oldOverflow};
  },[leaveDialogOpen]);

  // Timed runs pause at accepted answers while the player reads feedback.
  const remaining = view?.deadline && view.status !== "showing_feedback"
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

  async function deleteCurrentRun(){
    setDeletePending(true);setError("");
    try{await api.deleteRun(id);navigate("/home",{replace:true})}
    catch(e){setError((e as Error).message)}
    finally{setDeletePending(false)}
  }

  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || e.altKey || e.ctrlKey || e.metaKey) return;
      if(view?.status==="showing_feedback"&&(e.key==="Enter"||e.code==="Space")&&!target.closest("a")) { e.preventDefault(); if(!pending)void action("next"); return; }
      if (e.repeat || view?.status !== "awaiting_answer" || remaining === 0) return;
      const index = Number(e.key) - 1;
      const option = view.current?.options[index];
      if (option) { e.preventDefault(); void action("answer", option.id); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!view) return error?<ErrorBox message={error} retry={refresh}/>:<Loading/>;
  if (view.status === "abandoned") return <section className="card">
    <h1 tabIndex={-1} className="heading">This run was abandoned.</h1>
    <Link className="primary mt-5" to="/home">Choose a new challenge</Link>
  </section>;

  const questionNumber=Math.min(view.answered+1,view.total);
  const progressPercent=view.total?Math.min(100,view.answered/view.total*100):0;
  const remainingLives=Math.max(0,3-view.stats.incorrect);
  return <div className="game-shell">
    <div className="game-topline">
      <div><p className="eyebrow">{names[view.mode]} · <span className={`game-difficulty-tag ${view.current?.difficulty==="expert"?"is-expert":""}`}>{view.current?.difficulty ?? view.difficulty}</span></p><p className="muted mt-1">Question {questionNumber} of {view.total}</p></div>
      <button className="secondary" disabled={pending} onClick={()=>setLeaveDialogOpen(true)}>Leave run</button>
    </div>
    <div className="game-layout mt-5"><div className="game-main">
    {view.current && <section className={`card game-question map-grid ${view.status==="showing_feedback"&&view.feedback?.correct?"has-correct-answer":""} ${view.status==="showing_feedback"&&view.feedback&&!view.feedback.correct?"has-incorrect-answer":""}`}>
      <h1 tabIndex={-1} className="game-prompt mt-6">{view.current.prompt}</h1>
      <div className="answer-grid grid gap-3 sm:grid-cols-2 mt-7">
        {view.current.options.map((o, i) =>
          <button key={o.id} className="answer text-left"
            disabled={pending || view.status !== "awaiting_answer" || remaining === 0}
            onClick={() => void action("answer", o.id)}>
            <span className="keycap" aria-hidden="true">{i + 1}</span><span>{o.label}</span>
          </button>)}
      </div>
      <p className="keyboard-hint muted text-sm mt-5"><span className="keycap">1</span>–<span className="keycap">4</span> to answer</p>
    </section>}
    <ErrorBox message={error} retry={refresh}/>
    {view.feedback && <p className="game-keyboard-hint muted text-sm mt-3">Press <kbd>Enter</kbd> or <kbd>Space</kbd> for the next question</p>}
    {remaining === 0 && view.status !== "completed" &&
      <p className="game-notice mt-4" role="status">Time is up. Confirming the final result…</p>}
    </div><aside className="game-sidebar" aria-label="Live run statistics and answer review">
      <div className="game-live-stats"><div><span>Score</span><strong>{view.stats.score.toLocaleString()}</strong></div><div><span>Streak</span><strong>{view.stats.streak}</strong></div><div><span>{view.mode==="endless"?"Lives":"Progress"}</span>{view.mode==="endless"?<strong className="game-hearts" aria-label={`${remainingLives} of 3 lives remaining`}>{[0,1,2].map(index=><svg key={index} className={index<remainingLives?"is-alive":"is-lost"} viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>)}</strong>:<strong>{`${view.answered}/${view.total}`}</strong>}</div></div>
      {view.total>1&&<div className="game-progress-card"><div className="game-progress-caption"><span>Run progress</span><strong>{progressPercent}%</strong></div><div className="game-progress" role="progressbar" aria-label="Question progress" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.answered}><span style={{width:`${progressPercent}%`}}/></div></div>}
      {view.deadline&&(remaining!==null?<div className="game-stat timer-stat"><div className="timer-label-row"><span>Time left</span><strong>{Math.ceil(remaining/1000)}s</strong></div><div className="timer-track mt-2" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.ceil(remaining/1000)}><span style={{width:`${Math.max(0,remaining/60000*100)}%`}}/></div></div>:<div className="game-stat timer-stat is-paused"><span>Challenge timer</span><strong>Paused while you review</strong></div>)}
      {view.feedback&&<section className="game-review"><div className="game-review-heading"><span className={`game-result-mark ${view.feedback.correct?"is-correct":"is-incorrect"}`} aria-hidden="true">{view.feedback.correct?"✓":"×"}</span><div><p className="eyebrow">ANSWER REVIEW</p><h2>{view.feedback.correct?"Correct":"Not quite"}</h2></div><strong className="game-review-points">+{view.feedback.points} <small>pts</small></strong></div><p className="game-correct-answer"><span>Correct answer</span><strong>{view.feedback.correctAnswer}</strong></p>{!view.feedback.correct&&<p className="game-chosen-answer"><span>Your answer</span>{view.feedback.chosen}</p>}<p className="game-review-explanation">{view.feedback.explanation}</p><a className="game-review-source" href={view.feedback.source} target="_blank" rel="noopener noreferrer">Source reference <span aria-hidden="true">↗</span></a><button autoFocus className="primary game-next-button mt-3" disabled={pending} onClick={()=>void action("next")}>{pending?"Loading…":"Next question →"}</button></section>}
      {!view.feedback&&<div className="game-stats-footnote"><span>Best streak</span><strong>{view.stats.bestStreak}</strong></div>}
    </aside></div>
    {leaveDialogOpen&&<div className="leave-run-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!deletePending)setLeaveDialogOpen(false)}}><section ref={leaveDialogRef} className="leave-run-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-run-title" aria-describedby="leave-run-description"><span className="leave-run-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 3.5 7v5.5c0 4.2 3.6 7.3 8.5 8.5 4.9-1.2 8.5-4.3 8.5-8.5V7L12 3Z"/><path d="m9 12 2 2 4-4"/></svg></span><p className="eyebrow">YOUR RUN · {names[view.mode]}</p><h2 id="leave-run-title">Leave this run?</h2><p id="leave-run-description" className="muted">Save your progress to resume from Home later, or delete this run and its progress.</p>{view.deadline&&<p className="leave-run-timer-note">This timed challenge keeps running while you are away.</p>}{error&&<ErrorBox message={error}/>}<div className="leave-run-actions"><button type="button" className="secondary leave-run-cancel" disabled={deletePending} onClick={()=>setLeaveDialogOpen(false)}>Continue playing</button><button type="button" className="primary leave-run-save" disabled={deletePending} onClick={()=>navigate("/home")}>Save for later <span aria-hidden="true">↗</span></button><button type="button" className="leave-run-delete" disabled={deletePending} onClick={()=>void deleteCurrentRun()}>{deletePending?<><span className="loading-indicator" aria-hidden="true"/>Deleting…</>:<>Delete run <span aria-hidden="true">⌫</span></>}</button></div></section></div>}
  </div>;
}

function Results() {
  const { id = "" } = useParams();
  const navigate=useNavigate();
  const { data: v, error, reload } = useLoad(() => api.result(id), id);
  const [replayPending,setReplayPending]=useState(false);
  const [replayError,setReplayError]=useState("");
  if (!v) return error?<ErrorBox message={error} retry={reload}/>:<Loading/>;
  if (v.status !== "completed") return <section className="card">
    <h1 tabIndex={-1} className="heading">This run has not completed.</h1>
    <Link className="primary mt-4" to={"/play/" + id}>Resume run</Link>
  </section>;
  const result=v;
  const newBest=setsNewPersonalBest(result.mode,result.stats.score,result.previousBest);
  const setupUrl=challengeSetupUrl(result);
  async function playAgain(){
    if(!result.contextSaved){navigate(setupUrl);return;}
    setReplayPending(true);setReplayError("");
    try{const next=await api.play(result.mode,result.categories??[],result.difficulty,result.country??undefined,result.questionCount??10);navigate(`/play/${next.id}`)}
    catch(e){setReplayError((e as Error).message)}
    finally{setReplayPending(false)}
  }
  return <div className="results-shell">
    <section className={`results-hero map-grid ${newBest?"has-new-best":""}`}>
      <div className="results-hero-copy"><p className="eyebrow">ADVENTURE COMPLETE · {names[v.mode]}</p>
      <h1 tabIndex={-1} className="heading mt-3">Run complete.</h1>
      <p className="muted mt-3">Here’s how this adventure unfolded.</p>
      {newBest&&<div className="new-best-badge" role="status"><span className="new-best-icon" aria-hidden="true">✦</span><span><strong>New personal best</strong><small>{v.previousBest===null?"Your first completed score in this mode.":`Previous best: ${v.previousBest.toLocaleString()} points`}</small></span></div>}</div>
      <div className="results-selection" aria-label="Completed challenge settings"><span className="results-selection-label">Your selection</span><strong>{names[v.mode]} <i aria-hidden="true">·</i> {v.difficulty}</strong><span>{v.contextSaved?(v.categories?.length?v.categories.join(", "):"All categories"):"Original filters unavailable"}{v.country?` · ${v.country}`:""}</span></div>
    </section>
    <div className="results-actions">
      <button className="primary results-play-again" disabled={replayPending} onClick={()=>void playAgain()}>{replayPending?<><span className="loading-indicator" aria-hidden="true"/>Starting a new run…</>:<>Play again <span aria-hidden="true">→</span></>}</button>
      <Link className="secondary" to={`${setupUrl}#difficulty-picker`}>Change difficulty</Link>
      <Link className="secondary" to={`${setupUrl}#challenge-mode-picker`}>Change mode</Link>
    </div>
    {!v.contextSaved&&<p className="results-context-notice" role="status">This run predates saved filter settings. Choose its category and country again in the setup screen before starting.</p>}
    <ErrorBox message={replayError}/>
    <div className="results-metrics grid grid-cols-2 md:grid-cols-4 gap-3 my-6">
      <Stat title="Final score" value={v.stats.score}/>
      <Stat title="Accuracy" value={accuracy(v.stats.correct, v.stats.incorrect)}/>
      <Stat title="XP earned" value={v.stats.xp}/>
      <Stat title="Correct answers" value={v.stats.correct}/>
      <Stat title="Incorrect answers" value={v.stats.incorrect}/>
      <Stat title="Average response" value={v.answered?`${(v.stats.averageMs / 1000).toFixed(1)}s`:"—"}/>
      <Stat title="Best streak" value={v.stats.bestStreak}/>
    </div>
    <p className="muted text-sm">
      Average response time is the sum of accepted answer response times divided by accepted
      answers. It excludes explanation screens and unanswered questions.
      Practice earns no competitive XP.
    </p>
    <div className="section-heading mt-9 mb-4"><h2 className="text-2xl font-bold">Your answer review</h2><span className="muted text-sm">{v.reviews.length} {v.reviews.length===1?"answer":"answers"}</span></div>
    {!v.reviews.length&&<div className="empty-state"><p className="font-semibold">No answers were accepted in this run.</p></div>}
    <div className="grid gap-4">
      {[...v.reviews].map((review,index)=>({review,index})).sort((a,b)=>Number(a.review.correct)-Number(b.review.correct)||a.index-b.index).map(({review,index}) =>
        <article className={`results-review-item ${review.correct?"is-correct":"is-incorrect"}`} key={review.questionId}>
          <div className="results-review-title"><span>{String(index+1).padStart(2,"0")}</span><h3>{review.prompt}</h3><strong className={`results-review-status ${review.correct?"is-correct":"is-incorrect"}`}>{review.correct?"Correct":"Mistake"}</strong></div>
          <Feedback review={review}/>
        </article>)}
    </div>
  </div>;
}

function ProfilePage() {
  const {onProfileUpdated}=useOutletContext<{onProfileUpdated:(username:string,avatar:number)=>void}>();
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useLoad(() => api.dashboard(offset), offset);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data) return error?<><ErrorBox message={error} retry={reload}/>
    {error.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload}/>}
  </>:<Loading/>;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const username=String(form.get("username"));const avatar=Number(form.get("avatar"));
      await api.saveProfile({
        username,
        avatar,
        favorites: form.getAll("favorites").map(String)
      });
      onProfileUpdated(username,avatar);
      setMessage("Profile saved."); reload();
    } catch (e) { setMessage(authMessage((e as Error).message)); }
    finally { setSaving(false); }
  }
  return <div className="profile-shell">
    <div className="page-intro"><div><p className="eyebrow">YOUR ATLAS</p><h1 tabIndex={-1} className="heading mt-2">Your explorer profile</h1></div><p className="muted">Your identity, progress, and personal bests.</p></div>
    <div className="profile-layout mt-6">
      <form className="card profile-form space-y-5" onSubmit={save} key={data.profile.username}>
        <label>Username<input name="username" required minLength={2} maxLength={24}
          pattern="[A-Za-z0-9 _\-]+" defaultValue={data.profile.username}/></label>
        <fieldset><legend className="mb-3">Choose an avatar</legend><AvatarPicker value={data.profile.avatar}/></fieldset>
        <fieldset><legend className="mb-3">Favorite topics</legend><div className="player-favorite-grid">
          {categories.map(c => <label className="player-favorite-choice" key={c}><input type="checkbox" name="favorites" value={c} defaultChecked={data.profile.favorites.includes(c)}/><span>{c}</span></label>)}
        </div></fieldset>
        <button className="primary" disabled={saving}>Save profile</button>
        <p role="status">{message}</p>
      </form>
      <section className="card profile-summary">
        <div className="profile-avatar-display"><span aria-hidden="true">{avatars[data.profile.avatar]}</span><div><p className="eyebrow">PERSONAL EXPLORER</p><strong>{data.profile.username}</strong></div></div>
        <h2 className="text-2xl font-bold mt-4">Level {level(data.profile.xp)}</h2>
        <p className="muted">{data.profile.xp} XP · {500 - data.profile.xp % 500} XP to next level</p>
        <progress className="w-full my-5" max={500} value={data.profile.xp % 500} aria-label="Level progress"/>
        <p>{data.totals.games} completed games · {accuracy(data.totals.correct, data.totals.incorrect)} accuracy</p>
        <h3 className="font-bold mt-6 mb-2">Best scores by mode</h3>
        {(["classic", "timed", "endless"] as Mode[]).map(m =>
          <p key={m} className="flex justify-between py-2 border-b border-line/15">
            <span>{names[m]}</span><strong>{data.best[m] ?? "—"}</strong>
          </p>)}
        <h3 className="font-bold mt-6 mb-2">Favorite topics</h3><div className="profile-favorite-tags">{data.profile.favorites.length?data.profile.favorites.map(category=><span key={category}>{category}</span>):<span className="muted">No favorite topics selected</span>}</div>
        {!isDemo && <AccountActions/>}
        {data.profile.admin && <Link className="secondary mt-3" to="/admin">Content administration</Link>}
      </section>
    </div>
    <div className="section-heading mt-9 mb-4"><div><p className="eyebrow">YOUR JOURNEY</p><h2 className="text-2xl font-bold mt-2">Recent sessions</h2></div><span className="muted text-sm">{data.sessions.length} recent</span></div>
    {!data.sessions.length && <div className="empty-state"><span className="empty-icon" aria-hidden="true">◎</span><h3 className="font-bold mt-3">Your first run is waiting</h3><p className="muted mt-2">Complete an adventure and your latest results will appear here.</p><Link className="primary mt-4" to="/home">Choose a challenge</Link></div>}
    <div className="session-list grid gap-2">
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
  </div>;
}
function authMessage(message:string){const m=message.toLowerCase();if(m.includes("invalid login credentials"))return "E-Mail oder Passwort ist nicht korrekt.";if(m.includes("email not confirmed"))return "Bitte bestätige zuerst deine E-Mail-Adresse.";if(m.includes("user already registered")||m.includes("already been registered"))return "Für diese E-Mail gibt es bereits ein Konto. Melde dich an oder setze dein Passwort zurück.";if(m.includes("password")&&m.includes("least"))return "Das Passwort erfüllt die Mindestlänge nicht.";if(m.includes("email address")&&m.includes("already"))return "Diese E-Mail-Adresse wird bereits verwendet.";if(/duplicate|unique|username_taken/i.test(message))return "Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen.";if(m.includes("invalid_profile"))return "Die Supabase-Datenbank unterstützt diese Avatar-Auswahl noch nicht. Bitte zuerst die neueste Migration anwenden.";return message;}

function Onboarding(){const [message,setMessage]=useState("");const [pending,setPending]=useState(false);const nav=useNavigate();
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setPending(true);setMessage("");const name=String(new FormData(e.currentTarget).get("username")??"").trim();
    try{if(!validUsername(name))throw new Error("Verwende 2–24 Zeichen: Buchstaben, Zahlen, Leerzeichen, _ oder -.");await api.claimUsername(name);if(isDemo)localStorage.setItem("atlas-demo-onboarded","yes");nav("/home",{replace:true});}
    catch(err){const m=(err as Error).message;setMessage(/duplicate|unique|username_taken/i.test(m)?"Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen.":m)}finally{setPending(false)}}
  return <section className="auth-panel onboarding-panel max-w-lg mx-auto"><p className="eyebrow">ONE LAST STEP</p><h1 tabIndex={-1} className="heading mt-2">Choose your explorer name</h1><p className="muted mt-3">Your name is unique across all players and can be changed later.</p><form onSubmit={save} className="mt-5 space-y-4"><label>Username<input name="username" minLength={2} maxLength={24} pattern="[A-Za-z0-9 _\-]+" required autoComplete="nickname"/></label><p className="field-hint muted">2–24 characters · letters, numbers, spaces, _ or -</p><button className="primary w-full" disabled={pending}>{pending?"Saving your name…":"Continue to Atlas Arena →"}</button><p role="alert">{message}</p></form></section>}
function ThemeControl(){const [theme,setTheme]=useState(localStorage.getItem("atlas-theme")??"system");const choose=(value:string)=>{setTheme(value);if(value==="system")localStorage.removeItem("atlas-theme");else localStorage.setItem("atlas-theme",value);applyTheme(value)};return <div className="theme-control"><div><strong>Color theme</strong><p className="muted text-sm">Choose a theme for this device.</p></div><div className="theme-choice-list" role="radiogroup" aria-label="Color theme">{([ ["system","System","◐"],["light","Light","☼"],["dark","Dark","◑"] ] as const).map(([value,label,icon])=><button key={value} type="button" role="radio" aria-checked={theme===value} className={`theme-choice ${theme===value?"is-selected":""}`} onClick={()=>choose(value)}><span aria-hidden="true">{icon}</span>{label}</button>)}</div></div>}
function AccountActions(){const [user,setUser]=useState<{isAnonymous:boolean;email:string|null}|null>(null);useEffect(()=>{api.currentUser().then(setUser).catch(()=>setUser(null))},[]);
 return <div className="account-actions mt-5"><p className="muted">{user?.isAnonymous?"Guest account · progress stays on this device.":`Account · ${user?.email??""}`}</p>{user?.isAnonymous&&<Link className="primary" to="/auth?mode=link">Create an account to save progress</Link>}<ThemeControl/></div>}

function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [action, setAction] = useState(params.has("recovery") ? "change" : params.get("mode") ?? "choice");
  const [checkingSession,setCheckingSession]=useState(Boolean(supabase));
  const [activeSession,setActiveSession]=useState(false);
  const [message, setMessage] = useState(params.get("reason")==="account_deleted"?"Dieses Konto ist nicht mehr verfügbar. Melde dich mit einem anderen Konto an oder erstelle ein neues.":"");
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
  return <section className="auth-panel max-w-lg mx-auto">
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
function isDeletedAuthUser(error:unknown){return /AUTH_REQUIRED|user.*not found|user from sub claim.*does not exist/i.test((error as Error)?.message??String(error))}
function Protected({children}:{children:JSX.Element}) {
  const location=useLocation(), navigate=useNavigate(); const authClient=supabase; const deletedAccount=useRef(false); const [state,setState]=useState<"loading"|"guest"|"account"|"out"|"deleted"|"onboarding"|"error">("loading");
  useEffect(()=>{let active=true;
    if(isDemo){if(localStorage.getItem("atlas-demo-signed-out")==="yes"){setState("out");return()=>{active=false}}if(location.pathname==="/onboarding"){setState("guest");return()=>{active=false}}api.dashboard().then(d=>{if(active)setState(d.profile.username==="Traveler"&&!localStorage.getItem("atlas-demo-onboarded")?"onboarding":"guest")}).catch(()=>{if(active)setState("error")});return()=>{active=false}}
    if(!supabase)return;
    const resolve=async(session:any)=>{if(!session){if(active)setState(deletedAccount.current?"deleted":"out");return}const kind=session.user?.is_anonymous===false?"account":"guest";if(location.pathname==="/onboarding"){await api.currentUser();if(active)setState(kind);return}
      try{const d=await api.dashboard();const confirmed=await api.usernameConfirmed();const requested=String(session.user?.user_metadata?.requested_username??"");
        if(!confirmed&&requested){try{await api.claimUsername(requested);if(active)setState(kind);return}catch(e){if(/duplicate|unique|username_taken/i.test((e as Error).message)){if(active)setState("onboarding");return}throw e}}
        if(active)setState(!confirmed||!validUsername(d.profile.username)?"onboarding":kind)
      }catch(e){if(isDeletedAuthUser(e)){deletedAccount.current=true;try{await api.signOut()}catch{}if(active)setState("deleted")}else if(active)setState("error")}};
    supabase.auth.getSession().then(({data,error})=>{if(error){if(active)setState("error")}else void resolve(data.session)});
    const subscription=supabase.auth.onAuthStateChange?.((_e,s)=>{void resolve(s)})?.data.subscription;return()=>{active=false;subscription?.unsubscribe()};},[location.pathname]);
  useEffect(()=>{if(state==="out")navigate(isDemo?"/":"/auth?mode=signin&next="+encodeURIComponent(location.pathname),{replace:true});if(state==="deleted")navigate("/auth?mode=signin&reason=account_deleted",{replace:true})},[state,location.pathname,navigate]);
  useEffect(()=>{if(state==="onboarding")navigate("/onboarding",{replace:true})},[state,navigate]);
  useEffect(()=>{if(isDemo||!authClient)return;let live=true;const validate=async()=>{const {error}=await authClient.auth.getUser();if(error&&isDeletedAuthUser(error)){deletedAccount.current=true;try{await api.signOut()}catch{}if(live)setState("deleted")}};const timer=window.setInterval(()=>void validate(),30000);window.addEventListener("focus",validate);return()=>{live=false;window.clearInterval(timer);window.removeEventListener("focus",validate)}},[]);
  if(state==="loading"||state==="out"||state==="deleted"||state==="onboarding")return <Loading/>;
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
  useEffect(()=>{api.currentUser().then(user=>setIsAnonymous(user.isAnonymous)).catch(()=>setIsAnonymous(null))},[]);
  async function run(task: () => Promise<unknown>) {
    setPending(true); setMessage("");
    try { await task(); }
    catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="settings-shell">
    <div className="page-intro"><div><p className="eyebrow">PREFERENCES</p><h1 tabIndex={-1} className="heading mt-2">Make yourself at home.</h1></div><p className="muted">Tune the arena to the way you play.</p></div>
    <section className="card mt-6 space-y-5">
      <h2 className="text-xl font-bold">Appearance and comfort</h2>
      <ThemeControl/>
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
      <Route path="flags/*" element={<Protected><Flags/></Protected>}/>
      <Route path="recall/*" element={<Protected><RegionRecallSetup/></Protected>}/>
      <Route path="capitals/*" element={<Protected><Capitals/></Protected>}/>
      <Route path="admin" element={<Protected><Admin/></Protected>}/>
      <Route path="*" element={<section className="card">
        <h1 tabIndex={-1} className="heading">Uncharted territory.</h1>
        <Link className="primary mt-5" to="/">Return home</Link>
      </section>}/>
    </Route>
  </Routes>;
}
