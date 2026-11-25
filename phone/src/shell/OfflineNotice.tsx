import { useEffect, useState } from "react";

/** Thin notice under the top bar while the phone has no connection. */
export function OfflineNotice() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {!online && (
        <p className="ph-status mx-4 mt-3" data-tone="warning">
          You're offline. Games, sign-in and saving need a connection.
        </p>
      )}
    </div>
  );
}
