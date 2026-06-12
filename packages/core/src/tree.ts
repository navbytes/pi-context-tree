/**
 * In-memory tree over session entries (id/parentId), mirroring pi's model:
 * - the loaded leaf is the last entry in file order (session-manager.ts:859)
 * - LLM context = path root→leaf, filtered to context-bearing entries,
 *   honoring the LATEST compaction on the path (summary + firstKeptEntryId
 *   forward — buildSessionContext semantics).
 */

import type { CompactionEntry, MessageEntry, SessionEntry } from "./types.ts";
import { isCompactionEntry, isMessageEntry } from "./types.ts";

export class SessionTree {
	private readonly byId = new Map<string, SessionEntry>();
	private readonly childIndex = new Map<string | null, SessionEntry[]>();
	readonly entriesInFileOrder: readonly SessionEntry[];

	private constructor(entries: SessionEntry[]) {
		this.entriesInFileOrder = entries;
		for (const e of entries) {
			this.byId.set(e.id, e);
			const siblings = this.childIndex.get(e.parentId) ?? [];
			siblings.push(e);
			this.childIndex.set(e.parentId, siblings);
		}
	}

	static fromEntries(entries: SessionEntry[]): SessionTree {
		return new SessionTree([...entries]);
	}

	get(id: string): SessionEntry | undefined {
		return this.byId.get(id);
	}

	children(id: string | null): SessionEntry[] {
		return this.childIndex.get(id) ?? [];
	}

	roots(): SessionEntry[] {
		// Entries whose parent is null OR missing from the file (truncation tolerance).
		return this.entriesInFileOrder.filter((e) => e.parentId === null || !this.byId.has(e.parentId));
	}

	/** pi sets the leaf to the last appended entry on load. */
	fileLeafId(): string | null {
		const last = this.entriesInFileOrder[this.entriesInFileOrder.length - 1];
		return last ? last.id : null;
	}

	leaves(): string[] {
		return this.entriesInFileOrder.filter((e) => this.children(e.id).length === 0).map((e) => e.id);
	}

	pathToRoot(id: string): SessionEntry[] {
		const path: SessionEntry[] = [];
		let cur = this.byId.get(id);
		const seen = new Set<string>();
		while (cur) {
			if (seen.has(cur.id)) break; // cycle guard for corrupt files
			seen.add(cur.id);
			path.push(cur);
			cur = cur.parentId ? this.byId.get(cur.parentId) : undefined;
		}
		return path;
	}

	pathFromRoot(id: string): SessionEntry[] {
		return this.pathToRoot(id).reverse();
	}

	isAncestorOrSelf(ancestorId: string, descendantId: string): boolean {
		let cur = this.byId.get(descendantId);
		const seen = new Set<string>();
		while (cur) {
			if (cur.id === ancestorId) return true;
			if (seen.has(cur.id)) return false;
			seen.add(cur.id);
			cur = cur.parentId ? this.byId.get(cur.parentId) : undefined;
		}
		return false;
	}

	depth(id: string): number {
		return Math.max(0, this.pathToRoot(id).length - 1);
	}
}

/** Does this entry contribute text to the LLM context? */
export function bearsContext(e: SessionEntry): boolean {
	if (isMessageEntry(e)) {
		const m = (e as MessageEntry).message;
		if (m.role === "bashExecution" && m.excludeFromContext) return false;
		return true;
	}
	return e.type === "custom_message" || e.type === "branch_summary";
}

/**
 * The entries whose content the model actually sees from `leafId`, in emission
 * order. A compaction entry stands for its summary text and is emitted first,
 * followed by kept entries from firstKeptEntryId forward (pi parity).
 */
export function contextSlice(tree: SessionTree, leafId: string): SessionEntry[] {
	const path = tree.pathFromRoot(leafId);

	let latestCompactionIdx = -1;
	for (let i = path.length - 1; i >= 0; i--) {
		const entry = path[i];
		if (entry && isCompactionEntry(entry)) {
			latestCompactionIdx = i;
			break;
		}
	}

	if (latestCompactionIdx === -1) {
		return path.filter(bearsContext);
	}

	const compaction = path[latestCompactionIdx] as CompactionEntry;
	const firstKeptIdx = path.findIndex((e) => e.id === compaction.firstKeptEntryId);

	const kept: SessionEntry[] = [compaction];
	const from = firstKeptIdx === -1 ? latestCompactionIdx + 1 : firstKeptIdx;
	for (let i = from; i < path.length; i++) {
		const entry = path[i];
		if (!entry || i === latestCompactionIdx) continue;
		if (bearsContext(entry)) kept.push(entry);
	}
	return kept;
}
