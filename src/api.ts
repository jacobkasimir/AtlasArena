import { createClient } from "@supabase/supabase-js";
import { demo } from "./demo";
import { Country, Dashboard, Difficulty, Mode, Profile, View } from "./domain";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configurationError = Boolean(url) !== Boolean(key)
  ? "Set both Supabase environment variables, or leave both empty for local demo."
  : null;
export const isDemo = !url && !key;
export const supabase = url && key ? createClient(url, key) : null;

async function rpc<T>(name: string, params = {}): Promise<T> {
  if (!supabase) throw new Error(configurationError ?? "Supabase is not configured.");
  await requireSession();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Wait for Supabase auth storage to finish restoring before any protected RPC. */
async function requireSession() {
  if (!supabase) throw new Error(configurationError ?? "Supabase is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Could not restore your session: ${error.message}`);
  if (!data.session) {
    throw new Error("AUTH_REQUIRED: No guest session is active. Continue as guest to load your progress.");
  }
  return data.session;
}

export const api = {
  guest: async () => {
    if (isDemo) { localStorage.removeItem("atlas-demo-signed-out"); return demo.guest(); }
    const { data, error: restoreError } = await supabase!.auth.getSession();
    if (restoreError) throw new Error(`Could not restore your session: ${restoreError.message}`);
    if (!data.session) {
      const { data: signedIn, error } = await supabase!.auth.signInAnonymously();
      if (error) throw error;
      if (!signedIn.session) throw new Error("Guest sign-in completed without an active session. Please retry.");
    }
    await requireSession();
  },
  play: (mode: Mode, cats: string[], difficulty: Difficulty, country?: string, count = 10) =>
    isDemo ? demo.play(mode, cats, difficulty, country, count)
      : rpc<View>("arena_start", {
        p_mode: mode, p_categories: cats, p_difficulty: difficulty,
        p_country: country ?? null, p_count: count
      }),
  view: (id: string) => isDemo ? demo.view(id) : rpc<View>("arena_view", { p_id: id }),
  answer: (id: string, questionId: string, optionId: string) =>
    isDemo ? demo.answer(id, questionId, optionId)
      : rpc<View>("arena_answer", { p_id: id, p_question: questionId, p_option: optionId }),
  next: (id: string) =>
    isDemo ? demo.next(id) : rpc<View>("arena_next", { p_id: id }),
  abandon: (id: string) =>
    isDemo ? demo.abandon(id) : rpc<void>("arena_abandon", { p_id: id }),
  dashboard: (offset = 0) =>
    isDemo ? demo.dashboard(offset) : rpc<Dashboard>("arena_dashboard", { p_offset: offset }),
  usernameConfirmed: () => rpc<boolean>("arena_username_confirmed"),
  saveProfile: async (profile: Omit<Profile, "xp" | "admin">) => {
    if (isDemo) return demo.saveProfile(profile);
    await rpc<void>("arena_profile", {
      p_username: profile.username.trim(), p_avatar: profile.avatar, p_favorites: profile.favorites
    });
    const username = profile.username.trim();
    const { error } = await supabase!.auth.updateUser({ data: { username, display_name: username, full_name: username, avatar: profile.avatar } });
    if (error) throw error;
  },
  explore: () =>
    isDemo ? demo.explore() : rpc<Country[]>("arena_explore"),
  exportData: () =>
    isDemo ? demo.exportData() : rpc<unknown>("arena_export"),
  deleteAccount: async () => {
    if (isDemo) { await demo.deleteAccount(); localStorage.setItem("atlas-demo-signed-out", "yes"); return; }
    const { error } = await supabase!.functions.invoke("delete-account", { method: "DELETE" });
    if (error) throw error;
    await supabase!.auth.signOut({ scope: "local" });
  },
  signOut: async () => {
    if (isDemo) { localStorage.setItem("atlas-demo-signed-out", "yes"); return demo.signOut(); }
    const { error } = await supabase!.auth.signOut({ scope: "local" });
    if (error) throw error;
  },
  signIn: async (email: string, password: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  signUp: async (email: string, password: string, username: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    const requestedUsername = username.trim();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + "/auth", data: { requested_username: requestedUsername, display_name: requestedUsername, full_name: requestedUsername } } });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  },
  currentUser: async () => {
    if (isDemo) return { id: "demo", isAnonymous: true, email: null as string | null };
    await requireSession();
    const { data, error } = await supabase!.auth.getUser();
    if (error) throw error;
    return { id: data.user.id, isAnonymous: Boolean(data.user.is_anonymous), email: data.user.email ?? null, requestedUsername: String(data.user.user_metadata?.requested_username ?? "") };
  },
  claimUsername: async (username: string) => {
    const existing = await api.dashboard();
    return api.saveProfile({ username: username.trim(), avatar: existing.profile.avatar, favorites: existing.profile.favorites });
  },
  link: async (email: string, password: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    await requireSession();
    if (!(await api.currentUser()).isAnonymous) throw new Error("This session already belongs to a permanent account.");
    const { error } = await supabase.auth.updateUser({ email, password });
    if (error) throw error;
  },
  resetPassword: async (email: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + "/auth?recovery=1"
    });
    if (error) throw error;
  },
  changePassword: async (password: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },
  adminList: (filters: {
    search: string; offset: number; category: string; topic: string;
    difficulty: string; reviewStatus: string; sourceVerified: boolean | null;
    type: string; countryCode: string; referenceYear: number | null
  }) =>
    rpc<{
      items: Record<string, unknown>[];
      total: number;
      topics: string[];
      categories: string[];
      difficulties: string[];
    }>("arena_admin_list_filtered", {
      p_search: filters.search,
      p_offset: filters.offset,
      p_category: filters.category || null,
      p_subcategory: filters.topic || null,
      p_difficulty: filters.difficulty || null,
      p_review_status: filters.reviewStatus || null,
      p_source_verified: filters.sourceVerified,
      p_type: filters.type || null,
      p_country_code: filters.countryCode || null,
      p_reference_year: filters.referenceYear
    }),
  adminImport: (
    records: unknown[], dryRun: boolean, policy: "reject" | "version", publish: boolean
  ) => rpc<{ ok: boolean; errors: { row: number; message: string }[]; count: number }>(
    "arena_admin_import",
    { p_records: records, p_dry_run: dryRun, p_policy: policy, p_publish: publish }
  ),
  unpublish: (stableId: string) =>
    rpc<void>("arena_admin_unpublish", { p_stable_id: stableId })
};
