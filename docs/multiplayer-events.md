# Multiplayer dice-roll events

`DiceRollEvent` is a transport-neutral contract for sending an authoritative dice result from a game host to clients.

Dihor.GameKit.Dice does not send the event itself. WebSockets, WebRTC, LAN messages or any future transport can carry the JSON payload without Dihor.GameKit.Dice depending on that transport.

## Host flow

The host owns the logical result. It may also create a physical `PresimulatedRollPlan` for clients that support full Dihor.GameKit.Dice playback. Direct physical plans are local playback inputs and cannot be attached as authoritative event replay data.

```ts
import {
  DiceRoller,
  createDiceRollEvent
} from "@dihor/gamekit-dice";
import { RollPlanner } from "@dihor/gamekit-dice/advanced";

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

A client must not call `DiceRoller` for a host-originated event. Values received from JSON or another transport boundary should be validated before use rather than trusted through a TypeScript cast.

```ts
import {
  diceRollResultFromEvent,
  validateDiceRollEvent
} from "@dihor/gamekit-dice/events";

const event = validateDiceRollEvent(JSON.parse(payload));
const authoritativeResult = diceRollResultFromEvent(event);

// Update score/game state from authoritativeResult immediately.

if (event.replay) {
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

`validateDiceRollEvent` rejects unsupported event/replay versions, invalid die types or values, malformed appearance fields, mismatched totals and replay plans that disagree with the authoritative result.

## Resource limits

Transport payload validation also applies an operational envelope before playback work begins. The current limits are exported as `DICE_ROLL_EVENT_LIMITS` so hosts can reject or shape payloads consistently before sending them.

The limits include the runtime dice cap (`MAX_DICE_PER_ROLL`, currently 6), bounded roll/reason strings, bounded appearance strings and asset URLs, a maximum arena polygon size, bounded stability/simulation step counts, supported dice-size and arena extents, and maximum replay position/velocity/angular-velocity magnitudes.

These limits apply to event-driven/network playback. They do not change the direct local appearance API, where the application deliberately controls its own asset URLs and configuration.

## Remote asset policy

Treat appearance URLs received inside a multiplayer event as untrusted input. Before passing event appearances to `DiceRollPlayer`, call `resolveDiceRollEventAppearances()`.

By default, local/relative paths are allowed, while external HTTP(S) origins and non-web schemes such as `data:` or `blob:` are blocked. Applications can explicitly allow known CDN origins, opt in to selected non-web schemes, disable relative paths, or map logical asset IDs to application-owned local assets.

```ts
const appearances = resolveDiceRollEventAppearances(event, {
  allowedOrigins: ["https://cdn.example.com"],
  resolve: (source) => {
    if (source === "theme:marble") {
      return "/assets/themes/marble/die.png";
    }

    return source;
  }
});

await player.play(event.replay.plan, { appearances });
```

For the strictest setup, set `allowRelative: false` and provide a resolver that returns only assets selected by the host application. Returning `undefined` from the resolver rejects the asset.

This policy affects only event-driven appearance resolution. Direct local calls that configure `DiceAppearance` continue to accept application-controlled URLs as before.

The renderer is optional. A phone, server, test harness or low-power client can consume `rollId`, `dice`, `modifier`, `total` and `reason` without importing or constructing a Three.js renderer.

## Versioning

Current constants:

- `DICE_ROLL_EVENT_VERSION = 1`
- `DICE_ROLL_REPLAY_V1_VERSION = 1` for the legacy replay schema
- `DICE_ROLL_REPLAY_VERSION = 2` for the current replay schema

The top-level event version describes the logical payload contract. The replay version is separate so the physical animation data can evolve without changing the meaning of the authoritative result.

Replay v1 remains accepted for older payloads and does not support per-die frozen physics. Replay v2 adds the optional `frozenPhysicsMode` field used by freeze/partial-reroll plans. New events created with replay data use v2. A payload that labels frozen-dice semantics as replay v1 is rejected instead of being silently interpreted differently by older clients.

## Determinism and authority

`PresimulatedRollPlan` stores enough initial state to replay the planned animation without rolling again. `DirectRollPlan` is intentionally excluded from `DiceRollEvent.replay` because its result is only known after visible physics settles. Neither variant makes cannon-es bit-for-bit deterministic across browsers, CPUs or engine versions.

If a replayed physical simulation differs slightly or cannot be reproduced on a client, the values carried directly in `DiceRollEvent.dice` remain authoritative. A client may fall back to a simpler animation or a textual result.

See [`replay-and-determinism.md`](./replay-and-determinism.md) for seeded planning and replay guarantees.
