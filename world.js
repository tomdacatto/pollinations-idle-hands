// A tiny island, stepped by plain code: no model decides what happens in the world.
// Heights, one held item per agent, stackable stones and shells, a ring to aim at and a drum.

export const SIZE = 9;
export const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
export const ACTIONS = ["move", "pick", "put", "throw", "strike", "say", "wait"];
export const NAMES = ["A", "B", "C", "D"];

// Ground heights; "~" is water. The hill in the middle is three steps high.
const TERRAIN = [
    "~~.......",
    "~........",
    "...111...",
    "..12221..",
    "..12321..",
    "..12221..",
    "...111...",
    "........~",
    ".......~~",
];
const STONES = [
    [1, 1],
    [7, 2],
    [1, 5],
    [6, 7],
    [3, 1],
    [7, 5],
];
const SHELLS = [
    [0, 7],
    [8, 0],
    [5, 1],
];
const STARTS = [
    [1, 3],
    [7, 3],
    [1, 7],
    [5, 7],
];
const RING = [7, 1];
const DRUM = [4, 7];

const key = (x, y) => `${x},${y}`;
const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** `who` is a count of agents, or the list of their ids (the first ids start in the first places). */
export function createWorld(who = 4) {
    const ids = typeof who === "number" ? NAMES.slice(0, who) : who;
    const ground = TERRAIN.map((row) => [...row].map((c) => (c === "~" ? -1 : Number(c === "." ? 0 : c))));
    const piles = {};
    for (const [x, y] of STONES) piles[key(x, y)] = ["stone"];
    for (const [x, y] of SHELLS) piles[key(x, y)] = ["shell"];
    return {
        ground,
        piles,
        ring: { x: RING[0], y: RING[1] },
        drum: { x: DRUM[0], y: DRUM[1] },
        agents: ids.map((id, i) => ({ id, x: STARTS[i][0], y: STARTS[i][1], held: null })),
        said: [],
        round: 0,
    };
}

export const isWater = (world, x, y) => !inside(x, y) || world.ground[y][x] < 0;
export const pileAt = (world, x, y) => world.piles[key(x, y)] ?? [];
/** Height of a cell: the ground plus what is stacked on it. */
export const heightAt = (world, x, y) => (isWater(world, x, y) ? -1 : world.ground[y][x] + pileAt(world, x, y).length);
const agentAt = (world, x, y) => world.agents.find((a) => a.x === x && a.y === y);

const aim = (action) => (action.dir in DIRS ? DIRS[action.dir] : null);

function addToPile(world, x, y, item) {
    world.piles[key(x, y)] = [...pileAt(world, x, y), item];
    return world.piles[key(x, y)].length;
}

/**
 * Applies one agent's action to `world` (changed in place) and returns what happened as plain data:
 * {valid, ok, note, at, height, pile, hit, boom, near}. `valid` is false when the action was not
 * understood; `ok` is false when it was understood but did nothing (a wall, nothing to pick up).
 */
export function applyAction(world, agentId, action) {
    const agent = world.agents.find((a) => a.id === agentId);
    const result = { valid: true, ok: true, note: "", pile: 0, hit: false, boom: false };
    const done = (patch = {}) => {
        const near = world.agents.filter(
            (o) => o !== agent && Math.abs(o.x - agent.x) <= 1 && Math.abs(o.y - agent.y) <= 1,
        );
        return {
            ...result,
            ...patch,
            at: { x: agent.x, y: agent.y },
            height: heightAt(world, agent.x, agent.y),
            near: near.map((o) => o.id),
        };
    };
    if (!action || !ACTIONS.includes(action.action))
        return done({ valid: false, ok: false, note: "not an action on the menu" });

    switch (action.action) {
        case "wait":
            return done();
        case "say": {
            const text = String(action.text ?? "")
                .trim()
                .slice(0, 80);
            if (!text) return done({ valid: false, ok: false, note: "say needs text" });
            world.said.push({ round: world.round, from: agent.id, text });
            return done({ text });
        }
        case "move": {
            const d = aim(action);
            if (!d) return done({ valid: false, ok: false, note: "move needs dir n, s, e or w" });
            const [x, y] = [agent.x + d[0], agent.y + d[1]];
            if (isWater(world, x, y)) return done({ ok: false, note: "water or the edge" });
            if (agentAt(world, x, y)) return done({ ok: false, note: "someone is there" });
            if (heightAt(world, x, y) - heightAt(world, agent.x, agent.y) > 1)
                return done({ ok: false, note: "too steep" });
            agent.x = x;
            agent.y = y;
            return done();
        }
        case "pick": {
            const d = action.dir === "here" ? [0, 0] : aim(action);
            if (!d) return done({ valid: false, ok: false, note: "pick needs dir here, n, s, e or w" });
            if (agent.held) return done({ ok: false, note: "hands are full" });
            const [x, y] = [agent.x + d[0], agent.y + d[1]];
            const pile = pileAt(world, x, y);
            if (!pile.length) return done({ ok: false, note: "nothing there" });
            agent.held = pile.at(-1);
            world.piles[key(x, y)] = pile.slice(0, -1);
            return done({ item: agent.held });
        }
        case "put": {
            const d = action.dir === "here" ? [0, 0] : aim(action);
            if (!d) return done({ valid: false, ok: false, note: "put needs dir here, n, s, e or w" });
            if (!agent.held) return done({ ok: false, note: "holding nothing" });
            const [x, y] = [agent.x + d[0], agent.y + d[1]];
            if (isWater(world, x, y)) return done({ ok: false, note: "that is water" });
            const item = agent.held;
            agent.held = null;
            return done({ item, pile: addToPile(world, x, y, item), target: { x, y } });
        }
        case "throw": {
            const d = aim(action);
            const dist = Math.round(Number(action.dist));
            if (!d || !(dist >= 1 && dist <= 3))
                return done({ valid: false, ok: false, note: "throw needs dir and dist 1 to 3" });
            if (!agent.held) return done({ ok: false, note: "holding nothing" });
            const [x, y] = [agent.x + d[0] * dist, agent.y + d[1] * dist];
            const item = agent.held;
            agent.held = null;
            if (isWater(world, x, y))
                return done({ item, note: "it splashed into the water", target: { x, y }, lost: true });
            const pile = addToPile(world, x, y, item);
            return done({ item, pile, target: { x, y }, hit: x === world.ring.x && y === world.ring.y });
        }
        case "strike": {
            const near = Math.abs(world.drum.x - agent.x) <= 1 && Math.abs(world.drum.y - agent.y) <= 1;
            return near ? done({ boom: true }) : done({ ok: false, note: "the drum is not within one step" });
        }
        default:
            return done({ valid: false, ok: false });
    }
}

/** Everything an observer needs to draw the world: a copy that later changes cannot touch. */
export const snapshot = (world) => structuredClone({ ...world, said: world.said.slice(-8) });
