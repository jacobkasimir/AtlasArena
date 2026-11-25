// Edit profile (/profile/edit) and Account & data (/profile/account) for the phone Profile.
// Every write goes through api.* (demo branch included); the server validates usernames and profiles.
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAnalytics } from "@shared/analytics";
import { api, isDemo } from "@shared/api";
import { USERNAME_RULE, authMessage } from "@shared/auth-flow";
import { download, useLoad } from "@shared/components";
import { Profile, avatarLabels, avatars, categories, normalizeUsername, validUsername } from "@shared/domain";
import { Icon } from "@shared/icons";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionBar,
  BottomSheet,
  Button,
  Card,
  Chip,
  ChipGroup,
  LinkButton,
  LoadingState,
  Section,
  StatusMessage,
  TextField,
  useToast,
} from "@phone/ui";
import { LoadError, readableError } from "./helpers";

/** Word the player must type before the account (or the demo data) is deleted. */
export const DELETE_WORD = "DELETE";

// ---------- Edit profile ----------

export function EditProfileScreen() {
  usePhoneChrome({ title: "Edit profile", back: paths.profile });
  const { data, error, reload } = useLoad(() => api.dashboard());
  if (error) return <LoadError message={error} retry={reload} />;
  if (!data) return <LoadingState label="Loading your profile…" />;
  return <EditProfileForm profile={data.profile} />;
}

function EditProfileForm({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState(profile.username);
  const [avatar, setAvatar] = useState(
    Number.isInteger(profile.avatar) && profile.avatar >= 0 && profile.avatar < avatars.length ? profile.avatar : 0,
  );
  const [favorites, setFavorites] = useState<string[]>(profile.favorites ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);

  const nameValid = validUsername(username);
  const changed =
    normalizeUsername(username) !== profile.username ||
    avatar !== profile.avatar ||
    favorites.length !== profile.favorites.length ||
    favorites.some((topic) => !profile.favorites.includes(topic));

  function toggleFavorite(topic: string) {
    setFavorites((current) => (current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic]));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (saving || !nameValid) return;
    setSaving(true);
    setMessage("");
    try {
      await api.saveProfile({ username: normalizeUsername(username), avatar, favorites });
      toast.show("Profile saved", { tone: "success" });
      navigate(paths.profile, { replace: true });
    } catch (cause) {
      setMessage(authMessage(readableError((cause as Error).message)));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="ph-stack">
      <Section title="Username">
        <TextField
          label="Username"
          name="username"
          value={username}
          maxLength={24}
          autoComplete="nickname"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          hint={USERNAME_RULE}
          aria-invalid={touched && !nameValid ? true : undefined}
          onChange={(event) => setUsername(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        {touched && !nameValid && <StatusMessage tone="error">{USERNAME_RULE}</StatusMessage>}
      </Section>

      <Section title="Avatar">
        <button
          type="button"
          className="ph-link-card"
          aria-haspopup="dialog"
          aria-label={`Choose avatar. Current: ${avatarLabels[avatar]}`}
          onClick={() => setPickerOpen(true)}
        >
          <span className="ph-account-avatar" aria-hidden="true">
            {avatars[avatar]}
          </span>
          <span className="ph-link-card-text">
            <strong>{avatarLabels[avatar]}</strong>
            <small>Tap to choose from {avatars.length} avatars</small>
          </span>
          <span className="ph-chevron" aria-hidden="true">
            <Icon name="chevronRight" size={20} />
          </span>
        </button>
      </Section>

      <Section title="Favorite topics">
        <ChipGroup label="Favorite topics">
          {categories.map((topic) => (
            <Chip key={topic} pressed={favorites.includes(topic)} onToggle={() => toggleFavorite(topic)}>
              {topic[0].toUpperCase() + topic.slice(1)}
            </Chip>
          ))}
        </ChipGroup>
      </Section>

      <StatusMessage tone="error">{message}</StatusMessage>

      <ActionBar label="Save profile">
        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!changed}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </ActionBar>

      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose an avatar">
        <div className="ph-account-avatar-grid" role="radiogroup" aria-label="Avatars">
          {avatars.map((emoji, index) => (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={avatar === index}
              aria-label={avatarLabels[index]}
              className="ph-account-avatar-option"
              onClick={() => {
                setAvatar(index);
                setPickerOpen(false);
              }}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </form>
  );
}

// ---------- Account & data ----------

type Sheet = "closed" | "sign-out" | "delete";

export function AccountScreen() {
  usePhoneChrome({ title: "Account & data", back: paths.profile });
  const navigate = useNavigate();
  const toast = useToast();
  const user = useLoad(() => api.currentUser());
  const [sheet, setSheet] = useState<Sheet>("closed");
  const [pending, setPending] = useState<"" | "export" | "sign-out" | "delete">("");
  const [message, setMessage] = useState("");
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (sheet !== "delete") setConfirmText("");
  }, [sheet]);

  if (user.error && !user.error.includes("AUTH_REQUIRED")) return <LoadError message={user.error} retry={user.reload} />;
  if (!user.data && !user.error) return <LoadingState label="Loading your account…" />;

  const isGuest = isDemo || user.data?.isAnonymous !== false;
  const isAccount = !isDemo && user.data?.isAnonymous === false;
  const what = isDemo ? "demo data" : "account";

  async function exportData() {
    if (pending) return;
    setPending("export");
    setMessage("");
    try {
      download("atlas-data.json", await api.exportData());
      toast.show("Your data was downloaded", { tone: "success" });
    } catch (cause) {
      setMessage(`Could not download your data: ${readableError((cause as Error).message)}`);
    } finally {
      setPending("");
    }
  }

  async function signOut() {
    if (pending) return;
    setPending("sign-out");
    setMessage("");
    try {
      await api.signOut();
      setAnalytics(false);
      setSheet("closed");
      navigate(paths.welcome, { replace: true });
    } catch (cause) {
      setMessage(`Could not sign out: ${readableError((cause as Error).message)}`);
      setPending("");
    }
  }

  async function deleteAccount() {
    if (pending || confirmText.trim() !== DELETE_WORD) return;
    setPending("delete");
    setMessage("");
    try {
      await api.deleteAccount();
      setAnalytics(false);
      setSheet("closed");
      navigate(paths.welcome, { replace: true });
    } catch (cause) {
      setMessage(`Could not delete your ${what}: ${readableError((cause as Error).message)}`);
      setPending("");
    }
  }

  return (
    <div className="ph-stack">
      <Card as="section" className="grid gap-2" aria-label="Your account">
        <p className="font-bold">
          {isDemo ? "Local demo" : isAccount ? "Signed in" : "Guest account"}
        </p>
        <p className="ph-muted text-sm">
          {isDemo
            ? "Your progress stays in this browser. It is sample data and is never uploaded to an account."
            : isAccount
              ? `Your progress is saved to your account${user.data?.email ? ` (${user.data.email})` : ""}.`
              : "Your progress is tied to this device. Create an account so you don't lose it."}
        </p>
        {!isDemo && isGuest && (
          <LinkButton to={`${paths.signIn}?mode=link`} variant="primary" block icon={<Icon name="sparkles" />}>
            Create an account
          </LinkButton>
        )}
      </Card>

      <Section title="Your data">
        <Button block icon={<Icon name="book" />} loading={pending === "export"} onClick={() => void exportData()}>
          Download my data
        </Button>
        <p className="ph-muted text-sm">A JSON file with your profile, rounds and results.</p>
      </Section>

      {isAccount && (
        <Section title="Session">
          <Button block icon={<Icon name="lock" />} disabled={Boolean(pending)} onClick={() => setSheet("sign-out")}>
            Sign out
          </Button>
        </Section>
      )}

      <Section title="Danger zone">
        <Button variant="danger" block disabled={Boolean(pending)} onClick={() => setSheet("delete")}>
          Delete {what}
        </Button>
        <p className="ph-muted text-sm">
          {isDemo
            ? "Removes every demo round and setting stored for the demo in this browser."
            : "Permanently deletes your account, progress, results and leaderboard entries."}
        </p>
      </Section>

      <StatusMessage tone="error">{sheet === "closed" ? message : ""}</StatusMessage>

      <BottomSheet
        open={sheet === "sign-out"}
        onClose={() => setSheet("closed")}
        canClose={() => pending !== "sign-out"}
        title="Sign out?"
        footer={
          <>
            <Button disabled={pending === "sign-out"} onClick={() => setSheet("closed")}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending === "sign-out"} onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      >
        <p>Your progress stays saved in your account. Sign in again to continue on this device.</p>
        <StatusMessage tone="error">{sheet === "sign-out" ? message : ""}</StatusMessage>
      </BottomSheet>

      <BottomSheet
        open={sheet === "delete"}
        onClose={() => setSheet("closed")}
        canClose={() => pending !== "delete"}
        title={`Delete ${what}?`}
        footer={
          <>
            <Button disabled={pending === "delete"} onClick={() => setSheet("closed")}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending === "delete"}
              disabled={confirmText.trim() !== DELETE_WORD}
              onClick={() => void deleteAccount()}
            >
              Delete forever
            </Button>
          </>
        }
      >
        <form
          className="ph-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount();
          }}
        >
          <p>
            This can't be undone.{" "}
            {isDemo
              ? "All demo rounds, results and the demo profile are removed from this browser."
              : "Your account, progress, results and leaderboard entries are deleted for good."}
          </p>
          <TextField
            label={`Type ${DELETE_WORD} to confirm`}
            value={confirmText}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => setConfirmText(event.target.value)}
          />
          <StatusMessage tone="error">{sheet === "delete" ? message : ""}</StatusMessage>
        </form>
      </BottomSheet>
    </div>
  );
}
