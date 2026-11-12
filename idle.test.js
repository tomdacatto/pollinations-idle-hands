import assert from "node:assert/strict";
import test from "node:test";
import { messagesFor, observation, parseReply, renderMap } from "./agent.js";
import { classify, repeatedIndexes, summarize } from "./play.js";
import { runIsland } from "./sim.js";
import { applyAction, createWorld, heightAt, pileAt } from "./world.js";

const act = (world, id, action) => applyAction(world, id, action);

test("moving respects water, other agents, and steps of more than one height", () => {
    const world = createWorld(2);
    const a = world.agents[0];
    Object.assign(a, { x: 2, y: 0 });
    assert.equal(act(world, "A", { action: "move", dir: "w" }).note, "water or the edge");
    assert.equal(act(world, "A", { action: "move", dir: "n" }).note, "water or the edge");
    Object.assign(a, { x: 1, y: 3 });
    assert.equal(act(world, "A", { action: "move", dir: "e" }).ok, true, "height 0 to 1 is a step");
    assert.deepEqual([a.x, a.y], [2, 3]);
    assert.equal(act(world, "A", { action: "move", dir: "e" }).ok, true, "height 1 to 2");
    world.agents[1].x = a.x + 1;
    world.agents[1].y = a.y;
    assert.equal(act(world, "A", { action: "move", dir: "e" }).note, "someone is there");
    Object.assign(a, { x: 1, y: 7 });
    world.ground[7][2] = 3;
    assert.equal(act(world, "A", { action: "move", dir: "e" }).note, "too steep");
});

test("picking up, putting down and stacking raise a cell one by one", () => {
    const world = createWorld(1);
    Object.assign(world.agents[0], { x: 1, y: 2 });
    assert.equal(act(world, "A", { action: "pick", dir: "n" }).item, "stone"); // (1,1) holds a stone
    assert.equal(act(world, "A", { action: "pick", dir: "n" }).note, "hands are full");
    assert.equal(act(world, "A", { action: "put", dir: "s" }).pile, 1);
    assert.equal(act(world, "A", { action: "put", dir: "s" }).note, "holding nothing");
    world.agents[0].held = "shell";
    assert.equal(act(world, "A", { action: "put", dir: "s" }).pile, 2);
    assert.deepEqual(pileAt(world, 1, 3), ["stone", "shell"]);
    assert.equal(heightAt(world, 1, 3), 2);
});

test("a throw lands where it is aimed, can hit the ring, and sinks in water", () => {
    const world = createWorld(1);
    Object.assign(world.agents[0], { x: 7, y: 4, held: "stone" });
    const hit = act(world, "A", { action: "throw", dir: "n", dist: 3 });
    assert.equal(hit.hit, true);
    assert.equal(pileAt(world, 7, 1).length, 1);
    Object.assign(world.agents[0], { x: 0, y: 3, held: "shell" });
    const lost = act(world, "A", { action: "throw", dir: "w", dist: 1 });
    assert.equal(lost.lost, true);
    assert.equal(act(world, "A", { action: "throw", dir: "e", dist: 9 }).valid, false);
});

test("the drum sounds only near it, and talk is kept short", () => {
    const world = createWorld(1);
    assert.equal(act(world, "A", { action: "strike" }).ok, false);
    Object.assign(world.agents[0], { x: 4, y: 6 });
    assert.equal(act(world, "A", { action: "strike" }).boom, true);
    act(world, "A", { action: "say", text: "x".repeat(200) });
    assert.equal(world.said[0].text.length, 80);
    assert.equal(act(world, "A", { action: "dance" }).valid, false);
    assert.equal(act(world, "A", null).valid, false);
});

test("parseReply finds the action in plain JSON, fenced JSON and prose around it, and refuses the rest", () => {
    assert.deepEqual(parseReply('{"action":"wait"}'), { action: "wait" });
    assert.deepEqual(parseReply('Sure!\n```json\n{"note":"a {brace}","action":"move","dir":"n"}\n```'), {
        note: "a {brace}",
        action: "move",
        dir: "n",
    });
    assert.equal(parseReply("I would like to wait."), null);
    assert.equal(parseReply('{"action": '), null);
    assert.equal(parseReply("[1,2]"), null);
});

test("the prompt names no goal and shows the map and own history", () => {
    const world = createWorld(2);
    const text = messagesFor(world, "A", ["Round 1: wait -> ok"])
        .map((m) => m.content)
        .join("\n");
    assert.match(text, /Nothing is required of you/);
    assert.doesNotMatch(text, /\b(play|fun|game|goal|build a|explore)\b/i);
    assert.match(observation(world, "A", []), /You have not acted yet/);
    assert.match(text, /Round 1: wait -> ok/);
    assert.equal(renderMap(world).split("\n").length, 9);
    assert.match(renderMap(world), /A/);
});

const ev = (agent, action, result, round = 0) => ({ round, agent, model: "m", action, result });
const ok = (extra = {}) => ({ valid: true, ok: true, height: 0, pile: 0, ...extra });

test("classify names building, climbing, patterns, throwing, drumming, talking, resting and invalid replies", () => {
    const log = [
        ev("A", { action: "put", dir: "n" }, ok({ pile: 2, target: { x: 1, y: 1 } })),
        ev("A", { action: "move", dir: "e" }, ok({ height: 3 })),
        ev("A", { action: "throw", dir: "n", dist: 2 }, ok({ pile: 1, target: { x: 5, y: 5 } })),
        ev("A", { action: "strike" }, ok({ boom: true })),
        ev("A", { action: "say", text: "hi" }, ok()),
        ev("A", { action: "wait" }, ok()),
        ev("A", { action: "move", dir: "n" }, { valid: true, ok: false, note: "water" }),
        ev("A", null, { valid: false, ok: false }),
        ev("A", { action: "move", dir: "s" }, ok({ height: 0 })),
    ];
    assert.deepEqual(
        classify(log).map((e) => e.category),
        ["build", "climb", "sport", "music", "social", "rest", "rest", "invalid", "explore"],
    );
});

test("three lone items in a row make a pattern, but a pile does not", () => {
    const put = (x, y, pile = 1) => ev("A", { action: "put", dir: "here" }, ok({ pile, target: { x, y } }));
    const categories = classify([put(2, 2), put(3, 2), put(4, 2), put(6, 6, 2)]).map((e) => e.category);
    assert.deepEqual(categories, ["explore", "explore", "pattern", "build"]);
});

test("a three step sequence repeated with two different steps is a repeat, a lone repeated step is not", () => {
    assert.deepEqual(
        [...repeatedIndexes(["move:n", "put:here", "wait", "move:n", "put:here", "wait"])].sort(),
        [0, 1, 2, 3, 4, 5],
    );
    assert.equal(repeatedIndexes(["wait", "wait", "wait", "wait", "wait", "wait"]).size, 0);
    assert.equal(repeatedIndexes(["move:n", "put:here", "wait", "move:s", "wait", "say"]).size, 0);
});

test("summarize gives each agent a play share, a highest point and its ring hits", () => {
    const rows = summarize(
        [
            ev("A", { action: "move", dir: "e" }, ok({ height: 3 })),
            ev("A", { action: "wait" }, ok()),
            ev(
                "B",
                { action: "throw", dir: "n", dist: 1 },
                ok({ pile: 1, hit: true, target: { x: 7, y: 1 }, near: ["A"] }),
            ),
        ],
        [
            { id: "A", model: "x" },
            { id: "B", model: "y", out: true },
        ],
    );
    assert.equal(rows[0].play, 0.5);
    assert.equal(rows[0].highest, 3);
    assert.equal(rows[1].hits, 1);
    assert.equal(rows[1].together, 1);
    assert.equal(rows[1].out, true);
});

test("a run applies every agent's action, counts a reply with no JSON as invalid and keeps going", async () => {
    const replies = {
        m1: ['{"action":"move","dir":"e"}', '{"action":"wait"}'],
        m2: ["no idea", '{"action":"say","text":"hello"}'],
    };
    const seen = { m1: 0, m2: 0 };
    const rounds = [];
    const run = await runIsland({
        agents: [
            { id: "A", model: "m1" },
            { id: "B", model: "m2" },
        ],
        rounds: 2,
        ask: async (model) => replies[model][seen[model]++],
        onRound: (r) => rounds.push(r.events.length),
    });
    assert.equal(run.events.length, 4);
    assert.equal(run.snapshots.length, 3);
    assert.deepEqual(rounds, [2, 2]);
    const bad = run.events.find((e) => e.agent === "B" && e.round === 0);
    assert.equal(bad.result.valid, false);
    assert.equal(bad.result.note, "the reply held no JSON object");
    assert.equal(run.snapshots[1].agents[0].x, 2);
    assert.equal(run.snapshots[2].said[0].text, "hello");
});

test("a 402 benches that agent only; a 401 stops the run", async () => {
    const paid = Object.assign(new Error("needs paid Pollen"), { status: 402 });
    const run = await runIsland({
        agents: [
            { id: "A", model: "free" },
            { id: "B", model: "paid" },
        ],
        rounds: 3,
        ask: async (model) => {
            if (model === "paid") throw paid;
            return '{"action":"wait"}';
        },
    });
    assert.equal(run.agents[1].out, true);
    assert.equal(run.events.filter((e) => e.agent === "A").length, 3);
    assert.equal(run.events.filter((e) => e.agent === "B").length, 1, "asked once, then benched");
    assert.equal(run.stopped, null);

    const expired = Object.assign(new Error("Your sign-in expired."), { status: 401 });
    const stopped = await runIsland({
        agents: [{ id: "A", model: "m" }],
        rounds: 3,
        ask: async () => Promise.reject(expired),
    });
    assert.equal(stopped.stopped, "Your sign-in expired.");
    assert.equal(stopped.events.length, 0);
});
