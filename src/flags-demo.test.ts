import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flagsDemo } from "./flags-demo";

const uuid=()=>crypto.randomUUID();
beforeEach(()=>localStorage.removeItem("atlas-flags-demo-v1"));
afterEach(()=>vi.useRealTimers());

describe("Flags local learning flow",()=>{
  it("filters the catalog by region and the Easy flags difficulty rule",async()=>{
    const setup=await flagsDemo.setup();
    expect(setup.summary.easyCount).toBe(12);
    expect(setup.regions.find(r=>r.name==="Europe")?.easyCount).toBe(4);
    const europe=await flagsDemo.start("country_to_flag","Europe","easy",uuid());
    expect(europe.total).toBe(4);
    expect(europe.entries.every(e=>e.region==="Europe")).toBe(true);
  });

  it.each([[0,100],[1,60],[2,30]])("awards the correct %i attempt value",async(wrongs,points)=>{
    const s=await flagsDemo.start("country_to_flag",null,"easy",uuid());
    const e=s.current!;const distractors=e.choices!.filter(c=>c.id!==e.id);
    for(let i=0;i<wrongs;i++){
      const result=await flagsDemo.answer(s.id,e.id,distractors[i].id,null,uuid());
      expect(result.current?.outcome).toBe("pending");
    }
    const result=await flagsDemo.answer(s.id,e.id,e.id,null,uuid());
    expect(result.current?.outcome).toBe("correct");
    expect(result.current?.points).toBe(points);
    expect(result.score).toBe(points);
  });

  it("does not count a repeated wrong flag twice and finalizes on the third distinct miss",async()=>{
    const s=await flagsDemo.start("country_to_flag",null,"easy",uuid());const e=s.current!;
    const wrong=e.choices!.filter(c=>c.id!==e.id).map(c=>c.id);
    const one=await flagsDemo.answer(s.id,e.id,wrong[0],null,uuid());
    const duplicate=await flagsDemo.answer(s.id,e.id,wrong[0],null,uuid());
    expect(duplicate.current?.attempts).toBe(one.current?.attempts);
    expect(duplicate.actionResult?.outcome).toBe("duplicate_choice");
    await flagsDemo.answer(s.id,e.id,wrong[1],null,uuid());
    const done=await flagsDemo.answer(s.id,e.id,wrong[2],null,uuid());
    expect(done.current?.outcome).toBe("incorrect");
    expect(done.current?.correctChoiceId).toBe(e.id);
    expect(done.score).toBe(0);
  });

  it("accepts normalized names and alpha-2 codes, and records hint/skip without points",async()=>{
    const s=await flagsDemo.start("flag_to_country",null,"easy",uuid());const e=s.current!;
    const answer=await flagsDemo.answer(s.id,e.id,e.id,"  "+e.id.toLowerCase()+"  ",uuid());
    expect(answer.current?.outcome).toBe("correct");
    expect(answer.current?.points).toBe(100);

    const hinted=await flagsDemo.start("flag_to_country",null,"easy",uuid());const target=hinted.current!;
    const hint=await flagsDemo.hint(hinted.id,target.id,uuid());
    const repeat=await flagsDemo.hint(hinted.id,target.id,uuid());
    expect(hint.hintsUsed).toBe(1);expect(repeat.hintsUsed).toBe(1);
    const skipped=await flagsDemo.skip(hinted.id,target.id,uuid());
    expect(skipped.current?.outcome).toBe("skipped");expect(skipped.score).toBe(0);
  });

  it("keeps full ties out of new-personal-best badges and compares the same direction and pool",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-09T12:00:00.000Z"));
    async function finish(direction:"country_to_flag"|"flag_to_country"){
      let s=await flagsDemo.start(direction,"Europe","easy",uuid());
      for(let i=0;i<s.total;i++){
        const entry=s.current!;
        if(direction==="flag_to_country")await flagsDemo.skip(s.id,entry.id,uuid());
        else for(const wrong of entry.choices!.filter(choice=>choice.id!==entry.id).slice(0,3))await flagsDemo.answer(s.id,entry.id,wrong.id,null,uuid());
        if(i<s.total-1)s=await flagsDemo.next(s.id,uuid());
      }
      return flagsDemo.next(s.id,uuid());
    }
    let first=await flagsDemo.start("flag_to_country","Europe","easy",uuid());
    for(let i=0;i<first.total;i++){
      await flagsDemo.skip(first.id,first.current!.id,uuid());
      if(i<first.total-1)first=await flagsDemo.next(first.id,uuid());
    }
    vi.setSystemTime(new Date(Date.now()+100));
    const firstResult=await flagsDemo.next(first.id,uuid());
    expect(firstResult.finalBadge).toBe("first_run");

    vi.setSystemTime(new Date(Date.now()+1000));
    let second=await flagsDemo.start("flag_to_country","Europe","easy",uuid());
    for(let i=0;i<second.total;i++){
      await flagsDemo.skip(second.id,second.current!.id,uuid());
      if(i<second.total-1)second=await flagsDemo.next(second.id,uuid());
    }
    vi.setSystemTime(new Date(Date.now()+100));
    const tie=await flagsDemo.next(second.id,uuid());
    expect(tie.finalBadge).toBe("not_best");
    expect(tie.topFive).toHaveLength(2);
    const differentDirection=await finish("country_to_flag");
    expect(differentDirection.finalBadge).toBe("first_run");
  });
});
