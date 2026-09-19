# Changelog

## Unreleased

- Added configurable dice freezing with stable die IDs, fully-frozen and translation-only physics modes, optional frozen appearance overrides, and partial rerolls that preserve frozen values, transforms and the active dice scale.
- Added collision-driven browser audio for visible dice rolls, with bundled CC0 Kenney samples, impact-sensitive gain, stereo positioning, pitch variation, overlap limiting, first-roll preload protection, user-gesture audio unlocking and custom sample URL support.

## 0.1.0-preview.1 - 2026-09-18

- First packaged prerelease.
- Project renamed from `PartyBeam.DiceKit` to `Dihor.GameKit.Dice`; the package identity is now `@dihor/gamekit-dice`.
- Provides D4, D6, D8, D10, D12 and D20 Three.js dice with cannon-es physics.
- Supports direct physical rolls and optional host-authoritative presimulated rolls.
- Supports configurable dice appearance, fonts, engraving effect, scale, table, camera and lighting.
- Provides replay-safe `DiceRollEvent` transport models and direct/presimulated roll-plan types.
- Includes framework-agnostic overlay and player APIs.
- Splits the package into a small recommended root API plus explicit `/appearance`, `/core`, `/events`, `/overlay` and `/advanced` entry points; the advanced entry preserves the previous full preview surface for migration.
- Includes reproducible npm installs, NodeNext consumer validation and GitHub Pages demo builds.
- Distributed as an MIT-licensed npm `.tgz` artifact through GitHub Prereleases.
