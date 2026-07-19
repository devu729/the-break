# TxLINE Anchor IDL

Drop **two** files here before running the worker for real:

1. `txoracle.json` — the current TxLINE `txoracle` program IDL.
2. `txoracle.ts` (or `.d.ts`) — the matching generated TypeScript types.
   TxLINE's own quickstart example imports both together:
   `import type { Txoracle } from "./types/txoracle"` alongside
   `import txoracleIdl from "./idl/txoracle.json"`. Once you have the types
   file, update `client.ts` to use `new anchor.Program<Txoracle>(txoracleIdl as Txoracle, provider)`
   instead of the untyped `anchor.Idl` cast it currently uses as a
   placeholder.

Neither is vendored in this repo because:

1. It's TxODDS's IDL, not ours to redistribute a stale copy of.
2. Anchor program IDLs change; a copy baked in at build time could silently
   drift from the deployed devnet program and produce transactions that
   fail (or worse, succeed against the wrong account layout).

Get it from TxLINE's "Runnable Devnet Examples" page
(https://txline-docs.txodds.com/documentation/examples/devnet-examples)
linked from the Quickstart, which is documented as including "free-tier
activation... examples" with the matching IDL/types for devnet. Confirm the
program ID in the IDL matches `TXLINE_PROGRAM_ID` in your `.env`
(`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` for devnet) before using it.
