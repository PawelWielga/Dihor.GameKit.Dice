# PartyBeam.DiceKit

Reusable 3D dice rolling library for PartyBeam games, built with TypeScript, Three.js and cannon-es.

## Status

The repository is in the bootstrap stage. The package/tooling foundation is available, while dice domain models, rendering, physics planning and the overlay API are implemented in follow-up issues from the MVP roadmap.

## Goals

PartyBeam.DiceKit provides a framework-agnostic API for rolling configurable 3D dice in games and applications. The logical result is decided by the core layer first, while the visual layer uses a planned physics simulation to present a natural-looking roll that lands on the expected physical face.

The library is designed to support:

- reusable dice rolls across multiple games,
- Three.js rendering,
- cannon-es physics,
- predetermined physical outcomes,
- per-die colors and materials,
- optional global and per-face textures,
- a framework-agnostic overlay API,
- multiple dice in a single roll,
- future D4, D6, D8, D10, D12, D20 and D100 support,
- future replay and PartyBeam multiplayer integration,
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

Build the static demo bundle:

```bash
npm run build:demo
```

The bootstrap demo output is written to `dist-demo/`. A later issue will publish that build to GitHub Pages.

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
├── overlay/     # Framework-agnostic user-facing overlay
└── index.ts     # Public package entry point
```

The intended roll pipeline is:

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

## Planned public API

The exact API will be finalized as part of the public API issue, but the intended usage is similar to:

```ts
const result = await diceKit.roll({
  dice: [
    {
      sides: 6,
      appearance: {
        color: "#7b1e1e",
        markingsColor: "#f5e6c8"
      }
    }
  ],
  reason: "Attack"
});

console.log(result.total);
```

## Demo

The interactive development application lives in `demo/`. A later issue will publish its production build to GitHub Pages.

Planned URL:

`https://pawelwielga.github.io/PartyBeam.DiceKit/`

## Development principles

- Keep `core` independent from Three.js, cannon-es and the DOM.
- Keep rendering and physics as separate concerns.
- The game or host is authoritative for the logical result.
- Physics presents a result; it does not decide game logic.
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
