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

const TAG_CHOICES = 30;
const DEFAULT_TAGS = 10;
const SAVED_TAGS_KEY = "mtgvenn-selected-tags";
const UPSET_MAX_COLUMNS = 20;

const FORCE_HEIGHT = 600;
const FORCE_PADDING = 40;
const FORCE_TICKS = 300;

let deckResults = [];
let upsetIntersections = [];
let forceNodes = [];
let forceLinks = [];
let hoveredNode = null;
let selectedNode = null;

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

    document.getElementById("tagCounts").innerHTML =
        tagTable(tagGroups);
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

// Storage can be blocked, such as in private windows, so saving is best effort.
function loadSavedTags() {

    try {
        return JSON.parse(localStorage.getItem(SAVED_TAGS_KEY)) || [];
    } catch {
        return [];
    }
}

function saveSelectedTags() {

    const saved = new Set(loadSavedTags());

    // Update only the tags on screen, so choices for other decks are kept.
    for (const box of document.querySelectorAll("#tagChoices input")) {
        if (box.checked) {
            saved.add(box.value);
        } else {
            saved.delete(box.value);
        }
    }

    try {
        localStorage.setItem(SAVED_TAGS_KEY, JSON.stringify([...saved]));
    } catch {
        // The choices still apply until the page is closed.
    }
}

function tagSelectionChanged() {
    saveSelectedTags();
    renderTagCharts();
}

function renderTagChoices(tagGroups) {

    let html = "";

    const choices =
        tagGroups.slice(0, TAG_CHOICES);

    const saved = loadSavedTags();

    const useSaved =
        choices.some(([tag]) => saved.includes(tag));

    choices
        .forEach(([tag, cards], i) => {

            const isChosen =
                useSaved ? saved.includes(tag) : i < DEFAULT_TAGS;

            const checked =
                isChosen ? "checked" : "";

            html += `
            <label>
                <input
                    type="checkbox"
                    value="${escapeHtml(tag)}"
                    ${checked}
                    onchange="tagSelectionChanged()">
                ${escapeHtml(tag)} (${cards.length})
            </label>`;
        });

    document.getElementById("tagChoices").innerHTML =
        html;
}

function selectedTags() {

    const boxes =
        document.querySelectorAll("#tagChoices input:checked");

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
            deckResults.filter(card => card.tags.includes(tag)).length
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

    const tags = selectedTags();

    upsetIntersections =
        findIntersections(deckResults, tags);

    document.getElementById("upsetCards").innerHTML = "";

    document.getElementById("upsetPlot").innerHTML =
        upsetIntersections.length > 0
            ? upsetSvg(tags, upsetIntersections)
            : "<p>Pick at least one tag to see the plot.</p>";
}

function buildForceGraph(results, tags, minShared) {

    const nodes =
        results
            .map(card => ({
                name: card.name,
                tags: tags.filter(tag => card.tags.includes(tag)),
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                links: 0
            }))
            .filter(node => node.tags.length > 0);

    const links = [];

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {

            const shared =
                nodes[i].tags.filter(tag => nodes[j].tags.includes(tag));

            if (shared.length < minShared)
                continue;

            links.push({ a: nodes[i], b: nodes[j], shared });

            nodes[i].links++;
            nodes[j].links++;
        }
    }

    return { nodes, links };
}

function layOutForceGraph(nodes, links, width, height) {

    const repulsion = 2000;
    const linkLength = 60;

    // Start on a spiral so the same deck always gets the same layout.
    nodes.forEach((node, i) => {
        const angle = i * 2.4;
        const distance = 10 * Math.sqrt(i + 1);

        node.x = Math.cos(angle) * distance;
        node.y = Math.sin(angle) * distance;
    });

    for (let tick = 0; tick < FORCE_TICKS; tick++) {

        const cooling = 1 - tick / FORCE_TICKS;

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {

                const dx = nodes[j].x - nodes[i].x;
                const dy = nodes[j].y - nodes[i].y;
                const distanceSquared = Math.max(dx * dx + dy * dy, 1);
                const distance = Math.sqrt(distanceSquared);
                const push = repulsion / distanceSquared * cooling;

                nodes[i].vx -= dx / distance * push;
                nodes[i].vy -= dy / distance * push;
                nodes[j].vx += dx / distance * push;
                nodes[j].vy += dy / distance * push;
            }
        }

        for (const { a, b, shared } of links) {

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.max(Math.hypot(dx, dy), 1);
            const pull = (distance - linkLength) * 0.005 * shared.length * cooling;

            a.vx += dx / distance * pull;
            a.vy += dy / distance * pull;
            b.vx -= dx / distance * pull;
            b.vy -= dy / distance * pull;
        }

        for (const node of nodes) {

            node.vx = (node.vx - node.x * 0.02 * cooling) * 0.6;
            node.vy = (node.vy - node.y * 0.02 * cooling) * 0.6;

            node.x += node.vx;
            node.y += node.vy;
        }
    }

    // Stretch the finished layout to fill the canvas.
    const xs = nodes.map(node => node.x);
    const ys = nodes.map(node => node.y);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(Math.max(...xs) - minX, 1);
    const spanY = Math.max(Math.max(...ys) - minY, 1);

    for (const node of nodes) {
        node.x = FORCE_PADDING + (node.x - minX) / spanX * (width - FORCE_PADDING * 2);
        node.y = FORCE_PADDING + (node.y - minY) / spanY * (height - FORCE_PADDING * 2);
    }
}

function nodeRadius(node) {

    const mostLinks =
        Math.max(...forceNodes.map(x => x.links), 1);

    return 4 + 10 * node.links / mostLinks;
}

function drawForceGraph() {

    const canvas = document.getElementById("forceCanvas");
    const context = canvas.getContext("2d");
    const scale = window.devicePixelRatio || 1;

    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue("--accent");
    const muted = style.getPropertyValue("--border");
    const text = style.getPropertyValue("--text");

    const active = hoveredNode || selectedNode;

    const isActiveLink =
        link => link.a === active || link.b === active;

    const neighbors = new Set();

    for (const link of forceLinks) {
        if (isActiveLink(link)) {
            neighbors.add(link.a);
            neighbors.add(link.b);
        }
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const link of forceLinks) {

        const highlight = isActiveLink(link);

        context.strokeStyle = highlight ? accent : muted;
        context.globalAlpha = highlight || !active ? 0.7 : 0.15;
        context.lineWidth = highlight ? 2 : 1;

        context.beginPath();
        context.moveTo(link.a.x, link.a.y);
        context.lineTo(link.b.x, link.b.y);
        context.stroke();
    }

    for (const node of forceNodes) {

        context.fillStyle = accent;
        context.globalAlpha = !active || neighbors.has(node) || node === active ? 1 : 0.3;

        context.beginPath();
        context.arc(node.x, node.y, nodeRadius(node), 0, Math.PI * 2);
        context.fill();
    }

    context.globalAlpha = 1;
    context.fillStyle = text;
    context.font = "12px Arial, sans-serif";

    const labeled = active ? [...neighbors, active] : [];

    for (const node of labeled) {
        context.fillText(node.name, node.x + nodeRadius(node) + 3, node.y + 4);
    }
}

function nodeAt(x, y) {

    return forceNodes.find(node =>
        Math.hypot(node.x - x, node.y - y) <= nodeRadius(node) + 3
    ) || null;
}

function showForceNode(node) {

    selectedNode = node;

    const connections =
        forceLinks
            .filter(link => link.a === node || link.b === node)
            .map(link => ({
                name: link.a === node ? link.b.name : link.a.name,
                shared: link.shared
            }))
            .sort((a, b) => b.shared.length - a.shared.length);

    let html = "";

    if (node) {

        html = `
        <div class="combo">
            <strong>${escapeHtml(node.name)}</strong><br>
            ${connections.length} connected card(s)<br><br>`;

        for (const { name, shared } of connections) {
            html += `${escapeHtml(name)} (${shared.map(escapeHtml).join(", ")})<br>`;
        }

        html += "</div>";
    }

    document.getElementById("forceCards").innerHTML =
        html;
}

function renderForceGraph() {

    const canvas = document.getElementById("forceCanvas");
    const width = canvas.parentElement.clientWidth;
    const scale = window.devicePixelRatio || 1;

    const minShared =
        Number(document.getElementById("forceMinShared").value) || 1;

    const { nodes, links } =
        buildForceGraph(deckResults, selectedTags(), minShared);

    forceNodes = nodes;
    forceLinks = links;
    hoveredNode = null;

    showForceNode(null);

    canvas.width = width * scale;
    canvas.height = FORCE_HEIGHT * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${FORCE_HEIGHT}px`;

    if (nodes.length > 0) {
        layOutForceGraph(nodes, links, width, FORCE_HEIGHT);
    }

    canvas.onmousemove = event => {
        hoveredNode = nodeAt(event.offsetX, event.offsetY);
        canvas.style.cursor = hoveredNode ? "pointer" : "default";
        drawForceGraph();
    };

    canvas.onmouseleave = () => {
        hoveredNode = null;
        drawForceGraph();
    };

    canvas.onclick = event => {
        showForceNode(nodeAt(event.offsetX, event.offsetY));
        drawForceGraph();
    };

    drawForceGraph();
}

function renderTagCharts() {
    renderUpsetPlot();
    renderForceGraph();
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

function loadSampleDeck() {
    document.getElementById("deckList").value =
        SAMPLE_DECK_LIST.trim();
}

function analyzeDeck() {

    try {

        document.getElementById("problems").innerHTML = "";
        document.getElementById("tagChoices").innerHTML = "";
        document.getElementById("upsetPlot").innerHTML = "";
        document.getElementById("upsetCards").innerHTML = "";
        document.getElementById("forceCards").innerHTML = "";
        document.getElementById("tagCounts").innerHTML = "";
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

        deckResults = results;

        renderProblems(notFound, results);
        renderTagChoices(tagGroups);
        renderTagCharts();
        renderTagCounts(tagGroups);
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
