// Phone Explorer: list, search and region filter on the demo engine; detail sheet, neighbour hops and study mode.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn(), playNotes: vi.fn() }));

import { api } from "@shared/api";
import type { ExplorerCountry } from "@shared/domain";
import ExplorerArea from "./index";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path = "/explorer") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/explorer/*" element={<ExplorerArea />} />
        <Route path="*" element={<p>Other page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const rows = () => within(screen.getByRole("list", { name: "Places" })).getAllByRole("listitem");

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Explorer on the demo engine", () => {
  it("lists every demo place with local flag and capital", async () => {
    const { container } = renderAt();
    expect(await screen.findByText("Showing 12 of 12 places")).toBeInTheDocument();
    expect(rows()).toHaveLength(12);
    expect(screen.getByRole("button", { name: /^Iceland Reykjavík/ })).toBeInTheDocument();
    const srcs = [...container.querySelectorAll(".ph-explore-list img")].map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/flags/is.svg");
    expect(srcs.every((src) => /^\/flags\/[a-z]{2}\.svg$/.test(src ?? ""))).toBe(true);
  });

  it("searches names and capitals, ignoring accents", async () => {
    renderAt();
    const field = await screen.findByLabelText("Find a place");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("enterkeyhint", "search");
    fireEvent.change(field, { target: { value: "reykjavik" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 12 place".replace("12 place", "1 place"))).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "zzz" } });
    expect(screen.getByText("No places match.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all places" }));
    expect(rows()).toHaveLength(12);
  });

  it("filters by region and links the region into Flags and Capitals", async () => {
    renderAt();
    const group = await screen.findByRole("group", { name: "Region" });
    const europe = within(group).getByRole("button", { name: /Europe/ });
    fireEvent.click(europe);
    expect(europe).toHaveAttribute("aria-pressed", "true");
    expect(rows()).toHaveLength(4);
    expect(screen.getByTestId("where").textContent).toBe("/explorer?region=Europe");
    const practise = screen.getByRole("region", { name: "Practise Europe" });
    expect(within(practise).getByRole("link", { name: "Flags" })).toHaveAttribute("href", "/flags?region=Europe");
    expect(within(practise).getByRole("link", { name: "Capitals" })).toHaveAttribute("href", "/capitals?region=Europe");
  });

  it("keeps the remembered setup in the practise link", async () => {
    localStorage.setItem("atlas-setup-flags", JSON.stringify({ mode: "flag_to_country", pool: "easy", size: 10 }));
    renderAt("/explorer?region=Asia");
    const link = await screen.findByRole("link", { name: "Flags" });
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("mode")).toBe("flag_to_country");
    expect(link.getAttribute("href")).toContain("region=Asia");
  });

  it("opens and closes the detail sheet", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /^Egypt Cairo/ }));
    const sheet = await screen.findByRole("dialog", { name: "Egypt" });
    expect(within(sheet).getByText("Cairo")).toBeInTheDocument();
    expect(within(sheet).getByText("Africa")).toBeInTheDocument();
    expect(within(sheet).getByText("No border data in this catalog.")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Capitals" })).toHaveAttribute("href", "/capitals?region=Africa");
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("study mode hides capitals until tapped, in the list and in the sheet", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("radio", { name: /Study capitals/ }));
    expect(screen.queryByText("Reykjavík")).not.toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "Reveal the capital of Iceland" });
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(reveal);
    const shown = screen.getByRole("button", { name: /Capital of Iceland: Reykjavík/ });
    expect(shown).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Revealed 1 of 12/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    expect(screen.getByText(/Revealed 0 of 12/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Finland Europe/ }));
    const sheet = await screen.findByRole("dialog", { name: "Finland" });
    expect(within(sheet).queryByText("Helsinki")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Tap to reveal" }));
    expect(within(sheet).getByText("Helsinki")).toBeInTheDocument();
    expect(localStorage.getItem("atlas-phone-explorer-study")).toBe("1");
  });

  it("shows more rows in pages", async () => {
    const many: ExplorerCountry[] = Array.from({ length: 95 }, (_, index) => ({
      code: `Q${index}`,
      name: `Place ${String(index).padStart(2, "0")}`,
      capital: `Town ${index}`,
      region: "Europe",
      currency: null,
      flag: null,
      difficulty: "easy",
      catalogKind: "non_iso",
    }));
    vi.spyOn(api, "explore").mockResolvedValue(many);
    renderAt();
    expect(await screen.findByText("Showing 40 of 95 places")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(rows()).toHaveLength(80);
    fireEvent.click(screen.getByRole("button", { name: /Show more \(15 of 15 left\)/ }));
    expect(rows()).toHaveLength(95);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });
});

describe("Explorer neighbours (server-shaped data)", () => {
  const base = { currency: null, flag: null, difficulty: "easy" as const, region: "Europe" };
  const catalog: ExplorerCountry[] = [
    { ...base, code: "DE", name: "Germany", capital: "Berlin", codeAlpha3: "DEU", borders: ["FRA", "CHE"], population: 83000000, languages: ["German"], memberships: [{ name: "united_nations", member: true }] },
    { ...base, code: "FR", name: "France", capital: "Paris", codeAlpha3: "FRA", borders: ["DEU"] },
  ];

  it("opens a neighbour from its chip and steps back", async () => {
    vi.spyOn(api, "explore").mockResolvedValue(catalog);
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /^Germany Berlin/ }));
    let sheet = await screen.findByRole("dialog", { name: "Germany" });
    expect(within(sheet).getByText("UN member state")).toBeInTheDocument();
    expect(within(sheet).getByText("83,000,000")).toBeInTheDocument();
    expect(within(sheet).getByText("Switzerland")).not.toHaveAttribute("type");
    fireEvent.click(within(sheet).getByRole("button", { name: "France" }));
    sheet = await screen.findByRole("dialog", { name: "France" });
    expect(within(sheet).getByText("Paris")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /Back to Germany/ }));
    expect(await screen.findByRole("dialog", { name: "Germany" })).toBeInTheDocument();
  });

  it("opens a place from a deep link", async () => {
    vi.spyOn(api, "explore").mockResolvedValue(catalog);
    renderAt("/explorer?place=FR");
    expect(await screen.findByRole("dialog", { name: "France" })).toBeInTheDocument();
  });
});
