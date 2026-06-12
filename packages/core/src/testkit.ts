/**
 * Deterministic session builders for tests and fixture generation.
 * Mirrors pi's append semantics: every appended entry becomes a child of the
 * current leaf; `at(id)` moves the leaf pointer (= branching).
 */

import type { AgentMessage, CtreeCloseStatus, SessionEntry, SessionHeader, TextContent, ToolCall } from "./types.ts";
import { CTREE_CLOSE, CTREE_CROP, CTREE_DECISION, CTREE_FORK } from "./types.ts";

const BASE_TIME = Date.parse("2026-06-12T00:00:00.000Z");

export interface BuiltSession {
	header: SessionHeader;
	entries: SessionEntry[];
	text: string;
	/** id of the last appended entry (pi's leaf after load) */
	leafId: string;
}

export class SessionBuilder {
	private entries: SessionEntry[] = [];
	private seq = 0;
	private leaf: string | null = null;
	private headerObj: SessionHeader;

	constructor(cwd = "/home/u/project", version = 3) {
		this.headerObj = {
			type: "session",
			version,
			id: "00000000-0000-4000-8000-000000000000",
			timestamp: new Date(BASE_TIME).toISOString(),
			cwd,
		};
	}

	get leafId(): string | null {
		return this.leaf;
	}

	/** Move the leaf pointer; the next append branches from `id`. */
	at(id: string): this {
		this.leaf = id;
		return this;
	}

	private append<T extends Record<string, unknown>>(fields: T & { type: string }, id?: string): string {
		this.seq += 1;
		const entryId = id ?? `e${String(this.seq).padStart(3, "0")}`;
		const entry = {
			...fields,
			id: entryId,
			parentId: this.leaf,
			timestamp: new Date(BASE_TIME + this.seq * 60_000).toISOString(),
		} as unknown as SessionEntry;
		this.entries.push(entry);
		this.leaf = entryId;
		return entryId;
	}

	message(message: AgentMessage, id?: string): string {
		return this.append({ type: "message", message }, id);
	}

	user(text: string, id?: string): string {
		return this.message({ role: "user", content: text }, id);
	}

	assistant(
		text: string,
		opts: { model?: string; provider?: string; toolCalls?: ToolCall[]; id?: string } = {},
	): string {
		const content: (TextContent | ToolCall)[] = [{ type: "text", text }];
		for (const tc of opts.toolCalls ?? []) content.push(tc);
		return this.message(
			{
				role: "assistant",
				content,
				provider: opts.provider ?? "anthropic",
				model: opts.model ?? "opus-4.8",
				// pi's footer sums message.usage.input across ALL assistant entries without
				// guards — sessions missing usage crash the real TUI (found by the PTY walk).
				usage: zeroUsage(),
				stopReason: opts.toolCalls?.length ? "toolUse" : "stop",
			},
			opts.id,
		);
	}

	toolResult(
		toolName: string,
		text: string,
		opts: { toolCallId?: string; isError?: boolean; id?: string } = {},
	): string {
		return this.message(
			{
				role: "toolResult",
				toolCallId: opts.toolCallId ?? `call_${this.seq + 1}`,
				toolName,
				content: [{ type: "text", text }],
				isError: opts.isError ?? false,
			},
			opts.id,
		);
	}

	/** assistant toolCall + matching toolResult pair; returns the result entry id */
	toolUse(toolName: string, args: Record<string, unknown>, resultText: string, opts: { id?: string } = {}): string {
		const callId = `call_${this.seq + 1}`;
		this.message({
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name: toolName, arguments: args }],
			provider: "anthropic",
			model: "opus-4.8",
			usage: zeroUsage(),
			stopReason: "toolUse",
		});
		return this.toolResult(toolName, resultText, { toolCallId: callId, id: opts.id });
	}

	bash(command: string, output: string, id?: string): string {
		return this.message({ role: "bashExecution", command, output, exitCode: 0 }, id);
	}

	modelChange(provider: string, modelId: string, id?: string): string {
		return this.append({ type: "model_change", provider, modelId }, id);
	}

	compaction(summary: string, firstKeptEntryId: string, tokensBefore: number, id?: string): string {
		return this.append({ type: "compaction", summary, firstKeptEntryId, tokensBefore }, id);
	}

	branchSummary(fromId: string, summary: string, id?: string): string {
		return this.append({ type: "branch_summary", fromId, summary }, id);
	}

	label(targetId: string, label: string | undefined, id?: string): string {
		return this.append({ type: "label", targetId, label }, id);
	}

	custom(customType: string, data: unknown, id?: string): string {
		return this.append({ type: "custom", customType, data }, id);
	}

	customMessage(customType: string, content: string, display = true, details?: unknown, id?: string): string {
		return this.append({ type: "custom_message", customType, content, display, details }, id);
	}

	// -- ctree conveniences ---------------------------------------------------

	fork(name: string, opts: { trunkModel?: string; branchModel?: string; id?: string } = {}): string {
		return this.custom(
			CTREE_FORK,
			{
				v: 1,
				name,
				parentEntryId: this.leaf,
				trunkModel: opts.trunkModel ?? "opus-4.8",
				branchModel: opts.branchModel,
				createdAt: BASE_TIME + (this.seq + 1) * 60_000,
				status: "open",
			},
			opts.id,
		);
	}

	close(
		forkEntryId: string,
		status: CtreeCloseStatus,
		opts: { decisionEntryId?: string; note?: string; id?: string } = {},
	): string {
		return this.custom(
			CTREE_CLOSE,
			{ v: 1, forkEntryId, status, decisionEntryId: opts.decisionEntryId, note: opts.note },
			opts.id,
		);
	}

	decision(forkEntryId: string, branchName: string, markdown: string, id?: string): string {
		return this.customMessage(CTREE_DECISION, markdown, true, { v: 1, forkEntryId, branchName }, id);
	}

	crop(
		sourceLeafId: string,
		stubbed: { entryId: string; tool: string; arg?: string; estTokens: number; sha8: string }[],
		id?: string,
	): string {
		return this.custom(CTREE_CROP, { v: 1, sourceLeafId, stubbed }, id);
	}

	build(): BuiltSession {
		const lines = [JSON.stringify(this.headerObj), ...this.entries.map((e) => JSON.stringify(e))];
		const last = this.entries[this.entries.length - 1];
		return {
			header: this.headerObj,
			entries: [...this.entries],
			text: `${lines.join("\n")}\n`,
			leafId: last ? last.id : "",
		};
	}
}

/** Repeated filler so fixtures hit target sizes deterministically. */
export function filler(chars: number, seed = "0123456789abcdef"): string {
	return seed.repeat(Math.ceil(chars / seed.length)).slice(0, chars);
}

/** pi-shaped zero usage block — present on every real assistant message. */
function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
