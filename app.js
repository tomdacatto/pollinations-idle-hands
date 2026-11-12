import { DEFAULT_AGENT_MODELS, DEFAULT_ROUNDS, ROUND_CHOICES } from "./config.js";
import { loadModels } from "./models.js";
import { CATEGORIES, classify, summarize } from "./play.js";
import { chat, clearSession, completeSignIn, getSession, startSignIn } from "./pollen.js";
import { runIsland } from "./sim.js";
import { $, el, money, notice, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";
import { heightAt, isWater, NAMES, SIZE } from "./world.js";

const state = { models: [], agents: [], events: [], snaps: [], controller: null, shown: 0 };
const CALL_TOKENS = { prompt: 900, completion: 120 };

function slotModels() {
    return [...document.querySelectorAll(".slot select")].map((select) => select.value).filter(Boolean);
}

function renderSlots() {
    const box = $("#slots");
    box.replaceChildren();
    const free = state.models.filter((m) => !m.paidOnly);
    const sorted = [...free, ...state.models.filter((m) => m.paidOnly)];
    NAMES.forEach((name, i) => {
        const select = el("select");
        select.append(Object.assign(el("option", "", "(no agent)"), { value: "" }));
        for (const model of sorted)
            select.append(
                Object.assign(el("option", "", `${model.name}${model.paidOnly ? " · paid" : ""}`), {
                    value: model.name,
                }),
            );
        const want = DEFAULT_AGENT_MODELS[i];
        if (state.models.some((m) => m.name === want)) select.value = want;
        select.onchange = estimate;
        const slot = el("label", "slot");
        slot.append(el("span", `badge agent-${name}`, name), select);
        box.append(slot);
    });
}

function estimate() {
    const names = slotModels();
    const rounds = Number($("#rounds").value);
    const cost = names.reduce((sum, name) => {
        const p = state.models.find((m) => m.name === name)?.pricing ?? {};
        return (
            sum +
            rounds *
                (CALL_TOKENS.prompt * Number(p.promptTextTokens ?? 0) +
                    CALL_TOKENS.completion * Number(p.completionTextTokens ?? 0))
        );
    }, 0);
    $("#estimate").textContent = names.length
        ? `${names.length * rounds} turns: about ${money(cost)} Pollen (a rough estimate; models that think first write more).`
        : "Pick at least one model.";
}

function renderGrid(snap) {
    const grid = $("#grid");
    grid.replaceChildren();
    for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
            const water = isWater(snap, x, y);
            const height = water ? -1 : heightAt(snap, x, y);
            const cell = el("div", `cell${water ? " water" : ` h${Math.min(height, 6)}`}`);
            const pile = snap.piles[`${x},${y}`] ?? [];
            if (snap.ring.x === x && snap.ring.y === y) cell.classList.add("ring");
            if (snap.drum.x === x && snap.drum.y === y) cell.classList.add("drum");
            if (!water) cell.append(el("span", "height", String(height)));
            if (pile.length) cell.append(el("span", "pile", pile.map((p) => (p === "stone" ? "●" : "◆")).join("")));
            const agent = snap.agents.find((a) => a.x === x && a.y === y);
            if (agent) cell.append(el("span", `who agent-${agent.id}`, agent.id));
            cell.title = water ? "water" : `(${x},${y}) height ${height}${pile.length ? `, ${pile.join(" + ")}` : ""}`;
            grid.append(cell);
        }
}

function describe(event) {
    const { action, result } = event;
    if (event.error) return `could not act: ${event.error}`;
    if (!action) return `no valid action (${result.note})`;
    const named = [action.action, action.dir, action.dist, action.text && `"${action.text}"`].filter(Boolean).join(" ");
    return `${named}${result.valid && !result.ok ? ` (${result.note})` : ""}${result.hit ? " (hit the ring)" : ""}${result.boom ? " (boom)" : ""}`;
}

function showRound(index) {
    state.shown = index;
    $("#slider").value = String(index);
    $("#round-label").textContent = index === 0 ? "0 (start)" : String(index);
    renderGrid(state.snaps[index]);
    const log = $("#log");
    log.replaceChildren();
    const classified = classify(state.events);
    for (const event of classified.filter((e) => e.round === index - 1)) {
        const line = el("div", "line");
        line.append(
            el("span", `who agent-${event.agent}`, event.agent),
            el("span", `tag cat-${event.category}`, event.category),
        );
        line.append(el("span", "", describe(event)));
        if (event.action?.note) line.append(el("span", "think", ` "${String(event.action.note).slice(0, 160)}"`));
        log.append(line);
    }
    if (!log.children.length)
        log.append(
            el("div", "fine", index === 0 ? "The island before anyone has acted." : "Nothing happened this round."),
        );
    for (const cell of document.querySelectorAll(".tick"))
        cell.classList.toggle("now", Number(cell.dataset.round) === index - 1);
}

function renderTimeline() {
    const box = $("#timeline");
    box.replaceChildren();
    const classified = classify(state.events);
    const rounds = Math.max(0, ...state.events.map((e) => e.round)) + 1;
    for (const agent of state.agents) {
        const row = el("div", "strip");
        row.append(el("span", `who agent-${agent.id}`, agent.id));
        for (let r = 0; r < rounds; r++) {
            const event = classified.find((e) => e.agent === agent.id && e.round === r);
            const tick = el("button", `tick cat-${event?.category ?? "none"}`);
            tick.type = "button";
            tick.dataset.round = String(r);
            tick.title = event
                ? `round ${r + 1}: ${event.category}, ${describe(event)}`
                : `round ${r + 1}: did not act`;
            tick.onclick = () => showRound(r + 1);
            row.append(tick);
        }
        box.append(row);
    }
    const legend = $("#legend");
    if (!legend.children.length)
        for (const c of CATEGORIES) {
            const chip = el("span", `chip cat-${c.id}`, c.title);
            chip.title = c.why;
            legend.append(chip);
        }
}

const pct = (x) => (x === null ? "" : `${Math.round(x * 100)}%`);

function renderSummary() {
    const rows = summarize(state.events, state.agents);
    $("#summary").hidden = !rows.length;
    const table = $("#table");
    table.replaceChildren();
    const head = el("tr");
    const titles = [
        "Agent",
        "Model",
        "Turns",
        "Play share",
        "Repeats",
        "Highest",
        "Tallest pile",
        "Ring hits",
        ...CATEGORIES.map((c) => c.title),
    ];
    for (const title of titles) head.append(el("th", "", title));
    table.append(head);
    for (const row of rows) {
        const tr = el("tr");
        const cells = [
            row.id,
            `${row.model}${row.out ? " (stopped: out of Pollen or paid only)" : ""}`,
            row.turns,
            pct(row.play),
            pct(row.repeat),
            row.highest,
            row.tallest,
            row.hits,
            ...CATEGORIES.map((c) => row.counts[c.id]),
        ];
        for (const cell of cells) tr.append(el("td", "", String(cell)));
        table.append(tr);
    }
}

async function run() {
    if (!getSession()) return startSignIn();
    const names = slotModels();
    if (!names.length) return notice("Pick a model for at least one agent.", "error");
    state.agents = [...document.querySelectorAll(".slot select")]
        .map((select, i) => ({ id: NAMES[i], model: select.value }))
        .filter((a) => a.model);
    state.events = [];
    state.snaps = [];
    notice(null);
    state.controller = new AbortController();
    const { signal } = state.controller;
    const rounds = Number($("#rounds").value);
    $("#run").disabled = true;
    $("#stop").hidden = false;
    $("#legend").replaceChildren();
    $("#island").hidden = false;
    $("#progress").textContent = "Round 1 is being asked…";
    const result = await runIsland({
        agents: state.agents,
        rounds,
        signal,
        ask: (model, messages, options) => chat(model, messages, { ...options, temperature: 1 }),
        onStart: (world) => state.snaps.push(world),
        onRound: ({ round, world, events, agents }) => {
            state.snaps.push(world);
            state.events.push(...events);
            state.agents = agents.map((a) => ({ id: a.id, model: a.model, out: a.out }));
            $("#slider").max = String(state.snaps.length - 1);
            $("#progress").textContent = `${round + 1} of ${rounds} rounds done`;
            renderTimeline();
            renderSummary();
            showRound(state.snaps.length - 1);
        },
    });
    $("#run").disabled = false;
    $("#stop").hidden = true;
    if (result.stopped) notice(result.stopped, "error");
    else if (result.events.some((e) => e.error))
        notice(
            `Some turns failed and count as invalid. The first error: ${result.events.find((e) => e.error).error}`,
            "error",
        );
    renderSession();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = run;
$("#stop").onclick = () => state.controller?.abort();
$("#slider").oninput = (event) => state.snaps.length && showRound(Number(event.target.value));
for (const n of ROUND_CHOICES)
    $("#rounds").append(
        Object.assign(el("option", "", String(n)), { value: String(n), selected: n === DEFAULT_ROUNDS }),
    );
$("#rounds").onchange = estimate;

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        renderSlots();
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
