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
    catalogKind: "iso_alpha2", flagEmoji: "🇺🇸", practiceQuestionCount: 1,
  },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows compact cards, grouped catalog details and navigable neighbors", async () => {
  explore.mockResolvedValue(catalog);
  render(<MemoryRouter><Explorer /></MemoryRouter>);

  expect(await screen.findByText("Showing 1–2 of 2 places")).toBeInTheDocument();
  expect(screen.getByText("Ottawa")).toBeInTheDocument();
  expect(screen.getByText("ISO alpha-2 · CA")).toBeInTheDocument();
  const summary = document.querySelector("details summary")!;
  const countryBlock = document.querySelector("details.country-card")!;
  expect(screen.queryByText(/^Details for/)).not.toBeInTheDocument();
  fireEvent.click(summary);
  expect(countryBlock).toHaveAttribute("open");
  fireEvent.click(summary);
  expect(countryBlock).not.toHaveAttribute("open");
  fireEvent.click(summary);
  expect(screen.getByText("Practice this place")).toBeInTheDocument();

  expect(screen.getAllByText("People and place")).toHaveLength(2);
  expect(screen.getByText("9,984,670 km²")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Find United States in the catalog" })).toHaveAttribute("href", "/explorer?q=US");
  expect(screen.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute("href", "https://www.google.com/maps/place/Canada");
  expect(screen.queryByRole("link", { name: /Imported data source/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(/not been independently verified/)).toHaveLength(2);
  expect(screen.getByText(/Practice needs 4 published questions/)).toBeInTheDocument();
  const sortRegion = screen.getByRole("button", { name: "Sort by region, then name" });
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
