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
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export const api = {
  guest: async () => {
    if (isDemo) return demo.guest();
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session) {
      const { error } = await supabase!.auth.signInAnonymously();
      if (error) throw error;
    }
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
  saveProfile: (profile: Omit<Profile, "xp" | "admin">) =>
    isDemo ? demo.saveProfile(profile) : rpc<void>("arena_profile", {
      p_username: profile.username, p_avatar: profile.avatar, p_favorites: profile.favorites
    }),
  explore: () =>
    isDemo ? demo.explore() : rpc<Country[]>("arena_explore"),
  exportData: () =>
    isDemo ? demo.exportData() : rpc<unknown>("arena_export"),
  deleteAccount: async () => {
    if (isDemo) return demo.deleteAccount();
    const { error } = await supabase!.functions.invoke("delete-account", { method: "DELETE" });
    if (error) throw error;
    await supabase!.auth.signOut();
  },
  signOut: async () => {
    if (isDemo) return demo.signOut();
    const { error } = await supabase!.auth.signOut();
    if (error) throw error;
  },
  signIn: async (email: string, password: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  link: async (email: string, password: string) => {
    if (!supabase) throw new Error("Accounts require Supabase configuration.");
    await api.guest();
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
  adminList: (search = "", offset = 0) =>
    rpc<{ items: Record<string, unknown>[] }>("arena_admin_list", {
      p_search: search, p_offset: offset
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
