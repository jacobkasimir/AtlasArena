#!/usr/bin/env python3
"""Import selected REST Countries v5 fields into private.countries.

Default: validate local JSON files only; no database connection.
--apply: back up existing country rows, then perform a transactional upsert.
--skip-unkeyed: explicitly exclude records without an ISO alpha-2 code.

No API key is needed: input comes from previously downloaded JSON files.
"""

import argparse
import json
import math
import re
from datetime import date, datetime, timezone
from getpass import getpass
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


INPUT_DIR = Path("country-import/input")
BACKUP_DIR = Path("country-import/backups")
SOURCE_URL = "https://api.restcountries.com/countries/v5"

MEMBERSHIPS = (
    "un",
    "eu",
    "eurozone",
    "schengen",
    "nato",
    "commonwealth",
    "oecd",
    "g7",
    "g20",
    "brics",
    "opec",
    "african_union",
    "asean",
    "arab_league",
)

UNKEYED_ENTITIES = {
    ("rest-countries-v5_01.json", 0): (
        "Abkhazia", "entity:abkhazia"
    ),
    ("rest-countries-v5_07.json", 15): (
        "Northern Cyprus", "entity:northern-cyprus"
    ),
    ("rest-countries-v5_09.json", 6): (
        "Somaliland", "entity:somaliland"
    ),
    ("rest-countries-v5_09.json", 10): (
        "South Ossetia", "entity:south-ossetia"
    ),
}

# Existing columns plus the selected fields discussed for Atlas Arena.
# Other existing columns, including raw_data, are neither modified nor removed.
IMPORT_COLUMNS = (
    "code",
    "catalog_kind",
    "name",
    "capital",
    "region",
    "currency",
    "flag",
    "difficulty",
    "source",
    "name_official",
    "name_alternates",
    "name_native",
    "name_translations",
    "capitals",
    "demonyms",
    "code_alpha3",
    "flag_emoji",
    "flag_png_url",
    "flag_svg_url",
    "subregion",
    "continents",
    "landlocked",
    "borders",
    "area_km2",
    "area_miles",
    "coordinates_lat",
    "coordinates_lng",
    "timezones",
    "population",
    "gini_coefficient",
    "languages",
    "currencies",
    "calling_codes",
    "tlds",
    "cars_driving_side",
    "cars_signs",
    "postal_code_format",
    "postal_code_regex",
    *(f"membership_{name}" for name in MEMBERSHIPS),
    "government_type",
    "link_official",
    "link_wikipedia",
    "link_google_maps",
)

JSON_COLUMNS = {
    "name_native",
    "name_translations",
    "capitals",
    "demonyms",
    "gini_coefficient",
    "languages",
    "currencies",
}

ARRAY_COLUMNS = {
    "name_alternates",
    "continents",
    "borders",
    "timezones",
    "calling_codes",
    "tlds",
    "cars_signs",
}

BOOLEAN_COLUMNS = {
    "landlocked",
    *(f"membership_{name}" for name in MEMBERSHIPS),
}

NUMERIC_COLUMNS = {
    "area_km2",
    "area_miles",
    "coordinates_lat",
    "coordinates_lng",
}


def optional_object(value, label):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{label}: object expected, got {type(value).__name__}")
    return value


def optional_list(value, label):
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError(f"{label}: array expected, got {type(value).__name__}")
    return value


def optional_text(value, label):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label}: string expected, got {type(value).__name__}")
    return value.strip() or None


def required_text(value, label):
    result = optional_text(value, label)
    if result is None:
        raise ValueError(f"{label}: required value is missing")
    return result


def optional_boolean(value, label):
    if value is None:
        return None
    if not isinstance(value, bool):
        raise ValueError(f"{label}: boolean expected")
    return value


def optional_number(value, label):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}: number expected")
    if not math.isfinite(value):
        raise ValueError(f"{label}: number must be finite")
    return value


def optional_url(value, label, allow_http=False):
    result = optional_text(value, label)
    if result is None:
        return None

    parsed = urlparse(result)
    allowed_schemes = {"https", "http"} if allow_http else {"https"}

    if (
        parsed.scheme not in allowed_schemes
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError(
            f"{label}: valid {'HTTP(S)' if allow_http else 'HTTPS'} "
            "URL without embedded credentials expected"
        )

    return result

def string_array(value, label):
    values = optional_list(value, label)
    if values is None:
        return None

    result = []
    for index, item in enumerate(values):
        text = required_text(item, f"{label}[{index}]")
        if text not in result:
            result.append(text)

    return result


def named_objects(value, label):
    values = optional_list(value, label)
    if values is None:
        return None

    for index, item in enumerate(values):
        entry = optional_object(item, f"{label}[{index}]")
        if entry is None:
            raise ValueError(f"{label}[{index}]: object expected")

        required_text(entry.get("name"), f"{label}[{index}].name")

    return values


def joined_names(values, label):
    if values is None:
        return None

    names = []
    for index, entry in enumerate(values):
        name = required_text(entry["name"], f"{label}[{index}].name")
        if name not in names:
            names.append(name)

    return " / ".join(names) if names else None


def atlas_region(region, subregion, code):
    if region == "Americas":
        if subregion == "South America":
            return "South America"

        # Do not silently treat an unknown subregion as North America.
        if subregion in {
            "North America",
            "Northern America",
            "Central America",
            "Caribbean",
        }:
            return "North America"

        raise ValueError(
            f"{code}: unknown Americas subregion {subregion!r}"
        )

    if region in {
        "Africa",
        "Asia",
        "Europe",
        "Oceania",
        "Antarctica",
    }:
        return region

    if region == "Antarctic":
        return "Antarctica"

    raise ValueError(f"{code}: unknown region {region!r}")


def convert_country(code, item):
    names = optional_object(item.get("names"), f"{code}.names") or {}
    flag = optional_object(item.get("flag"), f"{code}.flag") or {}
    area = optional_object(item.get("area"), f"{code}.area") or {}
    coordinates = (
        optional_object(item.get("coordinates"), f"{code}.coordinates") or {}
    )
    economy = optional_object(item.get("economy"), f"{code}.economy") or {}
    cars = optional_object(item.get("cars"), f"{code}.cars") or {}
    postal = (
        optional_object(item.get("postal_code"), f"{code}.postal_code") or {}
    )
    links = optional_object(item.get("links"), f"{code}.links") or {}
    memberships = (
        optional_object(item.get("memberships"), f"{code}.memberships") or {}
    )

    region = required_text(item.get("region"), f"{code}.region")
    subregion = optional_text(item.get("subregion"), f"{code}.subregion")

    capitals = named_objects(item.get("capitals"), f"{code}.capitals")
    currencies = named_objects(item.get("currencies"), f"{code}.currencies")
    languages = optional_list(item.get("languages"), f"{code}.languages")

    if languages is not None:
        for index, language in enumerate(languages):
            if not isinstance(language, dict):
                raise ValueError(
                    f"{code}.languages[{index}]: object expected"
                )

    population = item.get("population")
    if population is not None and (
        isinstance(population, bool)
        or not isinstance(population, int)
        or population < 0
    ):
        raise ValueError(f"{code}.population: nonnegative integer expected")

    row = {
        "code": code,
        "name": required_text(names.get("common"), f"{code}.names.common"),
        "capital": joined_names(capitals, f"{code}.capitals"),
        "region": atlas_region(region, subregion, code),
        "currency": joined_names(currencies, f"{code}.currencies"),
        "flag": optional_text(
            flag.get("description"), f"{code}.flag.description"
        ),
        # Only used when INSERTING a new country.
        # Existing editorial difficulty remains unchanged.
        "difficulty": "medium",
        "source": SOURCE_URL,
        "name_official": optional_text(
            names.get("official"), f"{code}.names.official"
        ),
        "name_alternates": string_array(
            names.get("alternates"), f"{code}.names.alternates"
        ),
        "name_native": optional_object(
            names.get("native"), f"{code}.names.native"
        ),
        "name_translations": optional_object(
            names.get("translations"), f"{code}.names.translations"
        ),
        "capitals": capitals,
        "demonyms": optional_object(
            item.get("demonyms"), f"{code}.demonyms"
        ),
        "code_alpha3": optional_text(
            (optional_object(item.get("codes"), f"{code}.codes") or {})
            .get("alpha_3"),
            f"{code}.codes.alpha_3",
        ),
        "flag_emoji": optional_text(
            flag.get("emoji"), f"{code}.flag.emoji"
        ),
        "flag_png_url": optional_url(
            flag.get("url_png"), f"{code}.flag.url_png"
        ),
        "flag_svg_url": optional_url(
            flag.get("url_svg"), f"{code}.flag.url_svg"
        ),
        "subregion": subregion,
        "continents": string_array(
            item.get("continents"), f"{code}.continents"
        ),
        "landlocked": optional_boolean(
            item.get("landlocked"), f"{code}.landlocked"
        ),
        "borders": string_array(
            item.get("borders"), f"{code}.borders"
        ),
        "area_km2": optional_number(
            area.get("kilometers"), f"{code}.area.kilometers"
        ),
        "area_miles": optional_number(
            area.get("miles"), f"{code}.area.miles"
        ),
        "coordinates_lat": optional_number(
            coordinates.get("lat"), f"{code}.coordinates.lat"
        ),
        "coordinates_lng": optional_number(
            coordinates.get("lng"), f"{code}.coordinates.lng"
        ),
        "timezones": string_array(
            item.get("timezones"), f"{code}.timezones"
        ),
        "population": population,
        "gini_coefficient": optional_object(
            economy.get("gini_coefficient"),
            f"{code}.economy.gini_coefficient",
        ),
        "languages": languages,
        "currencies": currencies,
        "calling_codes": string_array(
            item.get("calling_codes"), f"{code}.calling_codes"
        ),
        "tlds": string_array(item.get("tlds"), f"{code}.tlds"),
        "cars_driving_side": optional_text(
            cars.get("driving_side"), f"{code}.cars.driving_side"
        ),
        "cars_signs": string_array(
            cars.get("signs"), f"{code}.cars.signs"
        ),
        "postal_code_format": optional_text(
            postal.get("format"), f"{code}.postal_code.format"
        ),
        "postal_code_regex": optional_text(
            postal.get("regex"), f"{code}.postal_code.regex"
        ),
        "government_type": optional_text(
            item.get("government_type"), f"{code}.government_type"
        ),
        "link_official": optional_url(
            links.get("official"), f"{code}.links.official", allow_http=True
        ),
        "link_wikipedia": optional_url(
            links.get("wikipedia"), f"{code}.links.wikipedia"
        ),
        "link_google_maps": optional_url(
            links.get("google_maps"), f"{code}.links.google_maps"
        ),
    }

    for name in MEMBERSHIPS:
        row[f"membership_{name}"] = optional_boolean(
            memberships.get(name),
            f"{code}.memberships.{name}",
        )

    return row

"""
def load_pages(skip_unkeyed):
    files = sorted(INPUT_DIR.glob("*.json"))

    if len(files) != 11:
        raise ValueError(
            f"Expected 11 JSON files in {INPUT_DIR}; found {len(files)}"
        )

    records = {}
    unkeyed = []
    raw_count = 0

    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))

        if not isinstance(payload, dict) or payload.get("success") is False:
            raise ValueError(f"{path.name}: invalid API response")

        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValueError(f"{path.name}: data is not an object")

        objects = data.get("objects")
        if not isinstance(objects, list) or not objects:
            raise ValueError(f"{path.name}: data.objects is not a nonempty array")

        for index, item in enumerate(objects):
            raw_count += 1

            if not isinstance(item, dict):
                raise ValueError(f"{path.name}[{index}]: object expected")

            codes = item.get("codes")
            if codes is not None and not isinstance(codes, dict):
                raise ValueError(f"{path.name}[{index}].codes: object expected")

            raw_code = codes.get("alpha_2") if codes else None
            code = raw_code.strip().upper() if isinstance(raw_code, str) else ""

            if not re.fullmatch(r"[A-Z]{2}", code):
                display_name = (
                    item.get("names", {}).get("common")
                    if isinstance(item.get("names"), dict)
                    else None
                )
                unkeyed.append({
                    "file": path.name,
                    "index": index,
                    "name": display_name,
                    "alpha_2": raw_code,
                })
                continue

            if code in records:
                if records[code] != item:
                    raise ValueError(
                        f"{code}: conflicting records across JSON files"
                    )
                raise ValueError(
                    f"{code}: duplicate record across JSON files"
                )

            records[code] = item

    print(f"Files: {len(files)}")
    print(f"Raw entries: {raw_count}")
    print(f"Valid, distinct alpha-2 codes: {len(records)}")
    print(f"Entries without a usable alpha-2 code: {len(unkeyed)}")

    if unkeyed:
        print("\nUnkeyed entries:")
        for entry in unkeyed:
            print(
                f"  {entry['file']}[{entry['index']}]: "
                f"{entry['name']!r}; alpha_2={entry['alpha_2']!r}"
            )

        if not skip_unkeyed:
            raise ValueError(
                "Unkeyed entries require review. Re-run with "
                "--skip-unkeyed only if excluding them is intended."
            )

    if len(records) != 250:
        raise ValueError(
            f"Expected your previously counted 250 distinct codes; "
            f"found {len(records)}. Check pagination and files."
        )

    rows = [convert_country(code, records[code]) for code in sorted(records)]
    return rows
"""
def load_pages(skip_unkeyed=False, include_unkeyed=False):
    if skip_unkeyed and include_unkeyed:
        raise ValueError(
            "--skip-unkeyed und --include-unkeyed dürfen "
            "nicht gleichzeitig verwendet werden."
        )

    # Schlüssel: (Dateiname, Position innerhalb data.objects)
    # Wert: (erwarteter Name, interne Atlas-Arena-ID)
    #
    # Diese IDs sind ausdrücklich KEINE ISO-Ländercodes.
    allowed_unkeyed = {
        ("rest-countries-v5_01.json", 0): (
            "Abkhazia",
            "entity:abkhazia",
        ),
        ("rest-countries-v5_07.json", 15): (
            "Northern Cyprus",
            "entity:northern-cyprus",
        ),
        ("rest-countries-v5_09.json", 6): (
            "Somaliland",
            "entity:somaliland",
        ),
        ("rest-countries-v5_09.json", 10): (
            "South Ossetia",
            "entity:south-ossetia",
        ),
    }

    files = sorted(INPUT_DIR.glob("*.json"))

    if len(files) != 11:
        raise ValueError(
            f"Expected 11 JSON files in {INPUT_DIR}; "
            f"found {len(files)}"
        )

    iso_records = {}
    non_iso_records = {}
    unkeyed = []
    raw_count = 0

    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))

        if not isinstance(payload, dict):
            raise ValueError(
                f"{path.name}: API response must be an object"
            )

        if payload.get("success") is False:
            raise ValueError(
                f"{path.name}: API error response instead of country data"
            )

        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValueError(f"{path.name}: data is not an object")

        objects = data.get("objects")
        if not isinstance(objects, list) or not objects:
            raise ValueError(
                f"{path.name}: data.objects must be a nonempty array"
            )

        for index, item in enumerate(objects):
            raw_count += 1

            if not isinstance(item, dict):
                raise ValueError(
                    f"{path.name}[{index}]: country must be an object"
                )

            codes = item.get("codes")
            if codes is not None and not isinstance(codes, dict):
                raise ValueError(
                    f"{path.name}[{index}].codes: object expected"
                )

            raw_code = codes.get("alpha_2") if codes else None

            if raw_code is not None and not isinstance(raw_code, str):
                raise ValueError(
                    f"{path.name}[{index}].codes.alpha_2: "
                    "string or null expected"
                )

            code = raw_code.strip().upper() if raw_code else ""

            if re.fullmatch(r"[A-Z]{2}", code):
                if code in iso_records:
                    raise ValueError(
                        f"{code}: duplicate ISO entry in the JSON files"
                    )

                iso_records[code] = item
                continue

            # Ein nichtleerer, aber ungültiger ISO-Code wird niemals
            # als "ohne Code" behandelt.
            if code:
                raise ValueError(
                    f"{path.name}[{index}]: invalid alpha_2 "
                    f"code {code!r}"
                )

            names = item.get("names")
            if not isinstance(names, dict):
                raise ValueError(
                    f"{path.name}[{index}].names: object expected"
                )

            name = names.get("common")
            if not isinstance(name, str):
                raise ValueError(
                    f"{path.name}[{index}].names.common: "
                    "string expected"
                )

            location = (path.name, index)
            unkeyed.append({
                "file": path.name,
                "index": index,
                "name": name,
            })

            if include_unkeyed:
                approved = allowed_unkeyed.get(location)

                if approved is None:
                    raise ValueError(
                        f"{path.name}[{index}]: unexpected entry "
                        "without an alpha-2 code"
                    )

                expected_name, internal_id = approved

                if name != expected_name:
                    raise ValueError(
                        f"{path.name}[{index}]: expected "
                        f"{expected_name!r}, found {name!r}. "
                        "Review the JSON files before importing."
                    )

                if internal_id in non_iso_records:
                    raise ValueError(
                        f"Duplicate internal ID: {internal_id}"
                    )

                non_iso_records[internal_id] = item

    print(f"Files: {len(files)}")
    print(f"Raw entries: {raw_count}")
    print(f"Valid, distinct alpha-2 codes: {len(iso_records)}")
    print(f"Entries without an alpha-2 code: {len(unkeyed)}")

    if unkeyed:
        print("\nEntries without an alpha-2 code:")
        for entry in unkeyed:
            print(
                f"  {entry['file']}[{entry['index']}]: "
                f"{entry['name']!r}"
            )

    if raw_count != 254 or len(iso_records) != 250 or len(unkeyed) != 4:
        raise ValueError(
            "The input no longer matches the previously reviewed "
            "254-entry export. Check the files before importing."
        )

    if include_unkeyed:
        expected_locations = set(allowed_unkeyed)
        found_locations = {
            (entry["file"], entry["index"])
            for entry in unkeyed
        }

        if found_locations != expected_locations:
            raise ValueError(
                "The four unkeyed entries differ from the "
                "approved file positions."
            )

        if len(non_iso_records) != 4:
            raise ValueError(
                "Expected exactly four approved non-ISO entries."
            )

    elif unkeyed and not skip_unkeyed:
        raise ValueError(
            "Entries without alpha-2 codes require review. "
            "Use --include-unkeyed to import the four explicitly "
            "approved entries, or --skip-unkeyed to omit them."
        )

    rows = []

    for code, item in sorted(iso_records.items()):
        row = convert_country(code, item)
        row["catalog_kind"] = "iso_alpha2"
        rows.append(row)

    if include_unkeyed:
        for internal_id, item in sorted(non_iso_records.items()):
            row = convert_country(internal_id, item)
            row["catalog_kind"] = "non_iso"
            rows.append(row)

    expected_rows = 254 if include_unkeyed else 250

    if len(rows) != expected_rows:
        raise ValueError(
            f"Expected {expected_rows} converted records; "
            f"got {len(rows)}"
        )

    print(f"Records prepared for import: {len(rows)}")
    return rows

def check_database(cursor):
    cursor.execute(
        """
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'private'
          and table_name = 'countries'
        """
    )
    found = {
        entry["column_name"]: entry["data_type"]
        for entry in cursor.fetchall()
    }

    missing = set(IMPORT_COLUMNS) - set(found)
    if missing:
        raise ValueError(
            "Database columns missing: " + ", ".join(sorted(missing))
        )

    for column in JSON_COLUMNS:
        if found[column] != "jsonb":
            raise ValueError(f"{column}: expected database type jsonb")

    for column in ARRAY_COLUMNS:
        if found[column] != "ARRAY":
            raise ValueError(f"{column}: expected database array type")

    for column in BOOLEAN_COLUMNS:
        if found[column] != "boolean":
            raise ValueError(f"{column}: expected database type boolean")

    for column in NUMERIC_COLUMNS:
        if found[column] != "numeric":
            raise ValueError(f"{column}: expected database type numeric")

    if found["population"] != "bigint":
        raise ValueError("population: expected database type bigint")

    cursor.execute("select count(*) as total from private.countries")
    return cursor.fetchone()["total"]


def make_upsert():
    # Column names are fixed in this script, not taken from JSON input.
    identifiers = sql.SQL(", ").join(
        sql.Identifier(column) for column in IMPORT_COLUMNS
    )
    placeholders = sql.SQL(", ").join(
        sql.Placeholder(column) for column in IMPORT_COLUMNS
    )

    updates = []
    for column in IMPORT_COLUMNS:
        if column in {"code", "difficulty"}:
            continue

        # A missing API value must not erase existing catalog data.
        updates.append(
            sql.SQL("{} = coalesce(excluded.{}, current_country.{})").format(
                sql.Identifier(column),
                sql.Identifier(column),
                sql.Identifier(column),
            )
        )

    return sql.SQL(
        """
        insert into private.countries as current_country ({})
        values ({})
        on conflict (code) do update set {}
        """
    ).format(
        identifiers,
        placeholders,
        sql.SQL(", ").join(updates),
    )


def database_row(row):
    adapted = dict(row)

    for column in JSON_COLUMNS:
        if adapted[column] is not None:
            adapted[column] = Jsonb(adapted[column])

    return adapted


def apply(rows):
    dsn = getpass(
        "\nCloud PostgreSQL connection string "
        "(hidden input; not the Supabase API URL): "
    ).strip()

    if not dsn:
        raise ValueError("No PostgreSQL connection string supplied")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    with psycopg.connect(
        dsn,
        sslmode="require",
        row_factory=dict_row,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set local lock_timeout = '10s'")

            # Prevent concurrent writes between backup and import.
            cursor.execute(
                "lock table private.countries "
                "in share row exclusive mode"
            )

            before_count = check_database(cursor)
            print(f"\nDatabase host: {connection.info.host}")
            print(f"Existing country rows: {before_count}")

            cursor.execute(
                """
                select
                  count(*) filter (where code = any(%s)) as existing_codes
                from private.countries
                """,
                ([row["code"] for row in rows],),
            )
            existing_codes = cursor.fetchone()["existing_codes"]

            print(f"Matching existing codes: {existing_codes}")
            print(f"New codes: {len(rows) - existing_codes}")

            if input(
                "\nConfirm this database and type IMPORT: "
            ).strip() != "IMPORT":
                raise ValueError("Cancelled; database unchanged")

            cursor.execute(
                "select * from private.countries order by code"
            )
            backup_rows = cursor.fetchall()

            timestamp = datetime.now(timezone.utc).strftime(
                "%Y%m%dT%H%M%S%fZ"
            )
            backup_file = BACKUP_DIR / (
                f"countries-before-{timestamp}.json"
            )

            # Local table backup: not a full Supabase database backup.
            with backup_file.open("x", encoding="utf-8") as file:
                json.dump(
                    {
                        "createdAtUtc": datetime.now(
                            timezone.utc
                        ).isoformat(),
                        "rows": backup_rows,
                    },
                    file,
                    ensure_ascii=False,
                    indent=2,
                    default=lambda value: (
                        value.isoformat()
                        if isinstance(value, (date, datetime))
                        else str(value)
                    ),
                )
                file.write("\n")

            print(f"Existing country rows backed up to {backup_file}")

            statement = make_upsert()

            for row in rows:
                cursor.execute(statement, database_row(row))

            cursor.execute(
                "select count(*) as total from private.countries"
            )
            final_count = cursor.fetchone()["total"]

        # Leaving the connection context successfully commits once.
        # An exception rolls back the entire import.

    print(f"Import committed. Country rows now: {final_count}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-unkeyed",
        action="store_true",
        help="Explicitly exclude entries without an alpha-2 code",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write validated records to Supabase Cloud",
    )
    parser.add_argument(
    "--include-unkeyed",
    action="store_true",
    help="Import the four explicitly approved non-ISO entries",
    )
    args = parser.parse_args()

    rows = load_pages(
    skip_unkeyed=args.skip_unkeyed,
    include_unkeyed=args.include_unkeyed,
    )

    print("\nPreview:")
    for row in rows[:5]:
        print(f"  {row['code']}: {row['name']}")

    for field in ("capital", "currency", "flag", "link_wikipedia"):
        missing = sum(row[field] is None for row in rows)
        print(f"Missing {field}: {missing}")

    if not args.apply:
        print("\nDRY RUN ONLY: no database connection or write.")
        return

    apply(rows)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, psycopg.Error) as error:
        # Never include a database connection string or credentials
        # in an error message.
        if isinstance(error, psycopg.Error):
            raise SystemExit(
                f"Database error ({error.sqlstate or 'unknown'}). "
                "The transaction was rolled back."
            ) from None
        raise SystemExit(f"ERROR: {error}") from None