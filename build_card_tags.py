"""Build card_tags.json from oracle-cards-slim.json and oracle-tags.json.

Run from the project folder:  python3 build_card_tags.py

Output format, kept small because the browser downloads it:
    {"tags": ["ramp", ...], "cards": {"sol ring": [0, 12, ...]}}
Card names are lowercase. Each number is a position in the "tags" list.
"""

import json

CARDS_FILE = "oracle-cards-slim.json"
TAGS_FILE = "oracle-tags.json"
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
    with open(CARDS_FILE, encoding="utf-8") as file:
        cards = json.load(file)

    with open(TAGS_FILE, encoding="utf-8") as file:
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

    # Cards with no tags stay in the file so the site can tell them from typos.
    tags_for_name = {}

    for card in cards:
        name = card["name"].lower()
        slugs = tags_for_card.get(card["oracle_id"], set())
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
        json.dump(output, file, separators=(",", ":"))

    print(f"Wrote {OUTPUT_FILE}: {len(output['cards'])} cards, {len(tag_names)} tags")


if __name__ == "__main__":
    main()
