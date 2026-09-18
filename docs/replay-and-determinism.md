# Seeded rolls and replay

DiceKit separates deterministic game data from best-effort physical presentation.

## Seeded random streams

`SeededRandomProvider` implements the existing `RandomProvider` contract. The same seed and stream name produce the same normalized sample sequence.

Use separate stream names for independent concerns:

```ts
import {
  DiceRoller,
  RollPlanner,
  createSeededRandomProvider
} from "@partybeam/dice-kit";

const seed = "match-2026-09-17";

const roller = new DiceRoller({
  randomProvider: createSeededRandomProvider(seed, "logic")
});

const planner = new RollPlanner({
  randomProvider: createSeededRandomProvider(seed, "physics")
});
```

Keeping `logic` and `physics` separate means changing the number of physical-planning samples does not change the authoritative logical dice result.

A seeded provider is opt-in. Existing callers that do not need deterministic behavior can continue using `DiceRoller`, `RollPlanner` and `DiceOverlay` with their default configuration.

## What is deterministic

For a fixed DiceKit implementation:

- the same seed + stream produces the same `RandomProvider` sample sequence,
- the same logical request with the same logical random stream produces the same die values,
- the same expected result and the same physical random stream produce the same generated `RollInitialState` candidates,
- a successful `PresimulatedRollPlan` contains all initial physical state and simulation configuration needed to replay that planned roll without drawing new random samples.

`rollId` is intentionally separate from seeded dice values. Inject a deterministic `rollIdProvider` if tests or replay files need a repeatable identifier too.

## What is not guaranteed across environments

DiceKit does not promise bit-for-bit identical physics across different browsers, CPUs, JavaScript engines or `cannon-es` versions. Floating-point and engine differences can change the exact path of a visible simulation.

The authoritative game result remains the logical `DiceRollResult`. A replayed client must not replace that result with a different locally simulated value.

## Saving a replay input

`RollPlan` is a discriminated union. `PresimulatedRollPlan` uses `preSimulated: true` and carries authoritative expected face values verified by hidden simulation. `DirectRollPlan` uses `preSimulated: false`, `simulationSteps: 0` and placeholder expected values because visible physics determines the result. Both can be played by `DiceRollPlayer`, but only the presimulated variant is replayable authoritative event data.

A `PresimulatedRollPlan` is JSON-serializable and is the minimal replay animation input. It contains:

- `rollId`,
- die types and expected values,
- position, quaternion, linear velocity and angular velocity for each die,
- physics configuration,
- stabilization configuration.

No rendered animation frames need to be stored.

```ts
const logicalResult = roller.roll(request);
const plan = planner.plan(logicalResult);

const saved = JSON.stringify(plan);
const restored = JSON.parse(saved);

// restored can be passed to DiceRollPlayer.play(restored)
// without rolling or planning again.
```

For long-lived saved replays, applications should also record their own DiceKit/package version next to the plan so they can make an explicit compatibility decision after future physics or geometry changes.
