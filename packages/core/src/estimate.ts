/**
 * Token estimation (chars/4, pi parity — compaction.ts:250-290) and gauge
 * banding (5/15/40, spec F5.2). Estimates are labeled `~` at the UI layer;
 * IMAGE_CHARS mirrors pi's ESTIMATED_IMAGE_CHARS.
 */

import type { AgentMessage, SessionEntry, UserContent } from "./types.ts";
import { isMessageEntry } from "./types.ts";

export const CHARS_PER_TOKEN = 4;
export const IMAGE_CHARS = 4800;

function contentChars(content: UserContent): number {
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of content) {
		if (block.type === "text") chars += block.text.length;
		else if (block.type === "image") chars += IMAGE_CHARS;
	}
	return chars;
}

function messageChars(m: AgentMessage): number {
	switch (m.role) {
		case "user":
			return contentChars(m.content);
		case "assistant": {
			let chars = 0;
			for (const block of m.content) {
				if (block.type === "text") chars += block.text.length;
				else if (block.type === "thinking") chars += block.thinking.length;
				else if (block.type === "toolCall") chars += JSON.stringify(block.arguments ?? {}).length;
			}
			return chars;
		}
		case "toolResult":
			return contentChars(m.content);
		case "bashExecution":
			return m.excludeFromContext ? 0 : m.command.length + m.output.length;
		case "custom":
			return contentChars(m.content);
		case "branchSummary":
			return m.summary.length;
		case "compactionSummary":
			return m.summary.length;
		default:
			return 0;
	}
}

/** Characters this entry contributes to LLM context (0 for non-context entries). */
export function entryChars(e: SessionEntry): number {
	if (isMessageEntry(e)) return messageChars(e.message);
	switch (e.type) {
		case "custom_message":
			return contentChars((e as { content: UserContent }).content);
		case "branch_summary":
			return (e as { summary: string }).summary.length;
		case "compaction":
			return (e as { summary: string }).summary.length;
		default:
			return 0;
	}
}

export function estimateEntryTokens(e: SessionEntry): number {
	return Math.ceil(entryChars(e) / CHARS_PER_TOKEN);
}

export function estimateContextTokens(slice: readonly SessionEntry[]): number {
	let total = 0;
	for (const e of slice) total += estimateEntryTokens(e);
	return total;
}

// ---------------------------------------------------------------------------
// Gauge bands (F5.2): low <5 · healthy 5–15 · filling 15–40 · red >40
// ---------------------------------------------------------------------------

export type Band = "low" | "healthy" | "filling" | "red";

export const BAND_THRESHOLDS = { healthy: 5, filling: 15, red: 40 } as const;

export function band(percent: number): Band {
	if (percent < BAND_THRESHOLDS.healthy) return "low";
	if (percent < BAND_THRESHOLDS.filling) return "healthy";
	if (percent <= BAND_THRESHOLDS.red) return "filling";
	return "red";
}

/** 950 → "950" · 19400 → "19.4k" · 200000 → "200k" */
export function fmtTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
