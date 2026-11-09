import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FlagImage } from "./Flags";

it("falls back to the catalog emoji when an image request fails",()=>{
  const onUnavailable=vi.fn();
  const {container}=render(<FlagImage value={{flagSvgUrl:"https://flags.restcountries.com/us.svg",flagPngUrl:null,flagEmoji:"🇺🇸",flagDescription:null}} label="Flag option 1" onUnavailable={onUnavailable}/>);
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByText("🇺🇸")).toBeTruthy();
  expect(onUnavailable).toHaveBeenCalledWith(false);
});

it("offers retry and reports a missing image when no fallback exists",()=>{
  const onUnavailable=vi.fn();
  const {container}=render(<FlagImage value={{flagSvgUrl:"https://flags.restcountries.com/us.svg",flagPngUrl:null,flagEmoji:null,flagDescription:null}} label="country flag" onUnavailable={onUnavailable}/>);
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByRole("button",{name:"Retry loading country flag"})).toBeTruthy();
  expect(onUnavailable).toHaveBeenCalledWith(true);
});
