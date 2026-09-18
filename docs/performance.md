# Performance baselines

The benchmark suite is deliberately separate from correctness tests. It measures repeatable CPU/setup work so performance regressions can be investigated without turning normal unit tests into timing-sensitive checks.

## Run locally

```bash
npm run benchmark
```

This rebuilds the library and runs the benchmark scenarios against the generated package code.

CI runs the same benchmark after the normal library build:

```bash
npm run benchmark:ci
```

It writes `performance-results.json`, which is uploaded as a workflow artifact.

## Scenarios

| Scenario | What it measures | 2026-09-18 reference median | Reference p95 |
| --- | --- | ---: | ---: |
| `direct-d6` | one-D6 direct plan setup | 0.063 ms | 0.129 ms |
| `direct-mixed-3` | D6 + D10 + D20 direct plan setup | 0.029 ms | 0.035 ms |
| `direct-three-d10-max-force` | 3×D10 at maximum throw force | 0.030 ms | 0.051 ms |
| `direct-six-dice` | complete six-die spawn/layout setup | 0.030 ms | 0.038 ms |
| `presimulation-d6-seeded` | deterministic seeded D6 presimulation | 7.536 ms | 16.858 ms |
| `playback-d6-cpu` | DiceRollPlayer prep + physics without WebGL | 4.456 ms | 10.110 ms |
| `playback-mixed-3-cpu` | mixed three-die prep + physics without WebGL | 13.295 ms | 22.057 ms |
| `mesh-d6-pips` | cold D6 pip mesh creation + cleanup | 1.431 ms | 2.072 ms |
| `mesh-d20-numeric` | cold D20 numeric mesh creation + cleanup | 2.235 ms | 3.744 ms |
| `mesh-d10-textured-memory` | D10 texture/resource path with in-memory loader | 1.231 ms | 1.551 ms |

The reference sample above came from a GitHub-hosted Ubuntu runner with Node 22.12. It is a reference point, not a product SLA and not a frame-rate claim.

## CI budgets

The limits in `benchmarks/performance-budgets.json` are intentionally much wider than the reference numbers. They exist only to detect severe regressions such as a planner or mesh setup becoming several times slower.

Do not tighten these limits merely to make the benchmark look stricter. Timing on shared CI hardware varies. A proposed budget change should be based on several runs and should explain whether the production workload changed.

## Reproducibility

Planning inputs are fixed and presimulation uses a named seeded random stream. The benchmark runner performs warm-up samples before collecting measurements and reports median plus p95. Very short direct-planning scenarios use batches so timer resolution does not dominate the result.

Texture preparation uses an in-memory `Texture` loader. It measures library-side resource preparation and cache/mesh work, not network latency. CPU playback uses a deterministic scheduler and a Three.js scene without WebGL, so rendering throughput is intentionally outside this benchmark. Real WebGL/Worker/RAF integration remains covered by the browser smoke suite.
