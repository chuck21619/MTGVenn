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

const MAX_OVERLAP_TAGS = 40;

const SHORT_TAG_LIST = 30;
const DEFAULT_TAGS = 10;
const SAVED_TAGS_KEY = "mtgvenn-selected-tags";
const SAVED_SECTIONS_KEY = "mtgvenn-open-sections";
const UPSET_MAX_COLUMNS = 20;

const FORCE_HEIGHT = 600;
const FORCE_PADDING = 40;
const FORCE_TICKS = 300;

let deckResults = [];
let upsetIntersections = [];
let forceNodes = [];
let forceLinks = [];
let selectedNode = null;
let tagCountEntries = [];
let overlapCells = [];
let showAllTags = false;

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

function selectedTagGroups() {

    const tags = selectedTags();

    return groupCardsByTag(deckResults)
        .filter(([tag]) => tags.includes(tag));
}

function tagCountsSvg(entries) {

    const left = 110;
    const top = 25;
    const plotHeight = 300;
    const bottom = 130;
    const columnWidth = 36;

    const width = left + entries.length * columnWidth + 20;
    const height = top + plotHeight + bottom;
    const baseline = top + plotHeight;

    const mostCards =
        Math.max(...entries.map(([, cards]) => cards.length));

    const tickStep = Math.max(Math.ceil(mostCards / 5), 1);

    const scaleY = value => baseline - value / mostCards * plotHeight;

    let svg = `<svg width="${width}" height="${height}" role="img" aria-label="Bar graph of cards per tag">`;

    for (let value = 0; value <= mostCards; value += tickStep) {
        svg += `
        <line class="count-grid" x1="${left}" x2="${width - 20}" y1="${scaleY(value)}" y2="${scaleY(value)}"></line>
        <text class="count-text" x="${left - 8}" y="${scaleY(value) + 4}" text-anchor="end">${value}</text>`;
    }

    svg += `<text class="count-text" x="${left - 45}" y="${baseline - plotHeight / 2}" text-anchor="middle" transform="rotate(-90 ${left - 45} ${baseline - plotHeight / 2})">Cards</text>`;

    entries.forEach(([tag, cards], i) => {

        const x = left + i * columnWidth;
        const center = x + columnWidth / 2;
        const barTop = scaleY(cards.length);

        svg += `
        <g class="count-column" onclick="showTagCards(${i})">
            <rect class="count-hit" x="${x}" y="${top}" width="${columnWidth}" height="${plotHeight}"></rect>
            <rect class="count-bar" x="${x + 6}" y="${barTop}" width="${columnWidth - 12}" height="${baseline - barTop}"></rect>
            <text class="count-text" x="${center}" y="${barTop - 5}" text-anchor="middle">${cards.length}</text>
            <text class="count-text" x="${center + 3}" y="${baseline + 14}" text-anchor="end" transform="rotate(-45 ${center + 3} ${baseline + 14})">${escapeHtml(tag)}</text>
        </g>`;
    });

    return svg + "</svg>";
}

function cardListHtml(title, cards) {
    return `
        <div class="combo">
            <strong>${escapeHtml(title)}</strong><br>
            ${cards.length} card(s)<br><br>
            ${cards.map(escapeHtml).join(", ")}
        </div>`;
}

function showTagCards(index) {

    const [tag, cards] = tagCountEntries[index];

    document.getElementById("tagCountCards").innerHTML =
        cardListHtml(tag, cards);
}

function showOverlapCards(index) {

    const { title, cards } = overlapCells[index];

    document.getElementById("overlapCards").innerHTML =
        cardListHtml(title, cards);
}

function renderTagCounts() {

    tagCountEntries = selectedTagGroups();

    document.getElementById("tagCountCards").innerHTML = "";

    document.getElementById("tagCounts").innerHTML =
        tagCountEntries.length > 0 ? tagCountsSvg(tagCountEntries) : "";
}

function findOverlapCells(tagGroups) {

    const cells = [];

    tagGroups.forEach(([tagA, cardsA], row) => {
        tagGroups.slice(0, row).forEach(([tagB, cardsB], column) => {

            const cards =
                cardsA.filter(name => cardsB.includes(name));

            if (cards.length > 0) {
                cells.push({
                    row,
                    column,
                    title: `${tagB} + ${tagA}`,
                    cards
                });
            }
        });
    });

    return cells;
}

function overlapSvg(tags, cells) {

    const left = 190;
    const top = 5;
    const bottom = 130;
    const cellSize = 32;

    const size = (tags.length - 1) * cellSize;
    const baseline = top + size;
    const width = left + size + 20;
    const height = baseline + bottom;

    const mostCards =
        Math.max(...cells.map(cell => cell.cards.length), 1);

    let svg = `<svg width="${width}" height="${height}" role="img" aria-label="Heatmap of cards shared between tags">`;

    // The first tag has no row and the last has no column, so the grid is a triangle.
    tags.slice(1).forEach((tag, i) => {
        svg += `
        <text class="count-text" x="${left - 8}" y="${top + i * cellSize + cellSize / 2 + 4}" text-anchor="end">${escapeHtml(tag)}</text>`;

        for (let column = 0; column <= i; column++) {
            svg += `<rect class="overlap-empty" x="${left + column * cellSize + 1}" y="${top + i * cellSize + 1}" width="${cellSize - 2}" height="${cellSize - 2}"></rect>`;
        }
    });

    tags.slice(0, -1).forEach((tag, i) => {

        const x = left + i * cellSize + cellSize / 2 + 3;

        svg += `<text class="count-text" x="${x}" y="${baseline + 14}" text-anchor="end" transform="rotate(-45 ${x} ${baseline + 14})">${escapeHtml(tag)}</text>`;
    });

    cells.forEach(({ row, column, cards }, i) => {

        const x = left + column * cellSize;
        const y = top + (row - 1) * cellSize;
        const strength = cards.length / mostCards;

        const textClass =
            strength > 0.55 ? "overlap-text-dark" : "count-text";

        svg += `
        <g class="overlap-cell" onclick="showOverlapCards(${i})">
            <rect x="${x + 1}" y="${y + 1}" width="${cellSize - 2}" height="${cellSize - 2}" fill-opacity="${0.15 + 0.85 * strength}"></rect>
            <text class="${textClass}" x="${x + cellSize / 2}" y="${y + cellSize / 2 + 4}" text-anchor="middle">${cards.length}</text>
        </g>`;
    });

    return svg + "</svg>";
}

function renderOverlapGroups() {

    const tagGroups =
        selectedTagGroups().slice(0, MAX_OVERLAP_TAGS);

    const tags = tagGroups.map(([tag]) => tag);

    overlapCells = findOverlapCells(tagGroups);

    document.getElementById("overlapCards").innerHTML = "";

    document.getElementById("overlaps").innerHTML =
        tags.length > 1
            ? overlapSvg(tags, overlapCells)
            : "<p>Pick at least two tags to see overlaps.</p>";
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
    renderTagSummary();
    renderTagCharts();
}

function renderTagChoices(tagGroups) {

    let html = "";

    const saved = loadSavedTags();

    const useSaved =
        tagGroups.some(([tag]) => saved.includes(tag));

    tagGroups
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
                <span>${escapeHtml(tag)}</span>
                <span class="tag-count">${cards.length}</span>
            </label>`;
        });

    document.getElementById("tagChoices").innerHTML =
        html;

    document.getElementById("tagControls").hidden = false;
    document.getElementById("tagSearch").value = "";

    showAllTags = false;

    filterTagChoices();
    renderTagSummary();
}

function filterTagChoices() {

    const search =
        document.getElementById("tagSearch")
            .value.trim().toLowerCase().replace(/\s+/g, "-");

    const labels =
        document.querySelectorAll("#tagChoices label");

    labels.forEach((label, i) => {

        const box = label.querySelector("input");

        // Checked tags stay visible so nothing selected is hidden.
        const isListed =
            showAllTags || i < SHORT_TAG_LIST || box.checked;

        label.hidden =
            search ? !box.value.includes(search) : !isListed;
    });

    document.getElementById("tagShowAll").textContent =
        showAllTags ? "Show fewer tags" : `Show all ${labels.length} tags`;
}

function toggleAllTags() {
    showAllTags = !showAllTags;
    filterTagChoices();
}

function clearAllTags() {

    for (const box of document.querySelectorAll("#tagChoices input")) {
        box.checked = false;
    }

    filterTagChoices();
    tagSelectionChanged();
}

function renderTagSummary() {

    const total =
        document.querySelectorAll("#tagChoices input").length;

    document.getElementById("tagSummary").textContent =
        `${selectedTags().length} of ${total} tags selected`;
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
        <rect class="upset-hit" x="${x - columnWidth / 2}" y="0" width="${columnWidth}" height="${height}" onclick="showIntersection(${i})"></rect>`;
    });

    return svg + "</svg>";
}

function showIntersection(index) {

    const { tags, cards } = upsetIntersections[index];

    document.getElementById("upsetCards").innerHTML =
        cardListHtml(`Only ${tags.join(" + ")}`, cards);
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

    const active = selectedNode;

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

    // A collapsed section has no width, so this reruns when it's reopened.
    if (deckResults.length === 0 || width === 0)
        return;
    const scale = window.devicePixelRatio || 1;

    const minShared =
        Number(document.getElementById("forceMinShared").value) || 1;

    const { nodes, links } =
        buildForceGraph(deckResults, selectedTags(), minShared);

    forceNodes = nodes;
    forceLinks = links;
    showForceNode(null);

    canvas.width = width * scale;
    canvas.height = FORCE_HEIGHT * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${FORCE_HEIGHT}px`;

    if (nodes.length > 0) {
        layOutForceGraph(nodes, links, width, FORCE_HEIGHT);
    }

    canvas.onmousemove = event => {
        canvas.style.cursor =
            nodeAt(event.offsetX, event.offsetY) ? "pointer" : "default";
    };

    canvas.onclick = event => {
        showForceNode(nodeAt(event.offsetX, event.offsetY));
        drawForceGraph();
    };

    drawForceGraph();
}

function renderCardGrid() {

    const tags = selectedTags();

    const grid = document.getElementById("cardGrid");

    if (tags.length === 0) {
        grid.innerHTML = "<p>Pick at least one tag to see the grid.</p>";
        return;
    }

    // Sorting on which tags each card has puts similar cards next to each other.
    const rows =
        deckResults
            .map(card => ({
                name: card.name,
                has: tags.map(tag => card.tags.includes(tag))
            }))
            .map(row => ({
                ...row,
                key: row.has.map(Number).join("")
            }))
            .sort(
                (a, b) =>
                    b.key.localeCompare(a.key) ||
                    a.name.localeCompare(b.name)
            );

    let html = "<table><tr><th>Card</th>";

    for (const tag of tags) {
        html += `<th class="grid-tag"><span>${escapeHtml(tag)}</span></th>`;
    }

    html += "</tr>";

    for (const { name, has } of rows) {

        html += `<tr><td class="grid-card">${escapeHtml(name)}</td>`;

        for (const hasTag of has) {

            const cssClass =
                hasTag ? "grid-on" : "grid-off";

            html += `<td class="${cssClass}"></td>`;
        }

        html += "</tr>";
    }

    grid.innerHTML = html + "</table>";
}

function renderTagCharts() {
    renderUpsetPlot();
    renderForceGraph();
    renderCardGrid();
    renderOverlapGroups();
    renderTagCounts();
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
        document.getElementById("cardGrid").innerHTML = "";
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

// The deck list has no id, so it always loads expanded.
function setUpSavedSections() {

    let saved = {};

    try {
        saved = JSON.parse(localStorage.getItem(SAVED_SECTIONS_KEY)) || {};
    } catch {
        saved = {};
    }

    const sections = document.querySelectorAll("details[id]");

    for (const section of sections) {

        if (section.id in saved) {
            section.open = saved[section.id];
        }

        section.addEventListener("toggle", () => {

            saved[section.id] = section.open;

            try {
                localStorage.setItem(SAVED_SECTIONS_KEY, JSON.stringify(saved));
            } catch {
                // The sections still work, they just won't be remembered.
            }
        });
    }
}

setUpSavedSections();
