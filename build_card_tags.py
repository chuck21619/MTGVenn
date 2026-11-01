"""Build card_tags.json from Scryfall's oracle-tags.json bulk file.

Run from the project folder:  python3 build_card_tags.py

Output format, kept small because the browser downloads it:
    {"tags": ["ramp", ...], "cards": {"<oracle_id>": [0, 12, ...]}}
Each number is a position in the "tags" list.
"""

import json

INPUT_FILE = "oracle-tags.json"
OUTPUT_FILE = "card_tags.json"

# Tags that describe a card's name, printing or rules wording, not what it does.
IGNORED_PREFIXES = ("cycle-",)
IGNORED_TAGS = {
    "bible-reference",
}


def is_ignored(slug):
    return slug in IGNORED_TAGS or slug.startswith(IGNORED_PREFIXES)


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
    with open(INPUT_FILE, encoding="utf-8") as file:
        tags = json.load(file)

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

    tag_names = sorted(set().union(*tags_for_card.values()))
    tag_positions = {slug: i for i, slug in enumerate(tag_names)}

    output = {
        "tags": tag_names,
        "cards": {
            oracle_id: sorted(tag_positions[slug] for slug in slugs)
            for oracle_id, slugs in tags_for_card.items()
            if slugs
        },
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
        json.dump(output, file, separators=(",", ":"))

    print(f"Wrote {OUTPUT_FILE}: {len(output['cards'])} cards, {len(tag_names)} tags")


if __name__ == "__main__":
    main()
