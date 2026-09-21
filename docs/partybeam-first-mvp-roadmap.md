# PartyBeam First MVP Dice roadmap

## Role

Dihor.GameKit.Dice provides reusable host-authoritative logical dice results plus physical/Three.js presentation for Grimcellar combat.

For PartyBeam First MVP the game must consume the real Dice package. Grimcellar must not own a second local dice implementation.

Status snapshot: 2026-09-21.

## Current baseline

Grimcellar currently consumes `@dihor/gamekit-dice 0.1.0-preview.2`.

The required Grimcellar MVP workload is intentionally small:

- one combat overlay;
- exactly 2d6;
- manual hold/release mapped to throw force;
- authoritative returned total used by game rules;
- normal cleanup when encounter/session ends.

Later `main` hardening includes Worker-fallback and authoritative partial-reroll fixes. Those fixes do not automatically require a Grimcellar dependency bump unless its real MVP path needs them.

## Ordered PartyBeam First MVP work

### DICE-MVP-01 - keep the current approved prerelease pinned

1. Do not add new dice types/features for Grimcellar MVP.
2. Keep logical result authority separate from visual physics.
3. Keep Grimcellar on preview.2 unless real E2E demonstrates a blocker or a known post-preview fix is required by the exact 2d6 path.

### DICE-MVP-02 - validate real Grimcellar 2d6 combat

During Grimcellar MVP-09 verify on both shared-screen targets:

- Dice overlay opens from a real monster encounter;
- exactly two D6 are rolled;
- manual hold/release produces supported throw-force behavior;
- returned values/total remain authoritative and are not replaced by an unrelated physical outcome;
- >6 victory, =6 defeat and <6 defeat game paths receive the correct total;
- an interrupted/disconnected encounter cannot apply a stale late roll result;
- overlay/resources clean up on encounter/session end;
- representative constrained Android TV behavior is usable.

### DICE-MVP-03 - publish a patch only when needed

If the required E2E path hits a Dice defect:

1. determine whether it is already fixed on `main`;
2. if yes, prepare the smallest new prerelease containing the reviewed fix;
3. otherwise create/fix one focused Dice issue with regression coverage;
4. publish the prerelease;
5. update Grimcellar's exact dependency;
6. rebuild the Grimcellar package because dependency bytes changed;
7. rerun package verification/publication and affected E2E scenarios.

Never patch generated/embedded Dice code directly inside Grimcellar.

### DICE-MVP-04 - defer non-blocking library work

Open refactors, hot-path cleanup, real-browser performance profiling, release-metadata cleanup and branch hygiene are useful but are not ecosystem MVP blockers unless measured real-device validation proves otherwise.

Do not expand MVP with extra visual customization or dice mechanics not required by Grimcellar.

## First MVP DONE criteria for Dice

Dice is sufficient for PartyBeam First MVP when:

- the official Grimcellar package uses the real packaged Dice library;
- the 2d6 combat matrix passes on PC/laptop and Android TV;
- authoritative result semantics survive the actual runtime path;
- no known Dice correctness/performance defect blocks the required workload.

## Post-MVP

Resume generic API/refactor/performance work after the ecosystem vertical slice is complete, guided by the Dice repository backlog rather than Grimcellar-specific feature requests.
