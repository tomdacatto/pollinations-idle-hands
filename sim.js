// Runs one island: each round every agent is asked at the same moment what it does, then the actions are
// applied one after another by the world's code. `ask(model, messages, {seed})` is the chat call, passed in.
import { historyLine, messagesFor, parseReply } from "./agent.js";
import { applyAction, createWorld, snapshot } from "./world.js";

const HISTORY = 5;

/**
 * @param agents   [{id, model}] in play order
 * @param rounds   how many rounds
 * @param ask      async (model, messages, {seed}) => reply text; a thrown error has an optional numeric `status`
 * @param onStart  called once with a snapshot of the island before anyone has acted
 * @param onRound  called after each round with {round, world (a snapshot), events (this round's), agents}
 * @param signal   an AbortSignal to stop early
 * Returns {events, snapshots, agents}. An agent whose request is refused with 402 (out of Pollen, or a paid-only
 * model) is marked `out` and sits the remaining rounds; the others go on. A 401 stops the whole run.
 */
export async function runIsland({
    agents,
    rounds,
    ask,
    onStart,
    onRound,
    signal,
    seed = () => Math.floor(Math.random() * 1e9),
}) {
    const world = createWorld(agents.map((a) => a.id));
    const roster = agents.map((a) => ({ ...a, out: false, history: [] }));
    const events = [];
    const snapshots = [snapshot(world)];
    let stopped = null;
    onStart?.(snapshots[0]);

    for (let round = 0; round < rounds && !signal?.aborted && !stopped; round++) {
        world.round = round;
        const replies = await Promise.all(
            roster.map(async (agent) => {
                if (agent.out) return { agent, skipped: true };
                try {
                    const text = await ask(agent.model, messagesFor(world, agent.id, agent.history), {
                        seed: seed(),
                        signal,
                    });
                    return { agent, text };
                } catch (error) {
                    if (signal?.aborted) return { agent, skipped: true };
                    return { agent, error };
                }
            }),
        );
        if (signal?.aborted) break;
        const thisRound = [];
        // Apply in a rotating order so no agent always acts first.
        for (let i = 0; i < replies.length; i++) {
            const { agent, text, error, skipped } = replies[(i + round) % replies.length];
            if (skipped) continue;
            if (error?.status === 401) {
                stopped = error.message;
                break;
            }
            if (error?.status === 402) agent.out = true;
            const action = error ? null : parseReply(text);
            const result = applyAction(world, agent.id, action);
            if (error) Object.assign(result, { valid: false, ok: false, note: error.message });
            else if (!action) result.note = "the reply held no JSON object";
            const event = {
                round,
                agent: agent.id,
                model: agent.model,
                action: action ?? null,
                result,
                said: result.text,
            };
            if (error) event.error = error.message;
            events.push(event);
            thisRound.push(event);
            agent.history = [...agent.history, historyLine(round, action, result)].slice(-HISTORY);
        }
        snapshots.push(snapshot(world));
        onRound?.({ round, world: snapshots.at(-1), events: thisRound, agents: roster });
        if (roster.every((a) => a.out)) stopped = "Every agent is out of Pollen or on a paid-only model.";
    }
    return { events, snapshots, agents: roster, stopped };
}
