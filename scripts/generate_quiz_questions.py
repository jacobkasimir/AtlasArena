#!/usr/bin/env python3

"""
Generate English Atlas Arena quiz drafts from private.countries.

Database access is READ ONLY.
Questions are exported for the existing protected admin JSON importer.

Output:
- batch-01.json, batch-02.json, ...
- report.json
- verify-import.sql

No questions are written directly to PostgreSQL.
"""

import argparse
import hashlib
import json
import random
import re
import unicodedata

from collections import Counter, deque
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row


REGIONS = [
    "Africa",
    "Asia",
    "Europe",
    "North America",
    "South America",
    "Oceania",
]

FAMILIES = ("capital", "region", "domain", "landlocked")

MAX_RECORDS_PER_FILE = 100

# Intentionally below the admin limit of 256 KiB.
# This leaves room for differences in server-side JSON serialization.
MAX_FILE_BYTES = 180_000

ID_PREFIX = "geo-dbgen"


def normalize(value):
    """Normalize for label/prompt comparison, not for factual inference."""
    if not isinstance(value, str):
        return ""

    decomposed = unicodedata.normalize("NFKD", value)
    without_accents = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )

    return " ".join(without_accents.casefold().split())


def rng_for(identifier):
    seed = int.from_bytes(
        hashlib.sha256(identifier.encode("utf-8")).digest()[:8],
        "big",
    )
    return random.Random(seed)


def unique_labels(values):
    result = {}

    for value in values:
        if not isinstance(value, str) or not value.strip():
            continue

        label = value.strip()
        key = normalize(label)

        if key and key not in result:
            result[key] = label

    return list(result.values())


def get_capitals(value):
    """Keep the structured capital data; do not split the legacy string."""
    if not isinstance(value, list):
        return []

    return unique_labels([
        item.get("name")
        for item in value
        if isinstance(item, dict)
    ])


def get_domains(value):
    """Use conventional ASCII two-letter ccTLDs in this first generator."""
    if not isinstance(value, list):
        return []

    return sorted({
        domain.strip().lower()
        for domain in value
        if isinstance(domain, str)
        and re.fullmatch(r"\.[a-zA-Z]{2}", domain.strip())
    })


def https_reference(*values):
    for value in values:
        if not isinstance(value, str) or not value.strip():
            continue

        candidate = value.strip()

        try:
            parsed = urlparse(candidate)
        except ValueError:
            continue

        if (
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and len(candidate) <= 1000
            and not any(character.isspace() for character in candidate)
        ):
            return candidate

    return None


def make_mc_options(correct, distractor_candidates, accepted_answers, identifier):
    """
    Exclude ALL valid answers for the target from the wrong options.
    Shuffle labels deterministically, then assign stable option IDs.
    """
    accepted = {normalize(value) for value in accepted_answers}

    wrong = [
        value
        for value in unique_labels(distractor_candidates)
        if normalize(value) not in accepted
    ]

    if len(wrong) < 3:
        return None

    rng = rng_for(identifier)
    rng.shuffle(wrong)

    labels = [correct] + wrong[:3]
    rng.shuffle(labels)

    options = [
        {"id": option_id, "label": label}
        for option_id, label in zip(("a", "b", "c", "d"), labels)
    ]

    correct_id = next(
        option["id"]
        for option in options
        if normalize(option["label"]) == normalize(correct)
    )

    return options, correct_id


def base_question(country, family, kind, category, difficulty):
    return {
        "stableId": f"{ID_PREFIX}-{family}-{country['code'].lower()}",
        "expectedVersion": 0,
        "type": kind,
        "prompt": "",
        "category": "geography",
        "subcategory": category,
        "difficulty": difficulty,
        "countryCode": country["code"],
        "options": [],
        "correct": "",
        "explanation": "",
        "source": country["reference"],
        "sourceVerified": False,
        "reviewStatus": "draft",
        "lastReviewed": None,
        "referenceYear": None,
        "asset": None,
    }


def build_questions(countries, existing_ids, existing_prompts, existing_capital_codes):
    pools = {family: [] for family in FAMILIES}
    skipped = []

    all_capitals = unique_labels([
        capital
        for country in countries
        for capital in country["capital_names"]
    ])

    all_domains = unique_labels([
        domain
        for country in countries
        for domain in country["domain_names"]
    ])

    def skip(country, family, reason):
        skipped.append({
            "countryCode": country["code"],
            "family": family,
            "reason": reason,
        })

    def add(country, family, question):
        if question["stableId"] in existing_ids:
            skip(country, family, "Stable ID already exists in question bank")
            return

        if normalize(question["prompt"]) in existing_prompts:
            skip(country, family, "Matching normalized prompt already exists")
            return

        pools[family].append(question)

    for country in countries:
        name = country["name"]
        code = country["code"]

        # -----------------------------------------------------
        # 1. Capital: exactly one listed capital.
        # -----------------------------------------------------
        capitals = country["capital_names"]

        if code in existing_capital_codes:
            # Conservative duplication check: do not add another
            # capital question for a country already tagged with one.
            skip(
                country,
                "capital",
                "A country-linked capital question already exists",
            )
        elif len(capitals) != 1:
            skip(
                country,
                "capital",
                "Requires exactly one distinct structured capital",
            )
        else:
            question = base_question(
                country, "capital", "mc", "capitals", "medium"
            )
            capital = capitals[0]

            # Prefer distractors from the same region.
            same_region = unique_labels([
                other_capital
                for other in countries
                if other["region"] == country["region"]
                and other["code"] != code
                for other_capital in other["capital_names"]
            ])

            candidates = (
                same_region
                if len(same_region) >= 3
                else all_capitals
            )

            answer_data = make_mc_options(
                capital,
                candidates,
                capitals,
                question["stableId"],
            )

            if answer_data is None:
                skip(country, "capital", "Fewer than three valid distractors")
            else:
                question["prompt"] = (
                    f"Which city is the capital of {name}?"
                )
                question["options"], question["correct"] = answer_data
                question["explanation"] = (
                    f"{capital} is the capital of {name}."
                )
                add(country, "capital", question)

        # -----------------------------------------------------
        # 2. Region: explicitly the atlas convention.
        # -----------------------------------------------------
        region = country["region"]

        if region not in REGIONS:
            skip(country, "region", "Region outside the configured convention")
        else:
            question = base_question(
                country, "region", "mc", "regions", "easy"
            )
            answer_data = make_mc_options(
                region,
                REGIONS,
                [region],
                question["stableId"],
            )

            question["prompt"] = (
                f"In this quiz's regional grouping, where is {name} placed?"
            )
            question["options"], question["correct"] = answer_data
            question["explanation"] = (
                f"This atlas groups {name} in {region}. "
                "Its six-region convention separates North and South "
                "America and groups Central America and the Caribbean "
                "with North America. Regional conventions can differ."
            )
            add(country, "region", question)

        # -----------------------------------------------------
        # 3. Internet ccTLDs: allow multiple valid domains,
        # but show only one among the four choices.
        # -----------------------------------------------------
        domains = country["domain_names"]

        if not domains:
            skip(country, "domain", "No supported two-letter ccTLD available")
        else:
            question = base_question(
                country, "domain", "mc", "countries", "hard"
            )

            correct_domain = domains[0]
            answer_data = make_mc_options(
                correct_domain,
                all_domains,
                domains,
                question["stableId"],
            )

            if answer_data is None:
                skip(country, "domain", "Fewer than three valid distractors")
            else:
                question["prompt"] = (
                    "Which of these country-code top-level domains "
                    f"is associated with {name}?"
                )
                question["options"], question["correct"] = answer_data
                question["explanation"] = (
                    f"{correct_domain} is a country-code top-level domain "
                    f"associated with {name}. This does not mean that "
                    "websites using it are necessarily operated from there."
                )
                add(country, "domain", question)

        # -----------------------------------------------------
        # 4. Landlocked: use actual booleans, not truthy strings.
        # -----------------------------------------------------
        landlocked = country["landlocked"]

        if not isinstance(landlocked, bool):
            skip(country, "landlocked", "Missing or invalid landlocked boolean")
        else:
            question = base_question(
                country, "landlocked", "tf", "countries", "medium"
            )
            question["prompt"] = (
                f"True or false: {name} is landlocked."
            )
            question["options"] = [
                {"id": "true", "label": "True"},
                {"id": "false", "label": "False"},
            ]
            question["correct"] = "true" if landlocked else "false"

            if landlocked:
                question["explanation"] = (
                    f"{name} is landlocked. A landlocked country has no "
                    "coastline on the open ocean or its connected seas."
                )
            else:
                question["explanation"] = (
                    f"{name} is not landlocked: it has a coastline on "
                    "the ocean or a sea connected to it."
                )

            add(country, "landlocked", question)

    return pools, skipped


def select_balanced(pools, count):
    queues = {}

    for family, questions in pools.items():
        ordered = list(questions)
        rng_for(f"selection-{family}").shuffle(ordered)
        queues[family] = deque(ordered)

    available = sum(len(queue) for queue in queues.values())

    if available < count:
        raise ValueError(
            f"Only {available} new candidates are available; "
            f"{count} requested. Check the generation report or use "
            f"--count with a smaller number. No partial batches were written."
        )

    chosen = []

    while len(chosen) < count:
        for family in FAMILIES:
            if queues[family] and len(chosen) < count:
                chosen.append(queues[family].popleft())

    return chosen


def validate_questions(questions):
    ids = set()
    prompts = set()

    for index, question in enumerate(questions, start=1):
        stable_id = question["stableId"]

        if stable_id in ids:
            raise ValueError(f"Question {index}: duplicate stableId")
        ids.add(stable_id)

        prompt_key = normalize(question["prompt"])
        if prompt_key in prompts:
            raise ValueError(f"Question {index}: duplicate prompt")
        prompts.add(prompt_key)

        if not re.fullmatch(r"[A-Za-z0-9_-]{3,80}", stable_id):
            raise ValueError(f"Question {index}: invalid stableId")

        if not 5 <= len(question["prompt"]) <= 500:
            raise ValueError(f"Question {index}: invalid prompt length")

        if not 5 <= len(question["explanation"]) <= 3000:
            raise ValueError(f"Question {index}: invalid explanation length")

        if question["sourceVerified"] is not False:
            raise ValueError("Generated source must remain unverified")

        if question["reviewStatus"] != "draft":
            raise ValueError("Generated question must remain a draft")

        options = question["options"]
        expected = 4 if question["type"] == "mc" else 2

        if len(options) != expected:
            raise ValueError(f"Question {index}: wrong option count")

        option_ids = [option["id"] for option in options]
        labels = [normalize(option["label"]) for option in options]

        if len(set(option_ids)) != expected:
            raise ValueError(f"Question {index}: duplicate option IDs")

        if len(set(labels)) != expected:
            raise ValueError(f"Question {index}: duplicate option labels")

        if question["correct"] not in option_ids:
            raise ValueError(f"Question {index}: correct option missing")

        for option in options:
            if not 1 <= len(option["label"]) <= 200:
                raise ValueError(f"Question {index}: invalid option length")

        if not https_reference(question["source"]):
            raise ValueError(f"Question {index}: invalid source URL")


def serialize(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def split_batches(questions):
    batches = []
    current = []

    for question in questions:
        candidate = current + [question]
        too_many = len(candidate) > MAX_RECORDS_PER_FILE
        too_large = len(serialize(candidate).encode("utf-8")) > MAX_FILE_BYTES

        if current and (too_many or too_large):
            batches.append(current)
            current = [question]
        else:
            current = candidate

        if len(serialize(current).encode("utf-8")) > MAX_FILE_BYTES:
            raise ValueError("A single question exceeds the file limit")

    if current:
        batches.append(current)

    return batches


def read_database(dsn):
    with psycopg.connect(
        dsn,
        sslmode="require",
        connect_timeout=20,
        row_factory=dict_row,
    ) as connection:
        # This script must not modify the source database.
        connection.execute("set transaction read only")

        countries = connection.execute(
            """
            select
              code,
              name,
              capitals,
              region,
              tlds,
              landlocked,
              source,
              link_wikipedia
            from private.countries
            where catalog_kind = 'iso_alpha2'
              and (
                membership_un is true
                or code in ('PS', 'VA')
              )
            order by code
            """
        ).fetchall()

        existing = connection.execute(
            """
            select stable_id, prompt, subcategory, country_code
            from private.questions
            """
        ).fetchall()

        categories = {
            row["id"]
            for row in connection.execute(
                """
                select id
                from public.categories
                where parent_id = 'geography'
                """
            ).fetchall()
        }

    required = {"capitals", "regions", "countries"}
    if not required.issubset(categories):
        raise ValueError(
            "Required geography subcategories are missing: "
            + ", ".join(sorted(required - categories))
        )

    return countries, existing


def prepare_countries(raw_countries):
    countries = []
    skipped = []

    for country in raw_countries:
        code = country["code"]
        name = country["name"]

        if not isinstance(code, str) or not re.fullmatch(r"[A-Z]{2}", code):
            skipped.append({"code": code, "reason": "Invalid alpha-2 code"})
            continue

        if not isinstance(name, str) or not name.strip():
            skipped.append({"code": code, "reason": "Missing name"})
            continue

        reference = https_reference(
            country["link_wikipedia"],
            country["source"],
        )

        if reference is None:
            skipped.append({"code": code, "reason": "No HTTPS source reference"})
            continue

        countries.append({
            **country,
            "name": name.strip(),
            "reference": reference,
            "capital_names": get_capitals(country["capitals"]),
            "domain_names": get_domains(country["tlds"]),
        })

    return countries, skipped


def write_verification_sql(output, questions):
    # stableId is validated above and contains no SQL quote characters.
    values = ",\n    ".join(
        f"('{question['stableId']}')"
        for question in questions
    )

    statement = f"""
-- Read-only verification of exactly this generated question set.
with expected(stable_id) as (
  values
    {values}
),
latest as (
  select distinct on (question.stable_id)
    question.stable_id,
    question.version,
    question.published,
    question.review_status
  from private.questions as question
  where question.stable_id in (
    select stable_id from expected
  )
  order by question.stable_id, question.version desc
)
select
  count(*) as expected_questions,
  count(latest.stable_id) as imported_questions,
  count(*) filter (
    where latest.stable_id is null
  ) as missing_questions,
  count(*) filter (
    where latest.published
  ) as published_questions
from expected
left join latest using (stable_id);
"""

    (output / "verify-import.sql").write_text(
        statement.strip() + "\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("country-import/generated-questions"),
    )
    args = parser.parse_args()

    if not 1 <= args.count <= 500:
        raise ValueError("--count must be between 1 and 500")

    output = args.out

    if output.exists() and any(output.iterdir()):
        raise ValueError(
            f"{output} is not empty. Use a new --out directory "
            "rather than overwriting an existing review batch."
        )

    dsn = getpass(
        "Supabase Cloud PostgreSQL connection string "
        "(hidden input): "
    ).strip()

    if not dsn:
        raise ValueError("No connection string supplied")

    raw_countries, existing = read_database(dsn)

    existing_ids = {question["stable_id"] for question in existing}
    existing_prompts = {
        normalize(question["prompt"])
        for question in existing
    }

    existing_capital_codes = {
        question["country_code"]
        for question in existing
        if question["subcategory"] == "capitals"
        and question["country_code"]
    }

    countries, skipped_countries = prepare_countries(raw_countries)

    pools, skipped_questions = build_questions(
        countries,
        existing_ids,
        existing_prompts,
        existing_capital_codes,
    )

    output.mkdir(parents=True, exist_ok=True)

    report = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "requestedQuestions": args.count,
        "eligibleCountryRowsRead": len(raw_countries),
        "usableCountryRows": len(countries),
        "candidateCounts": {
            family: len(questions)
            for family, questions in pools.items()
        },
        "skippedCountries": skipped_countries,
        "skippedQuestions": skipped_questions,
        "status": "DRAFTS — NOT FACT-CHECKED",
        "notes": [
            "Database access was read-only.",
            "Wikipedia references were not fetched or independently verified.",
            "Country metadata can be incomplete or outdated.",
            "Difficulty is assigned per template, not copied from country difficulty.",
            "The 6-region grouping is an explicit application convention.",
            "No government, currency, population or border rankings generated.",
            "Duplicate checks do not detect every semantically equivalent question.",
        ],
    }

    # Write diagnostics even if fewer candidates than requested exist.
    (output / "report.json").write_text(
        serialize(report),
        encoding="utf-8",
    )

    print(f"Usable country rows: {len(countries)}")
    for family, questions in pools.items():
        print(f"  {family}: {len(questions)} candidates")

    questions = select_balanced(pools, args.count)
    validate_questions(questions)
    batches = split_batches(questions)

    for index, batch in enumerate(batches, start=1):
        filename = output / f"batch-{index:02d}.json"
        filename.write_text(serialize(batch), encoding="utf-8")
        print(f"{filename}: {len(batch)} questions")

    report["generatedQuestions"] = len(questions)
    report["batchCount"] = len(batches)
    report["selectedBreakdown"] = dict(Counter(
        f"{question['subcategory']} / "
        f"{question['difficulty']} / "
        f"{question['type']}"
        for question in questions
    ))

    (output / "report.json").write_text(
        serialize(report),
        encoding="utf-8",
    )

    write_verification_sql(output, questions)

    print(f"\nGenerated and structurally validated: {len(questions)} drafts")
    print("No question records were written to Supabase.")
    print(f"Review report: {output / 'report.json'}")
    print("Next: import batch files through /admin.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        # Avoid exposing connection details or credentials.
        raise SystemExit(
            f"Database access failed. SQLSTATE: "
            f"{error.sqlstate or 'connection error'}. "
            "No database writes were performed."
        ) from None
    except (ValueError, OSError) as error:
        raise SystemExit(f"ERROR: {error}") from None