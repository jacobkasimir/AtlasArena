import json
from collections import Counter
from pathlib import Path

files = sorted(Path("country-import/input").glob("*.json"))
if len(files) != 11:
    raise SystemExit(f"11 JSON-Dateien erwartet, gefunden: {len(files)}")

codes = []
shapes = Counter()

for file in files:
    payload = json.loads(file.read_text(encoding="utf-8-sig"))
    data = payload.get("data")
    items = data.get("objects") if isinstance(data, dict) else None

    if not isinstance(items, list):
        raise SystemExit(f"{file.name}: data.objects ist keine Liste")

    print(f"{file.name}: {len(items)} Einträge")

    for item in items:
        if not isinstance(item, dict):
            raise SystemExit(f"{file.name}: Eintrag ist kein Objekt")

        code = item.get("codes", {}).get("alpha_2")
        if code:
            codes.append(code)

        for field in ("currencies", "capitals", "languages", "names", "links"):
            shapes[(field, type(item.get(field)).__name__)] += 1

counts = Counter(codes)
print("\nEinträge insgesamt:", len(codes))
print("Eindeutige Alpha-2-Codes:", len(counts))
print("Doppelte Codes:", sum(n - 1 for n in counts.values()))
print("\nTatsächliche Feldformate:")
for (field, kind), count in sorted(shapes.items()):
    print(f"  {field}: {kind} ({count})")