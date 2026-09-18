# Public API compatibility contract

Dihor.GameKit.Dice keeps a checked-in compatibility contract for every supported package entry point.

The contract protects two things:

- the public package paths declared in `package.json#exports`,
- every named export from each entry point, including whether it is a runtime value or a TypeScript-only type.

The checked-in snapshot lives in `tests/public-api-contract.json`. The checker is `scripts/check-public-api-contract.mjs`.

## Check the contract

Run:

```bash
npm run test:api-contract
```

The normal `npm test` command runs this check after the Vitest suite, so CI and prerelease validation fail when the supported API surface changes unexpectedly.

The checker also rejects wildcard exports from public entry points. Public API changes should remain explicit and reviewable.

## Intentional API changes

When a public API change is deliberate:

1. change the implementation or package entry points,
2. run `npm run update:api-contract`,
3. inspect the diff in `tests/public-api-contract.json`,
4. update the NodeNext consumer fixture when an entry point or expected consumer pattern changes,
5. update README, migration notes and CHANGELOG when the change affects consumers,
6. commit the implementation and contract update in the same PR.

Do not update the snapshot only to make CI green. The snapshot diff is part of the API review.

## Versioning policy

During the `0.1.0-preview.*` line, deliberate breaking changes are allowed while the API is still being shaped, but they must be explicit in the contract diff and documented for consumers.

After a stable release:

- compatible additions belong in a minor release,
- compatible fixes belong in a patch release,
- removals, renames and type/value contract changes require a major release,
- deprecate an API before removing it when practical.

The `/advanced` entry point is supported, but its larger surface means changes there should receive the same explicit compatibility review as changes to the recommended root API.
