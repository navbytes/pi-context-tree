/**
 * Session-state derivation shared by all commands — thin glue over core.
 */

import {
	type ForkInfo,
	type SessionEntry,
	SessionTree,
	contextSlice,
	extractForks,
	nearestOpenFork,
} from "@pi-context-tree/core";
import { type CtxLike, entriesOf, leafIdOf } from "./adapter.ts";

export interface SessionState {
	entries: SessionEntry[];
	tree: SessionTree;
	leafId: string | null;
	forks: ForkInfo[];
	currentFork: ForkInfo | undefined;
}

export function deriveState(ctx: CtxLike): SessionState {
	const entries = entriesOf(ctx);
	const tree = SessionTree.fromEntries(entries);
	const leafId = leafIdOf(ctx) ?? tree.fileLeafId();
	const forks = leafId ? extractForks(tree, leafId) : [];
	const currentFork = leafId ? nearestOpenFork(tree, leafId, forks) : undefined;
	return { entries, tree, leafId, forks, currentFork };
}

/** Context-bearing entries between the fork label (exclusive) and the leaf. */
export function branchEntries(state: SessionState, forkEntryId: string): SessionEntry[] {
	if (!state.leafId) return [];
	const slice = contextSlice(state.tree, state.leafId);
	const idx = slice.findIndex((e) => e.id === forkEntryId);
	// fork entries are `custom` (not context-bearing) so find the position via the tree path instead
	const path = state.tree.pathFromRoot(state.leafId);
	const forkPathIdx = path.findIndex((e) => e.id === forkEntryId);
	if (forkPathIdx === -1) return idx === -1 ? slice : slice.slice(idx + 1);
	const after = new Set(path.slice(forkPathIdx + 1).map((e) => e.id));
	return slice.filter((e) => after.has(e.id));
}
