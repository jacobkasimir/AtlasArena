const CONSENT = "atlas-analytics-consent";
const EVENTS = "atlas-local-events";
export const analyticsEnabled = () => localStorage.getItem(CONSENT) === "yes";
export function setAnalytics(enabled: boolean) {
  localStorage.setItem(CONSENT, enabled ? "yes" : "no");
  if (!enabled) localStorage.removeItem(EVENTS);
}
export function track(event: string, details: Record<string, string | number> = {}) {
  if (!analyticsEnabled()) return;
  let events: unknown[] = [];
  try { events = JSON.parse(localStorage.getItem(EVENTS) ?? "[]"); } catch {}
  events.push({ event, at: new Date().toISOString(), ...details });
  localStorage.setItem(EVENTS, JSON.stringify(events.slice(-100)));
}
export function readEvents() {
  return JSON.parse(localStorage.getItem(EVENTS) ?? "[]");
}
