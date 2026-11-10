import { createRef, FormEvent, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CapitalCombobox } from "./Capitals";

it("uses prefix suggestions and Enter selects a candidate without submitting the form", () => {
  const submitted = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  function Fixture() {
    const [value, setValue] = useState("");
    const [candidate, setCandidate] = useState<string | null>(null);
    const submit = (event: FormEvent) => { event.preventDefault(); submitted(); };
    return <form onSubmit={submit}><CapitalCombobox options={[{id:"paris-id",label:"Paris"},{id:"paraguay-id",label:"Paraguay"},{id:"rome-id",label:"Rome"}]} value={value} candidateId={candidate} onChange={next=>{setValue(next);setCandidate(null)}} onSelect={(next,id)=>{setValue(next);setCandidate(id)}} disabled={false} inputRef={inputRef}/><button type="submit">Submit</button></form>;
  }
  render(<Fixture/>);
  const input=screen.getByRole("combobox");
  fireEvent.change(input,{target:{value:"par"}});
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(input,{key:"ArrowDown"});
  fireEvent.keyDown(input,{key:"ArrowDown"});
  fireEvent.keyDown(input,{key:"Enter"});
  expect(input).toHaveValue("Paris");
  expect(submitted).not.toHaveBeenCalled();
  expect(input).toHaveAttribute("aria-expanded","false");
});
