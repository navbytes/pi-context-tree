/**
 * ctree semantics over a SessionTree: fork extraction, status derivation,
 * tournament siblings, nearest-open-fork, decisions listing.
 *
 * status      = open | squashed | rejected | discarded   (from close markers)
 * presentation = active | dangling | squashed | rejected (panel color, F4.3)
 *   active   = open and the fork is an ancestor-or-self of the current leaf
 *   dangling = open and off the current path
 *   discarded renders with the rejected color but keeps its own status.
 */

import type { SessionTree } from "./tree.ts";
import type {
	CtreeCloseData,
	CtreeCloseStatus,
	CtreeForkData,
	CustomEntry,
	CustomMessageEntry,
	SessionEntry,
} from "./types.ts";
import { CTREE_DECISION, CTREE_FORK, ctreeCloseData, ctreeForkData, isCustomMessageEntry } from "./types.ts";

export type ForkStatus = "open" | CtreeCloseStatus;
export type ForkPresentation = "active" | "dangling" | "squashed" | "rejected";

export interface ForkInfo {
	entryId: string;
	entry: CustomEntry;
	data: CtreeForkData;
	close?: { entryId: string; data: CtreeCloseData };
	status: ForkStatus;
	presentation: ForkPresentation;
	onCurrentPath: boolean;
	/** 1-based nesting depth: number of fork entries on root→fork path. */
	depth: number;
}

export function extractForks(tree: SessionTree, leafId: string): ForkInfo[] {
	const closes = new Map<string, { entryId: string; data: CtreeCloseData }>();
	for (const e of tree.entriesInFileOrder) {
		const close = ctreeCloseData(e);
		if (close) closes.set(close.forkEntryId, { entryId: e.id, data: close }); // later wins
	}

	const forks: ForkInfo[] = [];
	for (const e of tree.entriesInFileOrder) {
		const data = ctreeForkData(e);
		if (!data) continue;
		const close = closes.get(e.id);
		const status: ForkStatus = close ? close.data.status : "open";
		const onCurrentPath = tree.isAncestorOrSelf(e.id, leafId);
		const presentation: ForkPresentation =
			status === "open" ? (onCurrentPath ? "active" : "dangling") : status === "squashed" ? "squashed" : "rejected";
		const depth = tree.pathToRoot(e.id).filter((p) => ctreeForkData(p)).length;
		forks.push({ entryId: e.id, entry: e as CustomEntry, data, close, status, presentation, onCurrentPath, depth });
	}
	return forks;
}

/** Open forks sharing the given fork's parentEntryId (tournament set), excluding itself. */
export function siblingForks(forks: ForkInfo[], forkEntryId: string): ForkInfo[] {
	const self = forks.find((f) => f.entryId === forkEntryId);
	if (!self) return [];
	return forks.filter(
		(f) => f.entryId !== forkEntryId && f.status === "open" && f.data.parentEntryId === self.data.parentEntryId,
	);
}

/** Closest open fork walking leaf→root; undefined when on a clean trunk (F2.1). */
export function nearestOpenFork(tree: SessionTree, leafId: string, forks: ForkInfo[]): ForkInfo | undefined {
	const byId = new Map(forks.map((f) => [f.entryId, f]));
	for (const entry of tree.pathToRoot(leafId)) {
		const fork = byId.get(entry.id);
		if (fork?.status === "open") return fork;
	}
	return undefined;
}

/** ctree/decision records visible from the leaf, in root→leaf order (F7). */
export function decisionsOnPath(tree: SessionTree, leafId: string): CustomMessageEntry[] {
	return tree
		.pathFromRoot(leafId)
		.filter((e): e is CustomMessageEntry => isCustomMessageEntry(e) && e.customType === CTREE_DECISION);
}

/** All ctree/fork entries in file order (forest + panel listing). */
export function forkEntries(entries: readonly SessionEntry[]): CustomEntry[] {
	return entries.filter((e): e is CustomEntry => Boolean(ctreeForkData(e)));
}

export { CTREE_FORK };
