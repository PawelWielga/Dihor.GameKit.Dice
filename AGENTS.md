# AGENTS.md

Instructions for coding agents working in `Dihor.GameKit.Dice`.

## Project purpose

`Dihor.GameKit.Dice` is a reusable, framework-agnostic TypeScript library for presenting configurable 3D dice rolls in games and applications.

The logical roll result is authoritative and is determined before the visible animation. The physics layer plans and replays a physical roll that lands on the expected physical face. Three.js renders the scene; cannon-es handles physics.

## Architecture boundaries

Keep these layers separate:

```text
src/
├── audio/       # Browser audio driven by visible playback collisions
├── core/        # Domain models, RNG abstraction and logical results
├── physics/     # cannon-es adapter, pre-simulation and RollPlanner
├── three/       # Three.js scene, rendering and dice meshes
├── appearance/  # Colors, materials, textures and themes
├── events/      # Versioned transport-neutral event contracts
├── overlay/     # Framework-agnostic integration/UI overlay
├── advanced.ts  # Explicit opt-in entry point for supported low-level APIs
└── index.ts     # Intentionally small recommended package root
```

### `audio`

- Owns browser-side sound playback and audio asset selection.
- Audio must react only to the visible playback simulation; hidden planning/presimulation stays silent.
- Audio failures, missing Web Audio support and autoplay restrictions must never change or fail a dice result.
- Keep bundled third-party sound provenance and licensing documented.

### `core`

- Must not import `three`, `cannon-es` or browser-only APIs.
- Owns logical dice definitions and roll results.
- Must be unit-testable without DOM/WebGL.
- Physics never decides game logic.

### `physics`

- Owns the cannon-es integration.
- Receives an expected result from `core`.
- May pre-simulate candidate initial states to find a physical roll that lands on the expected face.
- Must use the real physical identity of a face. Do not remap face labels or textures after a roll to fake a result.
- Do not assume bit-for-bit deterministic physics across browsers or devices.

### `three`

- Owns rendering, camera, lighting, scene lifecycle and meshes.
- Must not determine logical results.
- Keep Three.js resources disposable. Geometries, materials, textures, listeners and renderers must be cleaned up explicitly.

### `appearance`

- Owns appearance configuration such as body color, marking color, textures and material parameters.
- A die may have a global texture and optional per-face textures.
- Per-face textures must stay attached to the same physical face throughout the roll.

### `events`

- Owns versioned JSON-friendly contracts such as `DiceRollEvent`.
- May reference logical `core` types and replay-plan types, but must not own game logic or physics execution.
- Must not depend on Three.js, overlay UI, WebSockets, WebRTC or another concrete transport.
- Host-provided logical values remain authoritative. Replay data is optional presentation input only.
- New incompatible replay payloads require an explicit new replay version rather than silently changing an existing version.

### `overlay`

- Must remain framework-agnostic.
- Do not require React, Angular, Vue or another UI framework.
- The intended high-level API is asynchronous and resolves after the roll finishes.

## Roll pipeline

Preserve this direction of dependencies and responsibilities:

```text
DiceRoller
    ↓
logical DiceRollResult / expected values
    ↓
RollPlanner
    ↓
RollPlan / initial physical state
    ↓
visible cannon-es simulation
    ↓
Three.js rendering
    ↓
completed result returned to the caller
```

For multiplayer, the host packages its authoritative logical result and optional `RollPlan` into a transport-neutral event. A client must not generate a replacement logical result locally for a host-originated roll.

Do not implement a system where the random physical outcome becomes authoritative game logic.

## External references and originality

Public repositories, examples, articles and demos may be inspected to learn general concepts, algorithms and architectural patterns.

Rules:

- Do not copy external source code into this repository.
- Do not copy external geometries, models, textures, sounds or other assets.
- Do not port distinctive implementations line-for-line into another language or abstraction.
- Implement project code independently from the requirements and architecture defined here and in GitHub Issues.
- Do not add attribution to external authors merely because their public work was studied as reference material.
- If a future task intentionally introduces third-party code or assets, stop and verify its license and attribution requirements before adding it.

## Dependencies

- Prefer small, maintained dependencies with permissive licenses such as MIT, Apache-2.0 or BSD.
- Do not add paid commercial dependencies.
- Do not add a new runtime dependency when a small project-owned implementation is reasonable.
- Any physics-engine-specific API should stay behind the physics layer rather than leaking into `core`.

## Performance

The library is intended to run on desktop browsers, TVs and potentially weaker devices.

- Avoid unnecessarily high-poly meshes.
- Prefer simple collision geometry separate from visual geometry.
- Keep lighting and shadows configurable.
- Avoid allocations inside render loops where practical.
- Dispose GPU and physics resources when a roll/overlay is destroyed.
- Treat 1–3 simultaneous dice as the MVP baseline, while keeping the architecture extensible.

## Testing

Tests should cover behavior rather than implementation details.

At minimum, add tests when implementing:

- roll range and totals,
- deterministic/fake RNG behavior,
- physical face-to-value mapping,
- stabilization detection,
- RollPlanner success and failure paths,
- resource lifecycle where practical,
- serialization of public/event models.

The demo is useful for visual verification but is not a replacement for automated tests.

## Demo

`demo/` is the interactive development/demo application.

Rules:

- Normal demo usage must go through the same public API used by consuming games.
- Debug-only controls may expose internal diagnostics, but must be clearly separated from public API usage.
- The production demo is published through GitHub Pages.

## GitHub workflow

- Work from GitHub Issues.
- Prefer one focused issue per PR.
- Keep PRs small enough to review properly.
- Do not silently expand an issue with unrelated features.
- Reference the issue in the PR description.
- Do not merge when known correctness problems remain.
- GitHub Actions are allowed in this repository.
- Keep CI workflows focused on reproducible validation such as install, typecheck, tests and builds.
- GitHub Pages deployment may use GitHub Actions rather than committing generated demo output to the repository.
- Do not add workflow secrets or broad write permissions unless a task explicitly requires them.
- Local build and test commands must remain available even when the same checks run in GitHub Actions.

## Code quality

- Use TypeScript for project source.
- Prefer explicit domain types over loosely shaped objects.
- Avoid `any` unless there is a documented interoperability reason.
- Keep public API surface intentionally small.
- Keep Three.js/cannon-es implementation details out of the top-level package API; expose supported low-level APIs through explicit subpaths such as `/advanced`.
- Prefer composition over large classes with mixed responsibilities.
- Document non-obvious math, coordinate-system assumptions and face mappings.
- Fail explicitly when a requested roll cannot be planned instead of returning an incorrect result.

## Naming

Use names that describe responsibility rather than implementation accidents. Current intended vocabulary includes:

- `DiceRoller` for logical result generation,
- `RollPlanner` for finding a physical roll plan,
- `RollPlan` / `RollInitialState` for physical initial conditions,
- `DiceScene` / `DiceRenderer` for Three.js presentation,
- `DiceOverlay` for the high-level reusable overlay,
- `DiceRollEvent` for the versioned host-authoritative multiplayer contract.

These names may evolve through issues/PRs, but keep responsibilities separate even if exact class names change.
