# PartyBeam.DiceKit

Reusable 3D dice rolling library for PartyBeam games, built with TypeScript, Three.js and cannon-es.

## Status

The reusable MVP pipeline is implemented: logical dice results, predetermined physics planning, Three.js rendering, configurable appearance, the framework-agnostic overlay API and the interactive GitHub Pages demo are available. Standard polyhedral dice D4, D6, D8, D10, D12 and D20 are supported, together with opt-in seeded random streams, replayable `RollPlan` inputs and a versioned transport-neutral multiplayer event contract.

## Goals

PartyBeam.DiceKit provides a framework-agnostic API for rolling configurable 3D dice in games and applications. The logical result is decided by the core layer first, while the visual layer uses a planned physics simulation to present a natural-looking roll that lands on the expected physical face.

The library supports:

- reusable dice rolls across multiple games,
- Three.js rendering,
- cannon-es physics,
- predetermined physical outcomes,
- D4, D6, D8, D10, D12 and D20 dice,
- mixed dice types in one roll,
- per-die colors and materials,
- optional global and per-face textures,
- a framework-agnostic overlay API,
- multiple dice in a single roll,
- opt-in deterministic random streams for tests and replays,
- JSON-serializable `RollPlan` replay inputs without stored animation frames,
- versioned host-authoritative `DiceRollEvent` payloads for multiplayer integration,
- an interactive browser demo hosted on GitHub Pages.

## Requirements

- Node.js 22.12+ (or a newer supported Node.js release)
- npm

The baseline follows the current Vitest 5 requirement and also satisfies Vite 8.

## Development

Install dependencies:

```bash
npm install
```

Run the local demo:

```bash
npm run dev:demo
```

The demo is served under the same project path used by GitHub Pages:

`http://localhost:5173/PartyBeam.DiceKit/`

Build the library:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npm run typecheck
```

Build the static demo bundle locally:

```bash
npm run build:demo
```

The deployable static demo is written to `dist-demo/`. You can preview that build locally with:

```bash
npm run preview:demo
```

The generated `dist-demo/` output is not committed to the repository.

## Continuous integration

GitHub Actions are allowed for this repository. Pull requests and pushes to `main` should run the same validation that remains available locally:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run build:demo
```

CI is a safety net, not a replacement for local validation when developing changes.

## Architecture

The project is split into independent layers:

```text
src/
├── core/        # Public domain models and logical dice results
├── physics/     # cannon-es integration and predetermined roll planning
├── three/       # Three.js scene, renderer and dice meshes
├── appearance/  # Colors, materials, textures and themes
├── events/      # Versioned transport-neutral event contracts
├── overlay/     # Framework-agnostic user-facing overlay
└── index.ts     # Public package entry point
```

The roll pipeline is:

```text
DiceRoller
    ↓
logical result
    ↓
RollPlanner
    ↓
pre-simulation with cannon-es
    ↓
RollPlan
    ↓
visible cannon-es simulation + Three.js rendering
    ↓
DiceRollResult
```

The physical face itself must land on the expected value. The implementation must not fake the final result by rotating the die after the simulation or remapping face labels/textures after the roll.

## Public API example

A normal game can use `DiceOverlay` for the complete logical → planned → visible roll:

```ts
import { DiceOverlay } from "@partybeam/dice-kit";

const dice = new DiceOverlay();

const result = await dice.roll({
  dice: [
    {
      sides: 6,
      appearance: {
        color: "#7b1e1e",
        markingsColor: "#f5e6c8"
      }
    },
    { sides: 8 },
    { sides: 20 }
  ],
  reason: "Attack"
}, {
  throwForce: 1.2
});

console.log(result.dice);
console.log(result.total);
```

The optional per-roll `throwForce` multiplier accepts values from `0.5` to `1.5` and defaults to `1.0`. It changes initial linear and angular velocity only; the logical result is still decided first and remains authoritative.

The same appearance model supports a global texture plus optional physical-face texture overrides. Face textures remain attached to the same physical faces throughout planning and playback.

## Seeded rolls and replay

Seeded behavior is opt-in through the existing `RandomProvider` abstraction. Use separate stream names so logical results do not depend on how many random samples physical planning consumes:

```ts
import {
  DiceRoller,
  RollPlanner,
  createSeededRandomProvider
} from "@partybeam/dice-kit";

const seed = "match-42";

const roller = new DiceRoller({
  randomProvider: createSeededRandomProvider(seed, "logic")
});

const planner = new RollPlanner({
  randomProvider: createSeededRandomProvider(seed, "physics")
});

const result = roller.roll({ dice: [{ sides: 20 }] });
const plan = planner.plan(result);
const savedPlan = JSON.stringify(plan);
```

The same seed and stream reproduce the same random sequence and therefore the same logical values or generated planning inputs. A saved `RollPlan` can be passed back to `DiceRollPlayer` without rolling or planning again. Bit-for-bit identical physics across different browsers, devices or engine versions is intentionally not guaranteed; the logical result remains authoritative.

See [`docs/replay-and-determinism.md`](./docs/replay-and-determinism.md) for the replay contract and determinism guarantees.

## Multiplayer event contract

A host can package the authoritative result and optional replay plan into a JSON-friendly `DiceRollEvent`:

```ts
import { createDiceRollEvent } from "@partybeam/dice-kit";

const event = createDiceRollEvent(result, {
  definitions: request.dice,
  plan
});

const payload = JSON.stringify(event);
```

DiceKit deliberately does not send the payload. PartyGameKit, WebSockets, WebRTC or another application transport can carry it. Clients reconstruct the logical result with `diceRollResultFromEvent(event)` and must not roll a replacement result locally. `event.replay` is optional presentation data; clients that cannot or do not want to run full physics can display the authoritative values directly.

See [`docs/multiplayer-events.md`](./docs/multiplayer-events.md) for host/client flow, versioning and fallback behavior.

## Demo

The interactive development application lives in `demo/` and is published automatically from `main` through GitHub Pages.

Live demo:

https://pawelwielga.github.io/PartyBeam.DiceKit/

The Pages workflow builds the demo with `npm run build:demo`, uploads `dist-demo/` as the Pages artifact and deploys it without committing generated files to `/docs`.

## Development principles

- Keep `core` independent from Three.js, cannon-es and the DOM.
- Keep rendering and physics as separate concerns.
- The game or host is authoritative for the logical result.
- Physics presents a result; it does not decide game logic.
- Keep multiplayer contracts transport-neutral and versioned.
- Do not assume bit-for-bit deterministic physics across browsers or devices.
- Prefer simple, testable abstractions over game-specific behavior.
- Avoid paid commercial dependencies.
- GitHub Actions may be used for CI and GitHub Pages deployment.
- Local build and test commands must remain supported.

See [`AGENTS.md`](./AGENTS.md) for detailed implementation rules.

## External references

Public examples and repositories may be studied to understand general techniques and architectural patterns. PartyBeam.DiceKit code, geometries, models, textures and assets are implemented independently in this repository. Do not copy external implementation code or assets into the project.

## Roadmap

The implementation roadmap is tracked in GitHub Issues, starting with the MVP roadmap issue.

## License

License terms for PartyBeam.DiceKit will be defined before the first public package release.
