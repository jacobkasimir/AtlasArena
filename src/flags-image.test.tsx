import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FlagImage } from "./Flags";

it("uses the Explorer SVG first and falls back to PNG and same-origin SVG",()=>{
  const onUnavailable=vi.fn();
  const {container}=render(<FlagImage value={{flagSvgUrl:"https://flags.restcountries.com/us.svg",flagPngUrl:"https://flags.restcountries.com/us.png",flagDescription:null}} label="Flag option 1" onUnavailable={onUnavailable}/>);
  expect(container.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flags.restcountries.com/us.svg");
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flags.restcountries.com/us.png");
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/flags/us.svg");
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByRole("button",{name:"Retry loading Flag option 1"})).toBeTruthy();
  expect(onUnavailable).toHaveBeenCalledWith(true);
});

it("uses the same-origin SVG fallback when the CDN SVG fails",()=>{
  const onUnavailable=vi.fn();
  const {container}=render(<FlagImage value={{flagSvgUrl:"https://flags.restcountries.com/us.svg",flagPngUrl:null,flagDescription:null}} label="country flag" onUnavailable={onUnavailable}/>);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flags.restcountries.com/us.svg");
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/flags/us.svg");
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByRole("button",{name:"Retry loading country flag"})).toBeTruthy();
  expect(onUnavailable).toHaveBeenCalledWith(true);
});
