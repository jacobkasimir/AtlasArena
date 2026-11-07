import json
from datetime import date
from pathlib import Path

source = Path("sdn.json")
target = Path("atlas-questions-publish.json")

questions = json.loads(source.read_text(encoding="utf-8"))

if not isinstance(questions, list) or not questions:
    raise SystemExit("Die Eingabedatei muss ein nichtleeres JSON-Array sein.")

print(f"{len(questions)} Fragen gefunden.")
print("Bitte bestätige erst nach Prüfung ALLER Antworten, Erklärungen und URLs.")
confirmation = input("Quellen tatsächlich geprüft? Tippe PUBLISH zur Bestätigung: ")

if confirmation != "PUBLISH":
    raise SystemExit("Abgebrochen; es wurde keine Veröffentlichungsdatei erzeugt.")

today = date.today().isoformat()

for question in questions:
    question["sourceVerified"] = True
    question["reviewStatus"] = "reviewed"
    question["lastReviewed"] = today
    question["referenceYear"] = 2025

target.write_text(
    json.dumps(questions, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

print(f"Erstellt: {target} mit lastReviewed={today}")