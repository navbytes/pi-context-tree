/**
 * In-memory fake of the pi surface our commands use (adapter.ts interfaces).
 * Mirrors pi's append semantics: every append is a child of the current leaf;
 * navigateTree moves the leaf.
 */

import type { AgentMessage, SessionEntry } from "@pi-context-tree/core";
import type { CmdCtxLike, CtxLike, ModelLike, PiLike, UiLike, WidgetFactory } from "../src/adapter.ts";

export class FakeSession {
	entries: SessionEntry[] = [];
	leaf: string | null = null;
	private seq = 0;

	append(fields: Record<string, unknown>): string {
		this.seq += 1;
		const id = `x${String(this.seq).padStart(3, "0")}`;
		const entry = {
			...fields,
			id,
			parentId: this.leaf,
			timestamp: new Date(1760000000000 + this.seq * 60_000).toISOString(),
		} as unknown as SessionEntry;
		this.entries.push(entry);
		this.leaf = id;
		return id;
	}

	message(message: AgentMessage): string {
		return this.append({ type: "message", message });
	}

	user(text: string): string {
		return this.message({ role: "user", content: text });
	}

	assistant(text: string): string {
		return this.message({
			role: "assistant",
			content: [{ type: "text", text }],
			provider: "anthropic",
			model: "opus-4.8",
		});
	}

	toolResult(toolName: string, text: string): string {
		return this.message({
			role: "toolResult",
			toolCallId: `c${this.seq + 1}`,
			toolName,
			content: [{ type: "text", text }],
			isError: false,
		});
	}

	at(id: string): void {
		this.leaf = id;
	}
}

export class FakeUi {
	notifications: { msg: string; type?: string }[] = [];
	selectQueue: (string | undefined)[] = [];
	editorQueue: (string | undefined)[] = [];
	inputQueue: (string | undefined)[] = [];
	confirmQueue: boolean[] = [];
	statuses = new Map<string, string | undefined>();
	titles: string[] = [];
	selectCalls: { title: string; options: string[] }[] = [];
	/** unset by default — tests opt in to a TUI-capable ui by assigning (UiLike.custom is optional) */
	custom?: <T>(factory: unknown, options?: unknown) => Promise<T> = undefined;
	widgets = new Map<string, { lines: string[] | undefined; placement?: string }>();
	setWidget(key: string, content: string[] | WidgetFactory | undefined, options?: { placement?: string }): void {
		// factory form: call with dummies and render, so tests keep inspecting `lines`
		const lines = typeof content === "function" ? content({}, {}).render(200) : content;
		this.widgets.set(key, { lines, placement: options?.placement });
	}

	notify(msg: string, type?: "info" | "warning" | "error"): void {
		this.notifications.push({ msg, type });
	}
	async select(title: string, options: string[]): Promise<string | undefined> {
		this.selectCalls.push({ title, options });
		return this.selectQueue.shift();
	}
	async confirm(): Promise<boolean> {
		return this.confirmQueue.shift() ?? true;
	}
	async input(): Promise<string | undefined> {
		return this.inputQueue.shift();
	}
	async editor(_title: string, prefill?: string): Promise<string | undefined> {
		const next = this.editorQueue.shift();
		return next === "__ACCEPT_PREFILL__" ? prefill : next;
	}
	setStatus(key: string, text: string | undefined): void {
		this.statuses.set(key, text);
	}
	setTitle(title: string): void {
		this.titles.push(title);
	}
	notes(): string[] {
		return this.notifications.map((n) => n.msg);
	}
	notesOf(type: string): string[] {
		return this.notifications.filter((n) => n.type === type).map((n) => n.msg);
	}
}

export interface FakeWorld {
	pi: PiLike;
	ctx: CmdCtxLike;
	ui: FakeUi;
	session: FakeSession;
	calls: {
		navigate: { target: string; options?: { summarize?: boolean } }[];
		setModel: ModelLike[];
		labels: [string, string | undefined][];
	};
	commands: Map<string, (args: string, ctx: CmdCtxLike) => Promise<void> | void>;
	completions: Map<string, ((prefix: string) => { value: string; label?: string }[] | null) | undefined>;
	shortcuts: Map<string, (ctx: CtxLike) => Promise<void> | void>;
}

/** minimal stand-in satisfying pi's Model<any> — only the fields our code reads matter */
function fakeModel(provider: string, id: string, contextWindow: number): ModelLike {
	return {
		provider,
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:9/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 8192,
	} as ModelLike;
}

const KNOWN_MODELS: ModelLike[] = [
	fakeModel("anthropic", "opus-4.8", 200_000),
	fakeModel("anthropic", "haiku-4.5", 200_000),
	fakeModel("openai", "gpt-5.2", 400_000),
];

export function makeFake(): FakeWorld {
	const ui = new FakeUi();
	const session = new FakeSession();
	const calls: FakeWorld["calls"] = { navigate: [], setModel: [], labels: [] };
	const commands = new Map<string, (args: string, ctx: CmdCtxLike) => Promise<void> | void>();
	const shortcuts = new Map<string, (ctx: CtxLike) => Promise<void> | void>();
	const completions: FakeWorld["completions"] = new Map();
	let currentModel: ModelLike = KNOWN_MODELS[0] as ModelLike;

	const pi: PiLike = {
		registerCommand: (name, opts) => {
			commands.set(name, (args, ctx) => opts.handler(args, ctx as never));
			completions.set(
				name,
				opts.getArgumentCompletions as ((prefix: string) => { value: string; label?: string }[] | null) | undefined,
			);
		},
		registerShortcut: (keyId, opts) => shortcuts.set(keyId, (ctx) => opts.handler(ctx as never)),
		on: () => {},
		sendMessage: (m) =>
			session.append({
				type: "custom_message",
				customType: m.customType,
				content: m.content,
				display: m.display,
				details: m.details,
			}),
		appendEntry: (customType, data) => session.append({ type: "custom", customType, data }),
		setLabel: (entryId, label) => calls.labels.push([entryId, label]),
		setModel: async (model) => {
			calls.setModel.push(model);
			currentModel = model;
			return true;
		},
		getSessionName: () => undefined,
	};

	const ctx: CmdCtxLike = {
		ui: ui as unknown as UiLike,
		sessionManager: {
			getEntries: () => session.entries as never,
			getLeafId: () => session.leaf,
		},
		get model() {
			return currentModel;
		},
		modelRegistry: {
			find: (provider, id) => KNOWN_MODELS.find((m) => m.provider === provider && m.id === id),
			getAll: () => KNOWN_MODELS,
			complete: async () => ({ content: [] }) as never,
		},
		waitForIdle: async () => {},
		navigateTree: async (target, options) => {
			calls.navigate.push({ target, options });
			session.at(target);
			return { cancelled: false };
		},
		getContextUsage: () => ({ tokens: 1200, contextWindow: 200_000, percent: 0.6 }),
	};

	return { pi, ctx, ui, session, calls, commands, completions, shortcuts };
}

export function entriesByType(session: FakeSession, type: string, customType?: string): SessionEntry[] {
	return session.entries.filter(
		(e) => e.type === type && (customType === undefined || (e as { customType?: string }).customType === customType),
	);
}
