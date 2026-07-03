# IPC Contract

The bridge has four type-bound participants: renderer, preload, browser mock,
and main handlers. Adding a channel means the compiler + contract test force
every leg:

1. `shared/ipc.ts` — channel constant + `CockpitApi` method + `IpcResultMap`
   entry (completeness guard errors on drift).
2. `shared/schemas.ts` — zod payload schema (the renderer is untrusted input).
3. `registerIpc.ts` — `handle('key', …)`; destructive ops wrap in `guarded()`
   (see [[security-enforcement]]).
4. `electron/preload/index.ts` + `src/lib/mock.ts` — both declared
   `: CockpitApi`, so a missing method is a compile error; the contract test
   (`test/ipc-contract.test.ts`) scans the string wiring the compiler can't see.

Rule of thumb from Phase 2.5: business rules live in `shared/` as pure
functions consumed by BOTH the real service and the mock — never implemented
twice. [[memory-hub]] and the dashboard follow this.
