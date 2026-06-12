/**
 * Context-consumer aggregation (panel Consumers view, F4.2): every entry of a
 * context slice lands in exactly one bucket so shares sum to 1.
 */

import { estimateEntryTokens } from "./estimate.ts";
import type { SessionEntry } from "./types.ts";
import { CTREE_CROP_TAIL, CTREE_DECISION, isMessageEntry } from "./types.ts";

export interface ConsumerRow {
	key: string;
	tokens: number;
	entries: number;
	/** fraction of the slice total, 0..1 */
	share: number;
}

function bucketOf(e: SessionEntry): string {
	if (isMessageEntry(e)) {
		const m = e.message;
		switch (m.role) {
			case "user":
				return "user messages";
			case "assistant":
				return "assistant messages";
			case "toolResult":
				return m.toolName;
			case "bashExecution":
				return "bash";
			case "custom":
				return "extension messages";
			case "branchSummary":
				return "branch summaries";
			case "compactionSummary":
				return "compaction summary";
			default:
				return "other";
		}
	}
	switch (e.type) {
		case "custom_message": {
			const t = (e as { customType: string }).customType;
			if (t === CTREE_DECISION) return "decision records";
			if (t === CTREE_CROP_TAIL) return "crop stubs";
			return "extension messages";
		}
		case "branch_summary":
			return "branch summaries";
		case "compaction":
			return "compaction summary";
		default:
			return "other";
	}
}

export function aggregateConsumers(slice: readonly SessionEntry[]): ConsumerRow[] {
	const buckets = new Map<string, { tokens: number; entries: number }>();
	let total = 0;
	for (const e of slice) {
		const tokens = estimateEntryTokens(e);
		if (tokens === 0) continue;
		total += tokens;
		const key = bucketOf(e);
		const agg = buckets.get(key) ?? { tokens: 0, entries: 0 };
		agg.tokens += tokens;
		agg.entries += 1;
		buckets.set(key, agg);
	}
	return [...buckets.entries()]
		.map(([key, { tokens, entries }]) => ({ key, tokens, entries, share: total === 0 ? 0 : tokens / total }))
		.sort((a, b) => b.tokens - a.tokens);
}
