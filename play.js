// What did the agents do? Everything here is counted in code from the log of actions, with no judge model.
// The categories follow the activities the paper "Is this machine playing?" (arXiv 2610.07130) lists for its
// island agent, cut down to what a nine by nine grid can show: building, climbing, patterns on the ground,
// sports with a target, resting. Plus talk and a drum. These are rules of thumb, not a test for play.

export const CATEGORIES = [
    { id: "build", title: "Build", why: "Put or threw an item so that a pile holds two or more.", play: true },
    { id: "climb", title: "Climb", why: "Stepped onto a cell at height 2 or more (the hill, or a stack).", play: true },
    {
        id: "pattern",
        title: "Pattern",
        why: "Placed a lone item in line (a row or column, within 3 cells) with two others placed alone.",
        play: true,
    },
    { id: "sport", title: "Throw", why: "Threw an item; a hit on the ring is counted separately.", play: true },
    { id: "music", title: "Drum", why: "Struck the drum within one step of it.", play: true },
    { id: "social", title: "Talk", why: "Said something to the others.", play: true },
    {
        id: "explore",
        title: "Explore",
        why: "Moved, picked up or put something down without one of the above.",
        play: false,
    },
    { id: "rest", title: "Rest", why: "Waited, or did nothing that changed the world.", play: false },
    {
        id: "invalid",
        title: "Invalid",
        why: "The reply was not an action on the menu (or the request failed).",
        play: false,
    },
];
export const PLAY_IDS = new Set(CATEGORIES.filter((c) => c.play).map((c) => c.id));

const token = (event) => `${event.action?.action ?? "?"}${event.action?.dir ? `:${event.action.dir}` : ""}`;
const cellKey = (c) => `${c.x},${c.y}`;

/** True when the lone item just placed at `target` lines up with two other lone placed items. */
function lined(singles, target) {
    const others = [...singles.keys()]
        .map((k) => k.split(",").map(Number))
        .filter(([x, y]) => x !== target.x || y !== target.y);
    const row = others.filter(([x, y]) => y === target.y && Math.abs(x - target.x) <= 3).length;
    const col = others.filter(([x, y]) => x === target.x && Math.abs(y - target.y) <= 3).length;
    return row >= 2 || col >= 2;
}

/**
 * Adds `category` to each event in order: [{round, agent, model, action, result}] -> same events with a category.
 * Pattern needs the whole log, since it looks at what other placements stand alone.
 */
export function classify(events) {
    const singles = new Map(); // cells where a placed item still stands alone
    return events.map((event) => {
        const { action, result } = event;
        let category = "explore";
        if (!result?.valid) category = "invalid";
        else if (action.action === "wait" || (!result.ok && action.action !== "strike")) category = "rest";
        else if (action.action === "say") category = "social";
        else if (action.action === "strike") category = result.boom ? "music" : "explore";
        else if (action.action === "throw" || action.action === "put") {
            const target = result.target;
            if (result.lost) category = "sport";
            else {
                if (result.pile >= 2) singles.delete(cellKey(target));
                else singles.set(cellKey(target), true);
                if (action.action === "throw") category = "sport";
                else if (result.pile >= 2) category = "build";
                else if (lined(singles, target)) category = "pattern";
            }
            if (action.action === "throw" && result.pile >= 2 && !result.lost) category = "build";
        } else if (action.action === "move" && result.height >= 2) category = "climb";
        return { ...event, category };
    });
}

/** Indexes of an agent's actions that are part of a three-step sequence it repeats, with at least two different steps. */
export function repeatedIndexes(tokens) {
    const flagged = new Set();
    const seen = new Map();
    for (let i = 0; i + 3 <= tokens.length; i++) {
        const gram = tokens.slice(i, i + 3);
        if (new Set(gram).size < 2) continue;
        const id = gram.join(" ");
        const first = seen.get(id);
        if (first === undefined) seen.set(id, i);
        else if (i >= first + 3) for (const j of [first, first + 1, first + 2, i, i + 1, i + 2]) flagged.add(j);
    }
    return flagged;
}

/** One row per agent: its model, counts per category, play share, repeat share, highest point, tallest pile, ring hits. */
export function summarize(events, agents) {
    const classified = classify(events);
    return agents.map((agent) => {
        const mine = classified.filter((e) => e.agent === agent.id);
        const counts = Object.fromEntries(
            CATEGORIES.map((c) => [c.id, mine.filter((e) => e.category === c.id).length]),
        );
        const turns = mine.length;
        const playTurns = mine.filter((e) => PLAY_IDS.has(e.category)).length;
        const repeats = repeatedIndexes(mine.map(token)).size;
        const heights = mine.map((e) => e.result?.height ?? 0);
        return {
            id: agent.id,
            model: agent.model,
            turns,
            counts,
            play: turns ? playTurns / turns : null,
            repeat: turns ? repeats / turns : null,
            highest: Math.max(0, ...heights),
            tallest: Math.max(0, ...mine.map((e) => e.result?.pile ?? 0)),
            hits: mine.filter((e) => e.result?.hit).length,
            together: mine.filter((e) => e.result?.near?.length).length,
            out: Boolean(agent.out),
        };
    });
}
