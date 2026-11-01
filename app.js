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

const UPSET_TAG_CHOICES = 30;
const UPSET_DEFAULT_TAGS = 10;
const UPSET_MAX_COLUMNS = 20;

let upsetResults = [];
let upsetIntersections = [];

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

    // Drop export extras: set code and number, foil marks, categories.
    return match[2]
        .replace(/\s+(\([A-Za-z0-9]{2,6}\)|\*|\^|\[|#).*$/, "")
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

function lookUpCards(cardNames) {

    const results = [];
    const notFound = [];

    for (const name of cardNames) {

        const positions =
            CARD_TAGS.cards[name.toLowerCase()];

        if (!positions) {
            notFound.push(name);
            continue;
        }

        results.push({
            name,
            tags:
                positions.map(i => CARD_TAGS.tags[i])
        });
    }

    return { results, notFound };
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

function renderUpsetChoices(tagGroups) {

    let html = "";

    tagGroups
        .slice(0, UPSET_TAG_CHOICES)
        .forEach(([tag, cards], i) => {

            const checked =
                i < UPSET_DEFAULT_TAGS ? "checked" : "";

            html += `
            <label>
                <input
                    type="checkbox"
                    value="${escapeHtml(tag)}"
                    ${checked}
                    onchange="renderUpsetPlot()">
                ${escapeHtml(tag)} (${cards.length})
            </label>`;
        });

    document.getElementById("upsetChoices").innerHTML =
        html;
}

function selectedUpsetTags() {

    const boxes =
        document.querySelectorAll("#upsetChoices input:checked");

    return [...boxes].map(box => box.value);
}

function findIntersections(results, tags) {

    const groups = new Map();

    for (const card of results) {

        const shared =
            tags.filter(tag => card.tags.includes(tag));

        if (shared.length === 0)
            continue;

        const key = shared.join("|");

        if (!groups.has(key)) {
            groups.set(key, { tags: shared, cards: [] });
        }

        groups.get(key).cards.push(card.name);
    }

    return [...groups.values()]
        .sort(
            (a, b) =>
                b.cards.length - a.cards.length ||
                b.tags.length - a.tags.length
        )
        .slice(0, UPSET_MAX_COLUMNS);
}

function upsetSvg(tags, intersections) {

    const labelWidth = 190;
    const setBarWidth = 90;
    const columnWidth = 30;
    const rowHeight = 26;
    const barsHeight = 160;

    const left = labelWidth + setBarWidth + 20;
    const width = left + intersections.length * columnWidth;
    const height = barsHeight + tags.length * rowHeight + 10;

    const setSizes =
        tags.map(tag =>
            upsetResults.filter(card => card.tags.includes(tag)).length
        );

    const maxSet = Math.max(...setSizes);
    const maxColumn = intersections[0].cards.length;

    const rowY = i => barsHeight + i * rowHeight + rowHeight / 2;
    const columnX = i => left + i * columnWidth + columnWidth / 2;

    let svg = `<svg width="${width}" height="${height}" role="img" aria-label="UpSet plot of deck tags">`;

    tags.forEach((tag, i) => {

        const barWidth = setSizes[i] / maxSet * setBarWidth;

        if (i % 2 === 0) {
            svg += `<rect class="upset-band" x="0" y="${rowY(i) - rowHeight / 2}" width="${width}" height="${rowHeight}"></rect>`;
        }

        svg += `
        <text class="upset-label" x="${labelWidth - 8}" y="${rowY(i) + 4}" text-anchor="end">${escapeHtml(tag)}</text>
        <rect class="upset-set" x="${labelWidth}" y="${rowY(i) - 7}" width="${barWidth}" height="14"></rect>
        <text class="upset-count" x="${labelWidth + barWidth + 4}" y="${rowY(i) + 4}">${setSizes[i]}</text>`;
    });

    intersections.forEach((group, i) => {

        const x = columnX(i);
        const barHeight = group.cards.length / maxColumn * (barsHeight - 30);
        const rows = group.tags.map(tag => tags.indexOf(tag));

        svg += `
        <rect class="upset-bar" x="${x - 9}" y="${barsHeight - 8 - barHeight}" width="18" height="${barHeight}"></rect>
        <text class="upset-count" x="${x}" y="${barsHeight - 12 - barHeight}" text-anchor="middle">${group.cards.length}</text>`;

        tags.forEach((tag, row) => {

            const cssClass =
                rows.includes(row) ? "upset-dot-on" : "upset-dot-off";

            svg += `<circle class="${cssClass}" cx="${x}" cy="${rowY(row)}" r="6"></circle>`;
        });

        if (rows.length > 1) {
            svg += `<line class="upset-link" x1="${x}" x2="${x}" y1="${rowY(Math.min(...rows))}" y2="${rowY(Math.max(...rows))}"></line>`;
        }

        svg += `
        <rect class="upset-hit" x="${x - columnWidth / 2}" y="0" width="${columnWidth}" height="${height}" onclick="showIntersection(${i})">
            <title>${group.tags.map(escapeHtml).join(" + ")}: ${group.cards.length} card(s)</title>
        </rect>`;
    });

    return svg + "</svg>";
}

function showIntersection(index) {

    const { tags, cards } = upsetIntersections[index];

    document.getElementById("upsetCards").innerHTML = `
        <div class="combo">
            <strong>Only ${tags.map(escapeHtml).join(" + ")}</strong><br>
            ${cards.length} card(s)<br><br>
            ${cards.map(escapeHtml).join(", ")}
        </div>`;
}

function renderUpsetPlot() {

    const tags = selectedUpsetTags();

    upsetIntersections =
        findIntersections(upsetResults, tags);

    document.getElementById("upsetCards").innerHTML = "";

    document.getElementById("upsetPlot").innerHTML =
        upsetIntersections.length > 0
            ? upsetSvg(tags, upsetIntersections)
            : "<p>Pick at least one tag to see the plot.</p>";
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

function analyzeDeck() {

    try {

        document.getElementById("problems").innerHTML = "";
        document.getElementById("upsetChoices").innerHTML = "";
        document.getElementById("upsetPlot").innerHTML = "";
        document.getElementById("upsetCards").innerHTML = "";
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

        const { results, notFound } =
            lookUpCards(cardNames);

        const tagGroups =
            groupCardsByTag(results);

        upsetResults = results;

        renderProblems(notFound, results);
        renderUpsetChoices(tagGroups);
        renderUpsetPlot();
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
