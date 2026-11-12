// What a model is told, and how its reply becomes an action. The instruction names no goal, task or activity:
// only the body, the world's rules and the menu. Following the paper "Is this machine playing?" (arXiv 2610.07130).
import { heightAt, isWater, SIZE } from "./world.js";

export const SYSTEM = `You are the mind of a body on a small island. Nothing is required of you.
Each turn you see the island and choose exactly one action. Reply with one JSON object and nothing else:
{"note": "a few words, optional", "action": "<name>", ...}
The island has stones and shells you can carry, a ring painted on the ground (it cannot be lifted) and a drum.
Actions:
- {"action":"move","dir":"n|s|e|w"}  one step (n is up the map). You cannot step into water, onto another agent, or up more than 1 height.
- {"action":"pick","dir":"here|n|s|e|w"}  take the top item of that cell. You carry one item.
- {"action":"put","dir":"here|n|s|e|w"}  set your item on that cell, on top of what is there. Stacked items raise the cell by 1 each.
- {"action":"throw","dir":"n|s|e|w","dist":1-3}  throw your item that many cells.
- {"action":"strike"}  hit the drum, if it is within one step.
- {"action":"say","text":"..."}  say something the others will read (80 characters at most).
- {"action":"wait"}  do nothing.`;

/** A text map: digits are cell heights (ground plus stacked items), ~ is water, letters are agents, R the ring, D the drum. */
export function renderMap(world) {
    const rows = [];
    for (let y = 0; y < SIZE; y++) {
        let row = "";
        for (let x = 0; x < SIZE; x++) {
            const agent = world.agents.find((a) => a.x === x && a.y === y);
            if (agent) row += agent.id;
            else if (isWater(world, x, y)) row += "~";
            else if (world.ring.x === x && world.ring.y === y) row += "R";
            else if (world.drum.x === x && world.drum.y === y) row += "D";
            else row += heightAt(world, x, y);
        }
        rows.push(row);
    }
    return rows.join("\n");
}

const describePiles = (world) =>
    Object.entries(world.piles)
        .filter(([, pile]) => pile.length)
        .map(([cell, pile]) => `${pile.join("+")} at (${cell})`)
        .join("; ") || "none";

/** What one agent sees at the start of a round. `history` is its own last actions, as short lines. */
export function observation(world, agentId, history) {
    const me = world.agents.find((a) => a.id === agentId);
    const others = world.agents
        .filter((a) => a !== me)
        .map((a) => `${a.id} at (${a.x},${a.y})${a.held ? ` holding a ${a.held}` : ""}`)
        .join("; ");
    const heard = world.said.filter((s) => s.round >= world.round - 3).map((s) => `${s.from}: ${s.text}`);
    return [
        `Round ${world.round + 1}. You are ${me.id}, at (${me.x},${me.y}) on height ${heightAt(world, me.x, me.y)}, ${me.held ? `holding a ${me.held}` : "holding nothing"}.`,
        `Map (x to the right, y down, 0 at the top left):\n${renderMap(world)}`,
        `Items on the ground: ${describePiles(world)}. Ring at (${world.ring.x},${world.ring.y}). Drum at (${world.drum.x},${world.drum.y}).`,
        `Others: ${others}.`,
        heard.length ? `Heard recently:\n${heard.join("\n")}` : "Heard recently: nothing.",
        history.length ? `Your last actions:\n${history.join("\n")}` : "You have not acted yet.",
        "Your action:",
    ].join("\n\n");
}

export const messagesFor = (world, agentId, history) => [
    { role: "system", content: SYSTEM },
    { role: "user", content: observation(world, agentId, history) },
];

/** The first balanced {...} in a reply, parsed; null when there is none or it is not valid JSON. Replies may wrap it in prose or code fences. */
export function parseReply(text) {
    const s = String(text ?? "");
    for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
        let depth = 0;
        let inString = false;
        for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (inString) {
                if (c === "\\") i++;
                else if (c === '"') inString = false;
            } else if (c === '"') inString = true;
            else if (c === "{") depth++;
            else if (c === "}" && --depth === 0) {
                try {
                    const value = JSON.parse(s.slice(start, i + 1));
                    if (value && typeof value === "object" && !Array.isArray(value)) return value;
                } catch {}
                break;
            }
        }
    }
    return null;
}

/** One line for an agent's own history: what it did and what came of it. */
export function historyLine(round, action, result) {
    const named = action?.action
        ? `${action.action}${action.dir ? ` ${action.dir}` : ""}${action.dist ? ` ${action.dist}` : ""}${action.text ? ` "${action.text}"` : ""}`
        : "(no valid action)";
    const outcome = !result.valid
        ? "not an action on the menu"
        : result.ok
          ? result.boom
              ? "boom"
              : result.hit
                ? "hit the ring"
                : "ok"
          : result.note;
    return `Round ${round + 1}: ${named} -> ${outcome}`;
}
