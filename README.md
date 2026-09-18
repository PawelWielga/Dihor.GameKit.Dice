# Dihor.GameKit.Dice

Reusable 3D dice rolling library for games and applications, built with TypeScript, Three.js and cannon-es.

## Status

The reusable MVP pipeline is implemented: direct physical rolls and worker-backed predetermined physics planning, Three.js rendering, configurable appearance, the framework-agnostic overlay API and the interactive GitHub Pages demo are available. Standard polyhedral dice D4, D6, D8, D10, D12 and D20 are supported, together with opt-in seeded random streams, replayable `RollPlan` inputs and a versioned transport-neutral multiplayer event contract.

## Goals

Dihor.GameKit.Dice provides a framework-agnostic API for rolling configurable 3D dice in games and applications. The logical result is decided by the core layer first, while the visual layer uses a planned physics simulation to present a natural-looking roll that lands on the expected physical face.

The library supports:

- reusable dice rolls across multiple games,
- Three.js rendering,
- cannon-es physics,
- direct physical outcomes decided after visible settling,
- optional predetermined physical outcomes with background presimulation,
- D4, D6, D8, D10, D12 and D20 dice,
- mixed dice types in one roll,
- per-die colors and materials,
- configurable numeric fonts and relative numeral sizing,
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

## Prerelease package

Dihor.GameKit.Dice prereleases follow the `0.1.0-preview.N` convention and are packaged with `npm pack` as a `.tgz` artifact attached to a GitHub Prerelease.

The first release line is:

```text
@dihor/gamekit-dice 0.1.0-preview.1
tag: v0.1.0-preview.1
```

The prerelease workflow validates the manifest and package version, runs the full test/build suite, verifies package contents and MIT license metadata, creates SHA-256 checksums, uploads the npm artifact and creates or updates the matching GitHub Prerelease.

This does **not** publish the package to the public npm registry. The GitHub Release artifact is the distribution channel.

## Development

Install dependencies:

```bash
npm ci
```

Run the local demo:

```bash
npm run dev:demo
```

The demo is served under the same project path used by GitHub Pages:

`http://localhost:5173/Dihor.GameKit.Dice/`

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
npm ci
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
├── advanced.ts  # Explicit opt-in advanced/legacy entry point
└── index.ts     # Small recommended package root
```

DiceOverlay supports two roll pipelines:

```text
presimulated (default)             direct physical
DiceRoller                         DirectRollPlanner
    ↓                                  ↓
authoritative result               visible physics starts
    ↓                                  ↓
background RollPlanner             dice settle
    ↓                                  ↓
visible replay verifies result     top faces become the result
```

Presimulated mode keeps the logical result authoritative and never snaps/remaps a physical face after simulation. Direct mode has no hidden full simulation: the rendered cannon-es run itself decides the returned values.

## Package entry points

The package root is intentionally limited to the APIs needed by normal game integrations: `DiceOverlay`, `DiceRoller`, request/result and appearance models, multiplayer event helpers, supported dice metadata and the public roll-plan union types.

More specialized APIs use explicit subpath exports:

| Entry point | Intended use |
| --- | --- |
| `@dihor/gamekit-dice` | Recommended game-facing API |
| `@dihor/gamekit-dice/appearance` | Appearance defaults, resolvers and validation helpers |
| `@dihor/gamekit-dice/core` | Logical dice helpers, seeded RNG and topology utilities |
| `@dihor/gamekit-dice/events` | Transport-neutral multiplayer event contract |
| `@dihor/gamekit-dice/overlay` | Full overlay API including dependency-injection hooks |
| `@dihor/gamekit-dice/advanced` | Physics, player, renderer, mesh and other supported low-level APIs |

### Preview migration

Before this split, advanced symbols such as `RollPlanner`, `DiceRollPlayer`, `DiceRenderer`, `DiceScene` and `DiceMeshFactory` were imported from the package root. During the preview line, migrate those imports by changing the module path while keeping the symbol names unchanged:

```ts
// Before
import { RollPlanner, DiceRenderer } from "@dihor/gamekit-dice";

// Now
import { RollPlanner, DiceRenderer } from "@dihor/gamekit-dice/advanced";
```

The `/advanced` entry intentionally preserves the previous full preview export surface. New normal game code should prefer the package root and use a specialized subpath only when it needs that layer directly.

## Public API example

A normal game can use `DiceOverlay` for the complete logical → planned → visible roll:

```ts
import { DiceOverlay } from "@dihor/gamekit-dice";

const dice = new DiceOverlay();

const result = await dice.roll({
  dice: [
    {
      sides: 6,
      appearance: {
        color: "#7b1e1e",
        markingsColor: "#f5e6c8",
        font: {
          size: 1.1
        }
      }
    },
    { sides: 8 },
    { sides: 20 }
  ],
  reason: "Attack"
}, {
  throwForce: 1.2,
  preSimulation: true,
  expectedDiceTotal: 0 // Auto; use e.g. 17 to force the dice sum when valid
});

console.log(result.dice);
console.log(result.total);
```

The optional per-roll `throwForce` multiplier accepts values from `0.5` to `1.5` and defaults to `1.0`. In the default `preSimulation: true` mode the logical result remains authoritative and hidden planning runs in a Web Worker when available. Set `preSimulation: false` to skip hidden planning and return the values read from the visible dice after they settle.

For presimulated rolls, `expectedDiceTotal: 0` (or omitting it) means Auto. A positive value forces the sum of the dice before the modifier and must fit the range returned by `getDiceTotalRange(request.dice)`.

Per-roll `diceScale` accepts values from `0.5` to `1.5` and defaults to `1.0`. The scale is written into `RollPlan.physics.diceSize`, so the Three.js mesh and cannon-es collider always use the same effective size. Multiple dice in the roll also scale their default spacing together.

The standard RPG set uses **D6 = 16 mm** as its physical reference baseline. D4, D8, D10, D12 and D20 keep deliberately different relative extents matching the approved physical-set comparison instead of being normalized to the same bounding box. D100/D% is intentionally not part of the supported set.

Numeric markings accept a relative `appearance.font.size` scale from `0.5` to `1.5`; `1` preserves the default look. It works with the bundled font, system font families and fonts loaded from a URL. D6 in the default `dots` mode is intentionally unaffected.

The same appearance model supports a global texture plus optional physical-face texture overrides. Face textures remain attached to the same physical faces throughout planning and playback.

## Seeded rolls and replay

Seeded behavior is opt-in through the existing `RandomProvider` abstraction. Use separate stream names so logical results do not depend on how many random samples physical planning consumes:

```ts
import { DiceRoller } from "@dihor/gamekit-dice";
import { createSeededRandomProvider } from "@dihor/gamekit-dice/core";
import { RollPlanner } from "@dihor/gamekit-dice/advanced";

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

The same seed and stream reproduce the same random sequence and therefore the same logical values or generated planning inputs. `RollPlan` is a discriminated union of `PresimulatedRollPlan` (`preSimulated: true`) and `DirectRollPlan` (`preSimulated: false`). `DiceRollPlayer` accepts both variants, but only a `PresimulatedRollPlan` is authoritative replay data and can be attached to `createDiceRollEvent`. Bit-for-bit identical physics across different browsers, devices or engine versions is intentionally not guaranteed; the logical result remains authoritative.

See [`docs/replay-and-determinism.md`](./docs/replay-and-determinism.md) for the replay contract and determinism guarantees.

## Multiplayer event contract

A host can package the authoritative result and optional replay plan into a JSON-friendly `DiceRollEvent`:

```ts
import { createDiceRollEvent } from "@dihor/gamekit-dice";

const event = createDiceRollEvent(result, {
  definitions: request.dice,
  plan
});

const payload = JSON.stringify(event);
```

Dihor.GameKit.Dice deliberately does not send the payload. WebSockets, WebRTC or another application transport can carry it. Clients reconstruct the logical result with `diceRollResultFromEvent(event)` and must not roll a replacement result locally. `event.replay` is optional presentation data; clients that cannot or do not want to run full physics can display the authoritative values directly.

See [`docs/multiplayer-events.md`](./docs/multiplayer-events.md) for host/client flow, versioning and fallback behavior.

## Demo

The interactive development application lives in `demo/` and is published automatically from `main` through GitHub Pages.

Live demo:

https://pawelwielga.github.io/Dihor.GameKit.Dice/

The Pages workflow builds the demo with `npm run build:demo`, uploads `dist-demo/` as the Pages artifact and deploys it without committing generated files to `/docs`.

## Development principles

- Keep `core` independent from Three.js, cannon-es and the DOM.
- Keep rendering and physics as separate concerns.
- Presimulated mode keeps the game or host authoritative for the logical result; direct mode explicitly delegates the outcome to visible local physics.
- Physics presents a result; it does not decide game logic.
- Keep multiplayer contracts transport-neutral and versioned.
- Do not assume bit-for-bit deterministic physics across browsers or devices.
- Prefer simple, testable abstractions over game-specific behavior.
- Avoid paid commercial dependencies.
- GitHub Actions may be used for CI and GitHub Pages deployment.
- Local build and test commands must remain supported.

See [`AGENTS.md`](./AGENTS.md) for detailed implementation rules.

## External references

Public examples and repositories may be studied to understand general techniques and architectural patterns. Dihor.GameKit.Dice code, geometries, models, textures and assets are implemented independently in this repository. Do not copy external implementation code or assets into the project.

## Roadmap

The implementation roadmap is tracked in GitHub Issues, starting with the MVP roadmap issue.

## License

Dihor.GameKit.Dice is licensed under the MIT License. See [`LICENSE`](./LICENSE).
