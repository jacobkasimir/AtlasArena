import { ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSessionGate } from "@shared/auth-flow";
import { LoadingState, StatusMessage } from "@phone/ui";
import { paths } from "./paths";

/**
 * Phone version of the desktop <Protected>: same shared session logic (src/auth-flow.ts), phone routes.
 * Signed out → /welcome, deleted account → /sign-in, no username yet → /onboarding.
 */
export function PhoneGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onOnboarding = location.pathname === paths.onboarding;
  // Re-check only when entering or leaving onboarding, not on every tab change.
  const state = useSessionGate(onOnboarding ? paths.onboarding : paths.home, paths.onboarding);

  useEffect(() => {
    if (state === "out") navigate(paths.welcome, { replace: true });
    else if (state === "deleted") navigate(`${paths.signIn}?mode=signin&reason=account_deleted`, { replace: true });
    else if (state === "onboarding" && !onOnboarding) navigate(paths.onboarding, { replace: true });
  }, [state, onOnboarding, navigate]);

  if (state === "error")
    return (
      <div className="ph-auth">
        <StatusMessage tone="error" retry={() => window.location.reload()}>
          Your session or profile could not be loaded. Check your connection and try again.
        </StatusMessage>
      </div>
    );
  if (state === "loading" || state === "out" || state === "deleted" || (state === "onboarding" && !onOnboarding))
    return <LoadingState label="Loading your progress…" />;
  return <>{children}</>;
}
