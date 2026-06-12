/**
 * Plain-text serialization of session entries — used by the merge drafting
 * prompt (with pi-parity per-entry truncation) and by crop reconstruction.
 */

import type { SessionEntry, UserContent } from "./types.ts";
import { isMessageEntry } from "./types.ts";

export function textOfContent(content: UserContent): string {
	if (typeof content === "string") return content;
	return content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
}

/** Role-prefixed single-entry rendering; undefined for entries with no text. */
export function serializeEntry(e: SessionEntry): string | undefined {
	if (isMessageEntry(e)) {
		const m = e.message;
		switch (m.role) {
			case "user":
				return `user: ${textOfContent(m.content)}`;
			case "assistant": {
				const parts: string[] = [];
				for (const b of m.content) {
					if (b.type === "text" && b.text.trim()) parts.push(b.text);
					else if (b.type === "toolCall") parts.push(`→ ${b.name} ${JSON.stringify(b.arguments ?? {})}`);
				}
				return parts.length ? `assistant: ${parts.join("\n")}` : undefined;
			}
			case "toolResult":
				return `[${m.toolName}]: ${textOfContent(m.content)}`;
			case "bashExecution":
				return m.excludeFromContext ? undefined : `[bash $ ${m.command}]: ${m.output}`;
			case "custom":
				return `[${m.customType}]: ${textOfContent(m.content)}`;
			case "branchSummary":
				return `[branch summary]: ${m.summary}`;
			case "compactionSummary":
				return `[compaction summary]: ${m.summary}`;
			default:
				return undefined;
		}
	}
	switch (e.type) {
		case "custom_message":
			return `[${(e as { customType: string }).customType}]: ${textOfContent((e as { content: UserContent }).content)}`;
		case "branch_summary":
			return `[branch summary]: ${(e as { summary: string }).summary}`;
		case "compaction":
			return `[compaction summary]: ${(e as { summary: string }).summary}`;
		default:
			return undefined;
	}
}

export interface SerializeOptions {
	/** cap each entry's text (pi's summarizer uses 2000 chars for tool results) */
	perEntryCap?: number;
}

export function serializeEntries(entries: readonly SessionEntry[], opts: SerializeOptions = {}): string {
	const cap = opts.perEntryCap;
	const parts: string[] = [];
	for (const e of entries) {
		let s = serializeEntry(e);
		if (s === undefined) continue;
		if (cap !== undefined && s.length > cap) s = `${s.slice(0, cap)}…(truncated)`;
		parts.push(s);
	}
	return parts.join("\n\n");
}
