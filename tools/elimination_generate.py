# Offline generator for the Category Elimination puzzles. Export the facts with tools/elimination_facts.sql
# (as a JSON object code -> facts into facts.json), then run: python3 tools/elimination_generate.py
"""Generate Category Elimination puzzles from the country facts.

A chain is a list of clues. Step k accepts any place (in the pool) that matches clues[0..k];
the last clue leaves exactly one place. Counts must shrink at every step.
"""
import json, random, sys

facts = json.load(open("facts.json"))
MEMBERSHIPS = ["eu", "nato", "commonwealth", "g20", "au", "arab", "asean", "opec", "oecd", "schengen", "eurozone"]
for code, f in facts.items():
    f["capsame"] = f["first"] != "" and f["first"] == f["capfirst"]
    f["playable"] = f["pop"] > 0 and f["capfirst"] != ""
    for k in MEMBERSHIPS:  # territories inherit odd flags (e.g. Guadeloupe = EU); only UN members count
        f[k] = bool(f[k] and f["un"])
LETTER_FAMILIES = {"first", "last", "len", "words", "capsame"}
REFS = {"IE": "Ireland", "CH": "Switzerland", "PT": "Portugal", "GB": "the United Kingdom", "JP": "Japan",
        "EG": "Egypt", "AR": "Argentina", "NZ": "New Zealand", "PL": "Poland"}

REGIONS = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"]
VOWELS = list("aeiou")
BIG_NEIGHBOURS = {"RUS": "Russia", "CHN": "China", "IND": "India", "BRA": "Brazil", "FRA": "France", "DEU": "Germany",
                  "ZAF": "South Africa", "ARG": "Argentina", "TUR": "Türkiye", "SAU": "Saudi Arabia", "AUT": "Austria",
                  "COD": "DR Congo", "TZA": "Tanzania", "IRN": "Iran", "SRB": "Serbia", "ESP": "Spain"}


def fmt(n):
    if n >= 1_000_000:
        v = n / 1_000_000
        return f"{v:g} million"
    return f"{n:,}"


def clue(field, op, value, label, level, family=None):
    return {"f": field, "op": op, "v": value, "label": label, "level": level, "family": family or field}


def library():
    L = []
    for r in REGIONS:
        L.append(clue("region", "eq", r, f"In {r}", 1))
    L.append(clue("region", "in", ["Europe", "Asia"], "In Europe or Asia", 1))
    L.append(clue("region", "in", ["North America", "South America"], "In the Americas", 1))
    for n in [1_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000]:
        L.append(clue("pop", "gt", n, f"More than {fmt(n)} people", 1, "pop"))
        L.append(clue("pop", "lt", n, f"Fewer than {fmt(n)} people", 1, "pop"))
    for n in [10_000, 50_000, 100_000, 300_000, 500_000, 1_000_000]:
        L.append(clue("area", "gt", n, f"Larger than {fmt(n)} km²", 1, "area"))
        L.append(clue("area", "lt", n, f"Smaller than {fmt(n)} km²", 1, "area"))
    L.append(clue("landlocked", "true", None, "Landlocked", 1))
    L.append(clue("landlocked", "false", None, "Has a coastline", 1))
    L.append(clue("island", "true", None, "No land borders", 1))
    L.append(clue("island", "false", None, "Has at least one land border", 1))
    for ch in "abcdefghijklmnopqrstuvwxyz":
        L.append(clue("first", "eq", ch, f"Name starts with {ch.upper()}", 1, "first"))
    L.append(clue("first", "in", VOWELS, "Name starts with a vowel", 1, "first"))
    L.append(clue("first", "nin", VOWELS, "Name starts with a consonant", 1, "first"))
    for ch in "aeinodsluy":
        L.append(clue("last", "eq", ch, f"Name ends with {ch.upper()}", 1, "last"))
    L.append(clue("len", "lt", 6, "Name has 5 letters or fewer", 1))
    L.append(clue("len", "gt", 8, "Name has 9 letters or more", 1))
    L.append(clue("words", "gt", 1, "Name has more than one word", 1))
    L.append(clue("lat", "lt", 0, "Capital south of the equator", 1))
    L.append(clue("lat", "gt", 0, "Capital north of the equator", 1))
    L.append(clue("lng", "lt", 0, "Capital west of Greenwich (0°)", 1))
    L.append(clue("lng", "gt", 0, "Capital east of Greenwich (0°)", 1))
    L.append(clue("neighbours", "gt", 4, "More than 4 land neighbours", 1))
    L.append(clue("neighbours", "eq", 1, "Exactly one land neighbour", 1))
    L.append(clue("neighbours", "lt", 3, "Fewer than 3 land neighbours", 1))
    # Medium
    L.append(clue("drive", "eq", "left", "Drives on the left", 2))
    L.append(clue("drive", "eq", "right", "Drives on the right", 2))
    for key, name in [("eu", "the EU"), ("nato", "NATO"), ("commonwealth", "the Commonwealth"), ("g20", "the G20"),
                      ("au", "the African Union"), ("arab", "the Arab League"), ("asean", "ASEAN"), ("opec", "OPEC"),
                      ("oecd", "the OECD")]:
        L.append(clue(key, "true", None, f"Member of {name}", 2))
        L.append(clue(key, "false", None, f"Not a member of {name}", 2))
    L.append(clue("eurozone", "true", None, "Uses the euro", 2, "currencies"))
    for lang in ["English", "French", "Spanish", "Arabic", "Portuguese"]:
        L.append(clue("langs", "has", lang, f"{lang} is an official language", 2, "langs"))
    L.append(clue("currencies", "has", "USD", "Uses the US dollar", 2))
    L.append(clue("monarchy", "true", None, "A monarchy", 2))
    L.append(clue("monarchy", "false", None, "Not a monarchy", 2))
    for code, name in BIG_NEIGHBOURS.items():
        L.append(clue("borders", "has", code, f"Borders {name}", 2, "borders"))
    L.append(clue("lat", "gt", 40, "Capital north of 40° N", 2, "lat"))
    L.append(clue("lat", "lt", -20, "Capital south of 20° S", 2, "lat"))
    # Hard
    for code, name in REFS.items():
        r = facts[code]
        L.append(clue("pop", "lt", r["pop"], f"Fewer people than {name}", 2, "pop"))
        L.append(clue("pop", "gt", r["pop"], f"More people than {name}", 2, "pop"))
        L.append(clue("area", "lt", float(r["area"]), f"Smaller than {name}", 2, "area"))
        L.append(clue("area", "gt", float(r["area"]), f"Larger than {name}", 2, "area"))
    L.append(clue("tz", "gt", 1, "Spans more than one time zone", 3))
    L.append(clue("density", "gt", 300, "More than 300 people per km²", 3, "density"))
    L.append(clue("density", "lt", 20, "Fewer than 20 people per km²", 3, "density"))
    L.append(clue("capsame", "true", None, "Capital starts with the same letter as the country", 3))
    L.append(clue("pop", "lt", 100_000, "Fewer than 100,000 people", 3, "pop"))
    L.append(clue("area", "lt", 1_000, "Smaller than 1,000 km²", 3, "area"))
    L.append(clue("un", "false", None, "Not a UN member state", 3))
    L.append(clue("un", "true", None, "A UN member state", 3))
    L.append(clue("lat", "gt", 55, "Capital north of 55° N", 3, "lat"))
    L.append(clue("lng", "gt", 100, "Capital east of 100° E", 3, "lng"))
    L.append(clue("lng", "lt", -100, "Capital west of 100° W", 3, "lng"))
    subs = sorted({f["subregion"] for f in facts.values() if f["subregion"]})
    for s in subs:
        L.append(clue("subregion", "eq", s, f"In {s}", 3, "region"))
    return L


def test(f, c):
    v = f.get(c["f"])
    op = c["op"]
    if op == "eq": return v == c["v"]
    if op == "in": return v in c["v"]
    if op == "nin": return v not in c["v"]
    if op == "lt": return v is not None and float(v) < c["v"]
    if op == "gt": return v is not None and float(v) > c["v"]
    if op == "has": return c["v"] in (v or [])
    if op == "true": return v is True
    if op == "false": return v is False
    raise ValueError(op)


SETTINGS = {
    # pool, max clue level, chain length, first-step minimum, targets
    "easy": dict(un=True, level=1, length=4, first_min=25, penult=(2, 6),
                 target=lambda f: f["un"] and (f["pop"] > 8_000_000 or f["g20"] or f["eu"])),
    "medium": dict(un=True, level=2, length=5, first_min=30, penult=(2, 6),
                   target=lambda f: f["un"] and f["pop"] > 500_000),
    "hard": dict(un=False, level=3, length=5, first_min=40, penult=(2, 5),
                 target=lambda f: True),
}


def build_chain(code, cfg, lib, rng):
    pool = [c for c, f in facts.items() if f["playable"] and (f["un"] or not cfg["un"])]
    t = facts[code]
    cands = [c for c in lib if c["level"] <= cfg["level"] and test(t, c)]
    n = cfg["length"]
    for _ in range(400):
        rng.shuffle(cands)
        chain, remaining, used = [], pool, set()
        ok = True
        for i in range(n):
            last = i == n - 1
            best = None
            for c in cands:
                if c["family"] in used:
                    continue
                if c["family"] in LETTER_FAMILIES and i < n - 2:
                    continue
                if i == 0 and c["op"] == "false":
                    continue
                left = [p for p in remaining if test(facts[p], c)]
                k = len(left)
                if i == 0 and not (cfg["first_min"] <= k <= len(pool) * 0.8): continue
                if i > 0 and k > len(remaining) * 0.75: continue
                if last and k != 1: continue
                if not last and k <= 1: continue
                if i == n - 2 and not (cfg["penult"][0] <= k <= cfg["penult"][1]): continue
                # hard chains should use at least one level-3 clue, medium at least one level-2 clue
                best = (c, left); break
            if not best: ok = False; break
            c, remaining = best
            chain.append(c); used.add(c["family"])
        if ok and remaining == [code]:
            top = max(c["level"] for c in chain)
            if top < cfg["level"]:
                continue
            return chain
    return None


def generate(diff, sets, seed):
    cfg = SETTINGS[diff]
    lib = library()
    rng = random.Random(seed)
    targets = [c for c, f in facts.items() if f["playable"] and cfg["target"](f) and (f["un"] or not cfg["un"])]
    rng.shuffle(targets)
    used, out = set(), []
    colours = ["green", "orange", "blue", "purple"]
    while len(out) < sets:
        groups, regions = [], set()
        for code in targets:
            if code in used: continue
            reg = facts[code]["region"]
            if reg in regions: continue
            ch = build_chain(code, cfg, lib, rng)
            if not ch: used.add(code); continue
            used.add(code); regions.add(reg)
            groups.append({"colour": colours[len(groups)], "answer": code, "clues": ch})
            if len(groups) == 4: break
        if len(groups) < 4: break
        out.append(groups)
    return out


if __name__ == "__main__":
    pool_un = [c for c, f in facts.items() if f["un"]]
    result = {}
    for diff, seed in [("easy", 11), ("medium", 22), ("hard", 33)]:
        sets = generate(diff, 8, seed)
        result[diff] = sets
        print(f"== {diff}: {len(sets)} sets")
        for i, s in enumerate(sets, 1):
            print(f" #{i}")
            for g in s:
                pool = [c for c, f in facts.items() if f["playable"] and (f["un"] or not SETTINGS[diff]["un"])]
                rem = pool; parts = []
                for c in g["clues"]:
                    rem = [p for p in rem if test(facts[p], c)]
                    parts.append(f"{c['label']} ({len(rem)})")
                print(f"   {g['colour']:7} {' → '.join(parts)} = {facts[g['answer']]['name']}")
    json.dump(result, open("puzzles.json", "w"), ensure_ascii=False)
