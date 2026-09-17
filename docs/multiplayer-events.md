# Multiplayer dice-roll events

`DiceRollEvent` is a transport-neutral contract for sending an authoritative dice result from a PartyBeam host to clients.

DiceKit does not send the event itself. PartyGameKit, WebSockets, WebRTC, LAN messages or any future transport can carry the JSON payload without DiceKit depending on that transport.

## Host flow

The host owns the logical result. It may also create a physical `RollPlan` for clients that support full DiceKit playback.

```ts
import {
  DiceRoller,
  RollPlanner,
  createDiceRollEvent
} from "@partybeam/dice-kit";

const request = {
  dice: [
    { sides: 8, appearance: { color: "#7b1e1e" } },
    { sides: 20 }
  ],
  modifier: 2,
  reason: "Attack"
} as const;

const roller = new DiceRoller();
const planner = new RollPlanner();

const result = roller.roll(request);
const plan = planner.plan(result);
const event = createDiceRollEvent(result, {
  definitions: request.dice,
  plan
});

const payload = JSON.stringify(event);
// Send `payload` using the application's transport layer.
```

The event contains the result itself. `replay.plan` is optional presentation data and never replaces that result as the source of truth.

## Client flow

A client must not call `DiceRoller` for a host-originated event.

```ts
import {
  DICE_ROLL_REPLAY_VERSION,
  DiceRollPlayer,
  diceRollResultFromEvent,
  type DiceRollEvent
} from "@partybeam/dice-kit";

const event = JSON.parse(payload) as DiceRollEvent;
const authoritativeResult = diceRollResultFromEvent(event);

// Update score/game state from authoritativeResult immediately.

if (event.replay?.version === DICE_ROLL_REPLAY_VERSION) {
  try {
    await player.play(event.replay.plan, {
      appearances: event.dice.map((die) => die.appearance)
    });
  } catch {
    // Presentation failure must not change authoritativeResult.
  }
} else {
  // A lightweight client can show numbers/text only.
}
```

The renderer is optional. A phone, server, test harness or low-power client can consume `rollId`, `dice`, `modifier`, `total` and `reason` without importing or constructing a Three.js renderer.

## Versioning

Current constants:

- `DICE_ROLL_EVENT_VERSION = 1`
- `DICE_ROLL_REPLAY_VERSION = 1`

The top-level event version describes the logical payload contract. The replay version is separate so the physical animation data can evolve without changing the meaning of the authoritative result.

Future replay versions should be added as explicit versioned models rather than silently changing the interpretation of version `1`.

## Determinism and authority

`RollPlan` stores enough initial state to replay the planned animation without rolling again. It does not make cannon-es bit-for-bit deterministic across browsers, CPUs or engine versions.

If a replayed physical simulation differs slightly or cannot be reproduced on a client, the values carried directly in `DiceRollEvent.dice` remain authoritative. A client may fall back to a simpler animation or a textual result.

See [`replay-and-determinism.md`](./replay-and-determinism.md) for seeded planning and replay guarantees.
