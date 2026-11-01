const SECTION_HEADERS = new Set([
    "about",
    "commander",
    "commanders",
    "companion",
    "deck",
    "mainboard",
    "maybeboard",
    "sideboard"
]);

const MAX_OVERLAP_GROUPS = 25;

let cardTags = null;

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function setStatus(message, cssClass = "loading") {
    document.getElementById("status").innerHTML =
        `<div class="${cssClass}">${escapeHtml(message)}</div>`;
}

function parseDeckLine(line) {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#"))
        return null;

    // "1 Sol Ring", "1x Sol Ring" and "Sol Ring" are all allowed.
    const match = trimmed.match(/^(\d+x?\s+)?(.+)$/i);

    const hasQuantity = Boolean(match[1]);

    const isHeader =
        SECTION_HEADERS.has(match[2].toLowerCase()) ||
        /\(\d+\)$/.test(match[2]);

    if (!hasQuantity && isHeader)
        return null;

    // Drop export extras (set code and number, foil marks, categories),
    // then keep the front face, since Scryfall won't match "Fire // Ice".
    return match[2]
        .replace(/\s+(\([A-Za-z0-9]{2,6}\)|\*|\^|\[|#).*$/, "")
        .split(" // ")[0]
        .trim();
}

function parseDeckList(text) {

    const cardNames =
        text
            .split("\n")
            .map(parseDeckLine)
            .filter(Boolean);

    return [...new Set(cardNames)];
}

async function loadCardTags() {

    if (cardTags)
        return cardTags;

    setStatus("Loading tag data");

    const response = await fetch("card_tags.json");

    if (!response.ok) {
        throw new Error("Failed to load card_tags.json");
    }

    cardTags = await response.json();

    return cardTags;
}

async function fetchCards(cardNames) {

    const cards = [];
    const notFound = [];

    const batchSize = 75;

    for (let i = 0; i < cardNames.length; i += batchSize) {

        const batch =
            cardNames.slice(i, i + batchSize);

        setStatus(
            `Fetching cards ${i + 1}-${Math.min(i + batchSize, cardNames.length)} of ${cardNames.length}`
        );

        const response = await fetch(
            "https://api.scryfall.com/cards/collection",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    identifiers:
                        batch.map(name => ({ name }))
                })
            }
        );

        if (!response.ok) {
            throw new Error("Failed to fetch cards from Scryfall");
        }

        const json = await response.json();

        cards.push(...json.data);
        notFound.push(...json.not_found.map(x => x.name));

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { cards, notFound };
}

function extractTags(card) {

    // Reversible cards keep their oracle_id on each face.
    const oracleId =
        card.oracle_id ||
        card.card_faces?.[0]?.oracle_id;

    const positions =
        cardTags.cards[oracleId] || [];

    return positions.map(i => cardTags.tags[i]);
}

function groupCardsByTag(results) {

    const groups = {};

    for (const card of results) {
        for (const tag of card.tags) {

            if (!groups[tag]) {
                groups[tag] = [];
            }

            groups[tag].push(card.name);
        }
    }

    return Object.entries(groups)
        .sort(
            (a, b) =>
                b[1].length - a[1].length ||
                a[0].localeCompare(b[0])
        );
}

function tagTable(entries) {

    let html =
        "<table><tr><th>Tag</th><th>Count</th><th>Cards</th></tr>";

    for (const [tag, cards] of entries) {

        html += `
        <tr>
            <td>${escapeHtml(tag)}</td>
            <td>${cards.length}</td>
            <td>${cards.map(escapeHtml).join(", ")}</td>
        </tr>`;
    }

    return html + "</table>";
}

function renderTagCounts(tagGroups) {

    const shared =
        tagGroups.filter(([, cards]) => cards.length > 1);

    const single =
        tagGroups.filter(([, cards]) => cards.length === 1);

    let html = tagTable(shared);

    if (single.length > 0) {
        html += `
        <details>
            <summary>Tags on only one card (${single.length})</summary>
            ${tagTable(single)}
        </details>`;
    }

    document.getElementById("tagCounts").innerHTML =
        html;
}

function renderBestCards(results) {

    const sorted =
        [...results].sort(
            (a, b) =>
                b.tags.length -
                a.tags.length
        );

    let html =
        "<table><tr><th>Card</th><th>Tags</th></tr>";

    for (const card of sorted) {

        if (card.tags.length === 0)
            continue;

        html += `
        <tr>
            <td>${escapeHtml(card.name)}</td>
            <td>
                ${card.tags.length}
                (${card.tags.map(escapeHtml).join(", ")})
            </td>
        </tr>`;
    }

    html += "</table>";

    document.getElementById("bestCards").innerHTML =
        html;
}

function findOverlapGroups(tagGroups) {

    const shared =
        tagGroups.filter(([, cards]) => cards.length > 1);

    const groups = new Map();

    for (let i = 0; i < shared.length; i++) {
        for (let j = i + 1; j < shared.length; j++) {

            const [tagA, cardsA] = shared[i];
            const [tagB, cardsB] = shared[j];

            const overlap =
                cardsA.filter(name => cardsB.includes(name));

            // If every card with one tag has the other, the pair says nothing new.
            if (
                overlap.length < 2 ||
                overlap.length === cardsA.length ||
                overlap.length === cardsB.length
            )
                continue;

            const key = overlap.join("|");

            if (!groups.has(key)) {
                groups.set(key, {
                    combo: `${tagA} + ${tagB}`,
                    cards: overlap
                });
            }
        }
    }

    return [...groups.values()]
        .sort((a, b) => b.cards.length - a.cards.length)
        .slice(0, MAX_OVERLAP_GROUPS);
}

function renderOverlapGroups(tagGroups) {

    let html = "";

    for (const { combo, cards } of findOverlapGroups(tagGroups)) {

        html += `
        <div class="combo">
            <strong>${escapeHtml(combo)}</strong><br>
            ${cards.length} card(s)<br><br>
            ${cards.map(escapeHtml).join(", ")}
        </div>`;
    }

    document.getElementById("overlaps").innerHTML =
        html;
}

function renderProblems(notFound, results) {

    const untagged =
        results
            .filter(card => card.tags.length === 0)
            .map(card => card.name);

    let html = "";

    if (notFound.length > 0) {
        html += `<p class="error">Could not find: ${notFound.map(escapeHtml).join(", ")}</p>`;
    }

    if (untagged.length > 0) {
        html += `<p>No tags yet: ${untagged.map(escapeHtml).join(", ")}</p>`;
    }

    document.getElementById("problems").innerHTML =
        html;
}

async function analyzeDeck() {

    try {

        document.getElementById("problems").innerHTML = "";
        document.getElementById("tagCounts").innerHTML = "";
        document.getElementById("bestCards").innerHTML = "";
        document.getElementById("overlaps").innerHTML = "";

        const deckText =
            document.getElementById("deckList").value;

        const cardNames =
            parseDeckList(deckText);

        if (cardNames.length === 0) {
            throw new Error(
                "No card names found in deck list."
            );
        }

        setStatus(
            `Found ${cardNames.length} cards`
        );

        await loadCardTags();

        const { cards, notFound } =
            await fetchCards(cardNames);

        const results = [];

        for (const card of cards) {

            results.push({
                name: card.name,
                tags:
                    extractTags(card)
            });
        }

        const tagGroups =
            groupCardsByTag(results);

        renderProblems(notFound, results);
        renderTagCounts(tagGroups);
        renderBestCards(results);
        renderOverlapGroups(tagGroups);

        setStatus(
            `Finished analyzing ${results.length} cards.`,
            ""
        );

    } catch (error) {

        console.error(error);

        setStatus(
            error.message,
            "error"
        );
    }
}
