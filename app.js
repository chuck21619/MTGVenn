const KATHRIL_ABILITIES = [
    "flying",
    "first strike",
    "double strike",
    "deathtouch",
    "haste",
    "hexproof",
    "indestructible",
    "lifelink",
    "menace",
    "reach",
    "trample",
    "vigilance"
];

function setStatus(message, cssClass = "loading") {
    document.getElementById("status").innerHTML =
        `<div class="${cssClass}">${message}</div>`;
}

function parseDeckList(text) {

    const cardNames = [];

    const lines = text.split("\n");

    for (const line of lines) {

        const trimmed = line.trim();

        if (!trimmed)
            continue;

        const match = trimmed.match(/^\d+\s+(.+)$/);

        if (!match)
            continue;

        cardNames.push(match[1].trim());
    }

    return [...new Set(cardNames)];
}

async function fetchCards(cardNames) {

    const cards = [];

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

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return cards;
}

function extractAbilities(card) {

    const keywords =
        (card.keywords || [])
            .map(x => x.toLowerCase());

    return KATHRIL_ABILITIES.filter(
        ability => keywords.includes(ability)
    );
}

function renderAbilityCounts(results) {

    const counts = {};

    KATHRIL_ABILITIES.forEach(
        ability => counts[ability] = 0
    );

    for (const card of results) {
        for (const ability of card.abilities) {
            counts[ability]++;
        }
    }

    let html =
        "<table><tr><th>Ability</th><th>Count</th></tr>";

    for (const ability of KATHRIL_ABILITIES) {

        html += `
        <tr>
            <td>${ability}</td>
            <td>${counts[ability]}</td>
        </tr>`;
    }

    html += "</table>";

    document.getElementById("abilityCounts").innerHTML =
        html;
}

function renderBestCards(results) {

    const sorted =
        [...results].sort(
            (a, b) =>
                b.abilities.length -
                a.abilities.length
        );

    let html =
        "<table><tr><th>Card</th><th>Abilities</th></tr>";

    for (const card of sorted) {

        if (card.abilities.length === 0)
            continue;

        html += `
        <tr>
            <td>${card.name}</td>
            <td>
                ${card.abilities.length}
                (${card.abilities.join(", ")})
            </td>
        </tr>`;
    }

    html += "</table>";

    document.getElementById("bestCards").innerHTML =
        html;
}

function renderOverlapGroups(results) {

    const groups = {};

    for (const card of results) {

        if (card.abilities.length === 0)
            continue;

        const key =
            card.abilities
                .slice()
                .sort()
                .join(" + ");

        if (!groups[key]) {
            groups[key] = [];
        }

        groups[key].push(card.name);
    }

    const sorted =
        Object.entries(groups)
            .sort(
                (a, b) =>
                    b[1].length -
                    a[1].length
            );

    let html = "";

    for (const [combo, cards] of sorted) {

        html += `
        <div class="combo">
            <strong>${combo}</strong><br>
            ${cards.length} card(s)<br><br>
            ${cards.join(", ")}
        </div>`;
    }

    document.getElementById("overlaps").innerHTML =
        html;
}

async function analyzeDeck() {

    try {

        document.getElementById("abilityCounts").innerHTML = "";
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

        const cards =
            await fetchCards(cardNames);

        const results = [];

        for (const card of cards) {

            results.push({
                name: card.name,
                abilities:
                    extractAbilities(card)
            });
        }

        renderAbilityCounts(results);
        renderBestCards(results);
        renderOverlapGroups(results);

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