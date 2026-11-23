import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import Explorer from "./Explorer";
import type { ExplorerCountry } from "./domain";

const { explore } = vi.hoisted(() => ({ explore: vi.fn() }));
vi.mock("./api", () => ({ api: { explore } }));

const catalog: ExplorerCountry[] = [
  {
    code: "CA", name: "Canada", officialName: "Canada", capital: "Ottawa", region: "North America",
    currency: "Canadian dollar", flag: "Maple leaf", difficulty: "easy",
    codeAlpha3: "CAN", borders: ["USA"],
    catalogKind: "iso_alpha2", flagSvgUrl: "https://flags.restcountries.com/ca.svg", population: 40000000,
    areaKm2: 9984670, languages: ["English", "French"], translations: { fr: "Canada français" },
    currencies: [{ code: "CAD", name: "Canadian dollar", symbol: "$" }],
    neighbors: [{ alpha3: "USA", code: "US", name: "United States" }],
    memberships: [{ name: "United Nations", member: true }], callingCodes: ["+1"], topLevelDomains: [".ca"],
    wikipediaUrl: "https://en.wikipedia.org/wiki/Canada", googleMapsUrl: "https://www.google.com/maps/place/Canada",
    practiceQuestionCount: 4,
  },
  {
    code: "US", name: "United States", officialName: "United States of America", capital: "Washington, D.C.", region: "North America",
    currency: "United States dollar", flag: null, difficulty: "easy",
    codeAlpha3: "USA", borders: [],
    catalogKind: "iso_alpha2", flagEmoji: "🇺🇸", practiceQuestionCount: 1,
  },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openCard = (name: string) => fireEvent.click(screen.getByRole("button", { name: `${name} – show details` }));

it("shows flag cards and opens a detail view with facts, neighbours, links and practice", async () => {
  explore.mockResolvedValue(catalog);
  render(<MemoryRouter><Explorer /></MemoryRouter>);

  expect(await screen.findByText("Showing 1–2 of 2 places")).toBeInTheDocument();
  expect(screen.getByText("Ottawa")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  openCard("Canada");
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Canada");
  expect(screen.getByText("Practice this place")).toBeInTheDocument();
  expect(screen.getByText("9,984,670 km²")).toBeInTheDocument();
  expect(screen.getByText("40,000,000")).toBeInTheDocument();
  expect(screen.getByText("UN member")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open in Google Maps/ })).toHaveAttribute("href", "https://www.google.com/maps/place/Canada");
  expect(screen.getByText(/not been independently verified/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Flags of North America" })).toHaveAttribute("href", "/flags?mode=flag_to_country&region=North%20America");

  fireEvent.click(screen.getByRole("button", { name: "Show United States (USA)" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("United States of America");
  expect(screen.getByText(/Practice needs 4 published questions/)).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  const sortRegion = screen.getByRole("button", { name: "Sort by region" });
  fireEvent.click(sortRegion);
  expect(sortRegion).toHaveAttribute("aria-pressed", "true");
});

it("keeps every catalog entry searchable and gives only the first visible flag high priority", async () => {
  explore.mockResolvedValue(catalog);
  render(<MemoryRouter><Explorer /></MemoryRouter>);

  const firstFlag = await screen.findByAltText("Flag of Canada");
  expect(firstFlag).toHaveAttribute("loading", "eager");
  expect(firstFlag).toHaveAttribute("fetchpriority", "high");
  const search = screen.getByPlaceholderText("Try Canada, Ottawa, or CA…");
  fireEvent.change(search, { target: { value: "washington" } });
  await waitFor(() => expect(screen.getByText("Showing 1–1 of 1 places")).toBeInTheDocument());
  expect(screen.getByText("United States")).toBeInTheDocument();
});

it("resolves neighbour codes from the full catalog and steps through places", async () => {
  const fullCatalog = [
    { ...catalog[0], borders: ["FRA", "ZZZ"] },
    ...Array.from({ length: 23 }, (_, index): ExplorerCountry => ({
      code: `X${String(index).padStart(2, "0")}`, codeAlpha3: `X${String(index).padStart(2, "0")}X`,
      name: `Catalog entry ${String(index).padStart(2, "0")}`, officialName: "Catalog entry",
      capital: null, region: "Test region", currency: null, flag: null, difficulty: "easy",
    })),
    { ...catalog[1], code: "FR", codeAlpha3: "FRA", name: "France", officialName: "French Republic", borders: null },
  ];
  explore.mockResolvedValue(fullCatalog);
  render(<MemoryRouter initialEntries={["/explorer"]}><Explorer /></MemoryRouter>);

  expect(await screen.findByText("Showing 1–24 of 25 places")).toBeInTheDocument();
  openCard("Canada");
  expect(screen.getByText("ZZZ")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show France (FRA)" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("French Republic");
  expect(screen.getByText("Border data not available")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Previous place" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Catalog entry 22");
});

it("uses q and place on direct open and distinguishes missing border data from no land borders", async () => {
  explore.mockResolvedValue([
    { ...catalog[0], codeAlpha3: "CAN", borders: null },
    { ...catalog[1], code: "FR", codeAlpha3: "FRA", name: "France", borders: [] },
  ]);
  render(<MemoryRouter initialEntries={["/explorer?q=FR&place=FR"]}><Explorer /></MemoryRouter>);

  expect(await screen.findByText("Showing 1–1 of 1 places")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Try Canada, Ottawa, or CA…")).toHaveValue("FR");
  expect(screen.getByRole("dialog")).toHaveTextContent("France");
  expect(screen.getByText("No land borders")).toBeInTheDocument();
});

it("shows recognized country names for known Alpha-3 codes missing from the catalog", async () => {
  explore.mockResolvedValue([{
    ...catalog[0], codeAlpha3: "AFG", borders: ["IRN", "PAK", "TKM", "UZB", "TJK", "CHN"],
  }]);
  render(<MemoryRouter><Explorer /></MemoryRouter>);
  expect(await screen.findByText("Showing 1–1 of 1 places")).toBeInTheDocument();
  openCard("Canada");
  for (const neighbor of ["Iran (IRN)", "Pakistan (PAK)", "Turkmenistan (TKM)", "Uzbekistan (UZB)", "Tajikistan (TJK)", "China (CHN)"]) {
    expect(screen.getByText(neighbor)).toBeInTheDocument();
  }
});
