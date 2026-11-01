"""Download Scryfall's card and tag data and build card_tags.js from it.

Run from the project folder:  python3 build_card_tags.py

Output format, kept small because the browser downloads it:
    const CARD_TAGS = {"tags": ["ramp", ...], "cards": {"sol ring": [0, 12, ...]}};
Card names are lowercase. Each number is a position in the "tags" list.
It's a script, not JSON, so the site still works when index.html is opened directly.
"""

import gzip
import json
import urllib.request

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
OUTPUT_FILE = "card_tags.js"

# Tags for a card's printing cycle, not what it does.
IGNORED_PREFIXES = ("cycle-",)


def open_url(url):
    # Scryfall rejects requests that don't send these headers.
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "MTGVenn/1.0", "Accept": "*/*"},
    )

    return urllib.request.urlopen(request, timeout=60)


def download_bulk_file(bulk_type):
    """Download one Scryfall bulk file. They're gzipped, with one JSON item per line."""
    with open_url(BULK_DATA_URL) as response:
        bulk_files = json.load(response)["data"]

    url = next(
        bulk_file["jsonl_download_uri"]
        for bulk_file in bulk_files
        if bulk_file["type"] == bulk_type
    )

    print(f"Downloading {url}")

    with open_url(url) as response:
        with gzip.open(response, "rt", encoding="utf-8") as file:
            return [json.loads(line) for line in file if line.strip()]


def get_oracle_id(card):
    # Reversible cards keep their oracle_id on each face.
    return card.get("oracle_id") or card["card_faces"][0]["oracle_id"]


def is_ignored(slug):
    return slug.startswith(IGNORED_PREFIXES)


def with_ancestors(tag, tags_by_id):
    """Return the tag's slug plus every parent's, so mana-rock also counts as ramp."""
    slugs = set()
    pending = [tag]
    seen = set()

    while pending:
        current = pending.pop()

        if current["id"] in seen:
            continue

        seen.add(current["id"])
        slugs.add(current["slug"])

        pending.extend(
            tags_by_id[parent_id]
            for parent_id in current["parent_ids"]
            if parent_id in tags_by_id
        )

    return slugs


def main():
    cards = download_bulk_file("oracle_cards")
    tags = download_bulk_file("oracle_tags")

    tags_by_id = {tag["id"]: tag for tag in tags}
    tags_for_card = {}

    for tag in tags:
        slugs = {
            slug
            for slug in with_ancestors(tag, tags_by_id)
            if not is_ignored(slug)
        }

        for tagging in tag["taggings"]:
            tags_for_card.setdefault(tagging["oracle_id"], set()).update(slugs)

    # Cards with no tags stay in the file so the site can tell them from typos.
    tags_for_name = {}

    for card in cards:
        name = card["name"].lower()
        slugs = tags_for_card.get(get_oracle_id(card), set())
        tags_for_name.setdefault(name, set()).update(slugs)

    tag_names = sorted(set().union(*tags_for_name.values()))
    tag_positions = {slug: i for i, slug in enumerate(tag_names)}

    output = {
        "tags": tag_names,
        "cards": {
            name: sorted(tag_positions[slug] for slug in slugs)
            for name, slugs in tags_for_name.items()
        },
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
        file.write("const CARD_TAGS = ")
        json.dump(output, file, separators=(",", ":"))
        file.write(";\n")

    print(f"Wrote {OUTPUT_FILE}: {len(output['cards'])} cards, {len(tag_names)} tags")


if __name__ == "__main__":
    main()
