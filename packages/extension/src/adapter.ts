/**
 * Structural slice of pi's extension API — the ONLY pi-coupled surface
 * (TRD §1: session-adapter). Commands code against these interfaces; tests
 * provide fakes; src/index.ts binds the real ExtensionAPI (verified 0.79.1).
 */

import { basename } from "node:path";
import type { SessionEntry } from "@pi-context-tree/core";

export interface ModelLike {
	id: string;
	provider: string;
	contextWindow?: number;
	[k: string]: unknown;
}

export interface UiLike {
	notify(message: string, type?: "info" | "warning" | "error"): void;
	select(title: string, options: string[], opts?: unknown): Promise<string | undefined>;
	confirm(title: string, message: string): Promise<boolean>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
	setTitle(title: string): void;
	custom?<T>(factory: unknown, options?: unknown): Promise<T>;
	/** Pin a widget (string lines) above/below the prompt — used for the context-health bar. */
	setWidget?(key: string, content: string[] | undefined, options?: { placement?: string }): void;
}

export interface ModelRegistryLike {
	find(provider: string, modelId: string): ModelLike | undefined;
	getAll?(): ModelLike[];
	getApiKeyAndHeaders(
		model: ModelLike,
	): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;
}

export interface CtxLike {
	ui: UiLike;
	sessionManager: { getEntries(): SessionEntry[]; getLeafId?(): string | null };
	model?: ModelLike;
	modelRegistry: ModelRegistryLike;
	getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
}

/** Command-capable context (pi's ExtensionCommandContext). */
export interface CmdCtxLike extends CtxLike {
	waitForIdle(): Promise<void>;
	navigateTree(targetId: string, options?: { summarize?: boolean; label?: string }): Promise<{ cancelled: boolean }>;
}

export interface PiLike {
	registerCommand(
		name: string,
		options: {
			description?: string;
			handler: (args: string, ctx: CmdCtxLike) => Promise<void> | void;
			// pi-tui's AutocompleteItem requires BOTH value and label — a missing label crashes
			// the TUI autocomplete (undefined.endsWith). Always include label.
			getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] | null;
		},
	): void;
	registerShortcut?(
		keyId: string,
		options: { description?: string; handler: (ctx: CtxLike) => Promise<void> | void },
	): void;
	on?(event: string, handler: (event: unknown, ctx: CtxLike) => unknown): void;
	sendMessage(
		message: { customType: string; content: string; display: boolean; details?: unknown },
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): void;
	appendEntry(customType: string, data?: unknown): void;
	setLabel(entryId: string, label: string | undefined): void;
	setModel(model: ModelLike): Promise<boolean>;
	getSessionName?(): string | undefined;
	/** pretty rendering for custom_message entries in the chat (pi ≥0.79) */
	registerMessageRenderer?<T = unknown>(
		customType: string,
		renderer: (
			message: { customType: string; content: string; details?: T; timestamp?: number },
			options: { expanded: boolean },
			theme: unknown,
		) => { render(width: number): string[] } | undefined,
	): void;
}

/** Drafting dependency — real implementation calls the branch model via pi-ai. */
export type DraftFn = (ctx: CmdCtxLike, modelRef: string | undefined, system: string, user: string) => Promise<string>;

export interface Deps {
	draft: DraftFn;
}

// -- helpers -----------------------------------------------------------------

export function entriesOf(ctx: CtxLike): SessionEntry[] {
	return ctx.sessionManager.getEntries();
}

export function leafIdOf(ctx: CtxLike): string | null {
	const viaApi = ctx.sessionManager.getLeafId?.();
	if (viaApi !== undefined) return viaApi;
	const entries = entriesOf(ctx);
	return entries.length ? (entries[entries.length - 1]?.id ?? null) : null;
}

export function lastEntryId(ctx: CtxLike): string | null {
	const entries = entriesOf(ctx);
	return entries.length ? (entries[entries.length - 1]?.id ?? null) : null;
}

/** appendEntry returns void in pi — recover the new entry's id from the log. */
export function appendAndGetId(pi: PiLike, ctx: CtxLike, customType: string, data: unknown): string | null {
	pi.appendEntry(customType, data);
	return lastEntryId(ctx);
}

export function modelKey(m: ModelLike | undefined): string | undefined {
	return m ? `${m.provider}/${m.id}` : undefined;
}

/** Resolve "provider/id" or bare id (exact, then unique substring) to a Model. */
export function resolveModel(ctx: CtxLike, ref: string): ModelLike | undefined {
	if (ref.includes("/")) {
		const [provider, ...rest] = ref.split("/");
		return ctx.modelRegistry.find(provider ?? "", rest.join("/"));
	}
	const all = ctx.modelRegistry.getAll?.() ?? [];
	const exact = all.find((m) => m.id === ref);
	if (exact) return exact;
	const matches = all.filter((m) => m.id.includes(ref));
	return matches.length === 1 ? matches[0] : undefined;
}

export function projectName(): string {
	return basename(process.cwd());
}
