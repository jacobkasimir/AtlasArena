// Small helpers shared by the Profile screens.
import { useState } from "react";
import { DEMO_UNAVAILABLE, api } from "@shared/api";
import { Button, StatusMessage } from "@phone/ui";

/** True when a demo call rejected because the feature needs an online account. */
export const isOnlineOnly = (message: string) => message.includes(DEMO_UNAVAILABLE);

/** Error text without the machine-readable prefix ("AUTH_REQUIRED: …"). */
export const readableError = (message: string) => message.replace(/^[A-Z_]{4,}:\s*/, "");

export type CurrentUser = Awaited<ReturnType<typeof api.currentUser>>;

/**
 * Inline error for a failed profile load. A lost guest session (AUTH_REQUIRED) can be restored with
 * "Continue as guest", like the desktop GuestSessionRecovery.
 */
export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  const [pending, setPending] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const lostSession = message.includes("AUTH_REQUIRED");
  async function restore() {
    setPending(true);
    setRestoreError("");
    try {
      await api.guest();
      retry();
    } catch (error) {
      setRestoreError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="ph-stack">
      <StatusMessage tone="error" retry={lostSession ? undefined : retry}>
        {lostSession ? "Your guest session was not found on this device." : readableError(message)}
      </StatusMessage>
      {lostSession && (
        <Button variant="primary" block loading={pending} onClick={() => void restore()}>
          Continue as guest
        </Button>
      )}
      {restoreError && <StatusMessage tone="error">{restoreError}</StatusMessage>}
    </div>
  );
}
