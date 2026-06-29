/**
 * Renderer feature flags.
 *
 * CHAT_ENABLED — the AI Cockpit chat panel (the right-hand `RightPanel`).
 * Shelved 2026-06-28 while we rethink the concept; it felt unnecessary in
 * daily use. Flip this back to `true` to restore the whole experience: the
 * panel, its floating launcher, and the "Send to AI" hand-off from the logs
 * panel all come back with no other changes needed.
 *
 * Nothing chat-related is deleted — `RightPanel`, the `chat:ask` IPC,
 * `shared/chat-models`, the mock `chat` handler, and the router's `chat`
 * agent all stay intact behind this flag so re-enabling is a one-line change.
 *
 * Typed as `boolean` (not the literal `false`) so both branches keep getting
 * type-checked and never get pruned as dead code.
 */
export const CHAT_ENABLED: boolean = false
