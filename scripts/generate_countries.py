import json
import os
import tempfile
from getpass import getpass
from pathlib import Path

import requests

URL = "https://api.restcountries.com/countries/v5?limit=25&offset=250"
OUTPUT = Path("rest-countries-v5_11.json")

api_key = getpass("Neuer REST-Countries-API-Key: ").strip()
if not api_key:
    raise SystemExit("Kein API-Key eingegeben.")

try:
    response = requests.get(
        URL,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
except requests.RequestException as error:
    raise SystemExit(f"API-Anfrage fehlgeschlagen: {error}") from None
except ValueError:
    raise SystemExit("Die API hat kein gültiges JSON zurückgegeben.") from None

if not isinstance(payload, dict):
    raise SystemExit(
        f"Unerwartetes Antwortformat: {type(payload).__name__}"
    )

data = payload.get("data")
objects = data.get("objects") if isinstance(data, dict) else None

if not isinstance(objects, list):
    print("Schlüssel der Antwort:", list(payload))
    print("Schlüssel unter data:", list(data) if isinstance(data, dict) else "kein Objekt")
    raise SystemExit("Erwartete Liste unter data.objects nicht gefunden.")

if any(not isinstance(item, dict) for item in objects):
    raise SystemExit("Mindestens ein Ländereintrag ist kein JSON-Objekt.")

print(f"Diese Antwort enthält {len(objects)} Einträge.")
print("Schlüssel unter data:", list(data))



# Erst nach erfolgreicher Prüfung die Datei vollständig schreiben.
with tempfile.NamedTemporaryFile(
    mode="w",
    encoding="utf-8",
    dir=".",
    prefix=".countries-",
    suffix=".json",
    delete=False,
) as temporary:
    json.dump(payload, temporary, ensure_ascii=False, indent=2)
    temporary.write("\n")
    temporary_name = temporary.name

os.replace(temporary_name, OUTPUT)
print(f"Gespeichert: {OUTPUT.resolve()}")