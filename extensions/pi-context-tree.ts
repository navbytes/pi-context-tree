/**
 * pi package entry point (loaded via the `pi.extensions` manifest in
 * package.json). The real extension lives in the `@pi-context-tree/extension`
 * package — imported by name so it resolves both in the monorepo (workspace
 * link → packages/extension) and from an npm install (node_modules). Its built
 * deps (`@pi-context-tree/core`, `/tui`) come from `prepare` (monorepo) or are
 * pulled as published deps (npm).
 */

export { default } from "@pi-context-tree/extension";
