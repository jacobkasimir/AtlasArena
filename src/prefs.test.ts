import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_CONTINUE_MS,
  applyDocumentPrefs,
  autoContinueMs,
  clearSavedSetups,
  defaultPrefs,
  getPrefs,
  loadSetup,
  normalizePrefs,
  reloadPrefs,
  resetPrefs,
  saveSetup,
  setPref,
  showCountdown,
} from "./prefs";

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
});

afterEach(() => {
  localStorage.clear();
  reloadPrefs();
});

describe("prefs defaults", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(getPrefs()).toEqual(defaultPrefs);
  });

  it("falls back to the defaults when storage holds invalid JSON", () => {
    localStorage.setItem("atlas-prefs", "{not json");
    reloadPrefs();
    expect(getPrefs()).toEqual(defaultPrefs);
  });

  it("uses PC friendly defaults", () => {
    expect(defaultPrefs).toMatchObject({
      sound: true,
      volume: 60,
      numberKeys: true,
      continueKeys: "enter-space",
      timerDisplay: "always",
      textSize: "normal",
      density: "comfortable",
      confirmLeave: true,
    });
  });
});

describe("merging stored values", () => {
  it("keeps values saved by an older version and fills in new fields", () => {
    localStorage.setItem("atlas-prefs", JSON.stringify({ haptics: false, autoContinue: true, keyboardHints: false }));
    reloadPrefs();
    expect(getPrefs()).toEqual({ ...defaultPrefs, haptics: false, autoContinue: true, keyboardHints: false });
  });

  it("drops unknown keys and replaces values of the wrong type", () => {
    const prefs = normalizePrefs({
      sound: "yes",
      volume: 250,
      textSize: "huge",
      density: "compact",
      continueKeys: "enter",
      somethingOld: 1,
    });
    expect(prefs).toEqual({ ...defaultPrefs, volume: 100, density: "compact", continueKeys: "enter" });
    expect(prefs).not.toHaveProperty("somethingOld");
  });

  it("clamps and rounds the volume", () => {
    expect(normalizePrefs({ volume: -5 }).volume).toBe(0);
    expect(normalizePrefs({ volume: 42.6 }).volume).toBe(43);
    expect(normalizePrefs({ volume: Number.NaN }).volume).toBe(defaultPrefs.volume);
  });

  it("migrates the legacy reduce-motion key until the preference is saved", () => {
    localStorage.setItem("atlas-motion", "reduce");
    reloadPrefs();
    expect(getPrefs().reduceMotion).toBe(true);
    expect(normalizePrefs({ reduceMotion: false }, "reduce").reduceMotion).toBe(false);
  });

  it("treats non-object storage as empty", () => {
    expect(normalizePrefs(null)).toEqual(defaultPrefs);
    expect(normalizePrefs([1, 2])).toEqual(defaultPrefs);
  });
});

describe("setPref and resetPrefs", () => {
  it("saves a single preference and keeps the others", () => {
    setPref("volume", 30);
    setPref("textSize", "large");
    reloadPrefs();
    expect(getPrefs()).toEqual({ ...defaultPrefs, volume: 30, textSize: "large" });
    expect(JSON.parse(localStorage.getItem("atlas-prefs") ?? "{}")).toMatchObject({ volume: 30, textSize: "large" });
  });

  it("removes the legacy motion key once preferences are saved", () => {
    localStorage.setItem("atlas-motion", "reduce");
    reloadPrefs();
    setPref("sound", false);
    expect(localStorage.getItem("atlas-motion")).toBeNull();
    reloadPrefs();
    expect(getPrefs().reduceMotion).toBe(true);
  });

  it("reflects display preferences on the document element", () => {
    setPref("highContrast", true);
    setPref("density", "compact");
    setPref("reduceMotion", true);
    setPref("focusAlways", true);
    setPref("textSize", "larger");
    const root = document.documentElement;
    expect(root.dataset).toMatchObject({
      contrast: "more",
      density: "compact",
      motion: "reduce",
      focus: "always",
      textSize: "larger",
    });
  });

  it("resets every preference to its default", () => {
    setPref("sound", false);
    setPref("numberKeys", false);
    resetPrefs();
    expect(getPrefs()).toEqual(defaultPrefs);
    const element = document.createElement("div");
    applyDocumentPrefs(getPrefs(), element);
    expect(element.dataset).toMatchObject({ contrast: "normal", density: "comfortable", motion: "system" });
  });
});

describe("derived helpers", () => {
  it("maps auto-continue speeds to delays", () => {
    expect(autoContinueMs("normal")).toBe(AUTO_CONTINUE_MS);
    expect(autoContinueMs("quick")).toBeLessThan(AUTO_CONTINUE_MS);
    expect(autoContinueMs("relaxed")).toBeGreaterThan(AUTO_CONTINUE_MS);
  });

  it("hides calm countdowns until time is nearly up", () => {
    expect(showCountdown({ timerDisplay: "always" }, 120_000)).toBe(true);
    expect(showCountdown({ timerDisplay: "calm" }, 120_000)).toBe(false);
    expect(showCountdown({ timerDisplay: "calm" }, 30_000)).toBe(true);
    expect(showCountdown({ timerDisplay: "calm" }, 15_000, 10_000)).toBe(false);
  });

  it("remembers setups only while rememberSetup is on", () => {
    saveSetup("flags", { region: "europe" });
    expect(loadSetup("flags")).toEqual({ region: "europe" });
    setPref("rememberSetup", false);
    expect(loadSetup("flags")).toEqual({});
  });
});

describe("clearSavedSetups", () => {
  it("forgets every remembered game setup and keeps other device data", () => {
    saveSetup("flags", { region: "Europe" });
    saveSetup("capitals", { region: "Asia" });
    setPref("sound", false);
    localStorage.setItem("unrelated", "keep");

    expect(loadSetup("flags")).toEqual({ region: "Europe" });

    clearSavedSetups();

    expect(loadSetup("flags")).toEqual({});
    expect(loadSetup("capitals")).toEqual({});
    expect(Object.keys(localStorage).some((key) => key.startsWith("atlas-setup-"))).toBe(false);
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(getPrefs().sound).toBe(false);
    expect(JSON.parse(localStorage.getItem("atlas-prefs") ?? "{}")).toMatchObject({ sound: false });
  });

  it("does nothing when no setup was saved", () => {
    localStorage.setItem("unrelated", "keep");
    clearSavedSetups();
    expect(Object.keys(localStorage)).toEqual(["unrelated"]);
  });
});
