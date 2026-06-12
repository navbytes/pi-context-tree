/**
 * Test driver for `pi --mode rpc` with the extension loaded from source.
 * Fully isolated from the developer's ~/.pi: PI_CODING_AGENT_DIR points at a
 * temp agent dir whose models.json routes provider "mock" to a MockOpenAI
 * server, and --session-dir keeps session JSONL in the sandbox.
 *
 * JSONL framing per pi's docs/rpc.md: split on LF only, strip trailing CR.
 * Dialog ui requests (select/confirm/input/editor) are answered by handlers
 * the test declares up front; an undeclared dialog fails the test loudly.
 */

import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "index.ts");

export function piPath(): string | null {
	try {
		return execFileSync("which", ["pi"], { encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
}

/** models.json for the sandbox agent dir: provider "mock" → MockOpenAI baseUrl. */
export function writeMockModels(agentDir: string, baseUrl: string, modelIds: string[]): void {
	mkdirSync(agentDir, { recursive: true });
	const models = modelIds.map((id) => ({ id, input: ["text"], contextWindow: 32768, maxTokens: 4096 }));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify(
			{ providers: { mock: { api: "openai-completions", apiKey: "test-key", baseUrl, models } } },
			null,
			"\t",
		),
	);
}

export interface UiHandlers {
	select?: (req: UiRequest) => string | undefined;
	confirm?: (req: UiRequest) => boolean;
	input?: (req: UiRequest) => string | undefined;
	editor?: (req: UiRequest) => string | undefined;
}

export interface UiRequest {
	id: string;
	method: string;
	title?: string;
	message?: string;
	prefill?: string;
	options?: string[];
	[k: string]: unknown;
}

export interface StartOptions {
	pi: string;
	cwd: string;
	agentDir: string;
	sessionDir: string;
	model: string;
	ui?: UiHandlers;
	provider?: string;
	extension?: string;
}

interface Waiter {
	pred: (msg: Record<string, unknown>) => boolean;
	resolve: (msg: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	label: string;
	timer: NodeJS.Timeout;
}

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

export class PiRpc {
	readonly events: Record<string, unknown>[] = [];
	readonly uiRequests: UiRequest[] = [];
	readonly notifications: { message: string; notifyType?: string }[] = [];

	private child: ChildProcessWithoutNullStreams;
	private ui: UiHandlers;
	private stderr = "";
	private buffer = "";
	private reqSeq = 0;
	private waiters: Waiter[] = [];
	private exited: Error | undefined;

	static async start(opts: StartOptions): Promise<PiRpc> {
		const rpc = new PiRpc(opts);
		// pi emits nothing at boot in RPC mode — probe with get_state to know it's up.
		await rpc.request({ type: "get_state" }, 30_000);
		return rpc;
	}

	private constructor(opts: StartOptions) {
		this.ui = opts.ui ?? {};
		this.child = spawn(
			opts.pi,
			[
				"--mode",
				"rpc",
				"--provider",
				opts.provider ?? "mock",
				"--model",
				opts.model,
				"-e",
				opts.extension ?? EXTENSION_ENTRY,
				"--session-dir",
				opts.sessionDir,
			],
			{
				cwd: opts.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, PI_CODING_AGENT_DIR: opts.agentDir, NO_COLOR: "1" },
			},
		);
		this.child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.stderr += String(chunk);
		});
		this.child.on("exit", (code, signal) => {
			if (this.exited) return;
			this.exited = new Error(`pi exited (code=${code} signal=${signal})\nstderr: ${this.stderr.slice(-2000)}`);
			for (const w of [...this.waiters]) {
				clearTimeout(w.timer);
				w.reject(this.exited);
			}
			this.waiters = [];
		});
	}

	private onStdout(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
		while (true) {
			const nl = this.buffer.indexOf("\n");
			if (nl === -1) break;
			let line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line.trim()) continue;
			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue; // non-protocol noise
			}
			this.dispatch(msg);
		}
	}

	private dispatch(msg: Record<string, unknown>): void {
		if (msg.type === "extension_ui_request") {
			const req = msg as unknown as UiRequest;
			this.uiRequests.push(req);
			if (req.method === "notify") {
				this.notifications.push({ message: String(req.message ?? ""), notifyType: req.notifyType as string });
			}
			if (DIALOG_METHODS.has(req.method)) this.answerDialog(req);
		}
		this.events.push(msg);
		for (const w of [...this.waiters]) {
			if (w.pred(msg)) {
				this.waiters.splice(this.waiters.indexOf(w), 1);
				clearTimeout(w.timer);
				w.resolve(msg);
			}
		}
	}

	private answerDialog(req: UiRequest): void {
		const reply = (payload: Record<string, unknown>): void => {
			this.write({ type: "extension_ui_response", id: req.id, ...payload });
		};
		const fail = (): void => {
			reply({ cancelled: true });
			const err = new Error(`undeclared ui dialog: ${req.method} "${req.title ?? ""}" — give PiRpc a handler`);
			for (const w of [...this.waiters]) {
				clearTimeout(w.timer);
				w.reject(err);
			}
			this.waiters = [];
		};
		const handlers: Record<string, (() => void) | undefined> = {
			select:
				this.ui.select &&
				(() => {
					const value = (this.ui.select as (r: UiRequest) => string | undefined)(req);
					reply(value === undefined ? { cancelled: true } : { value });
				}),
			confirm:
				this.ui.confirm &&
				(() => {
					reply({ confirmed: (this.ui.confirm as (r: UiRequest) => boolean)(req) });
				}),
			input:
				this.ui.input &&
				(() => {
					const value = (this.ui.input as (r: UiRequest) => string | undefined)(req);
					reply(value === undefined ? { cancelled: true } : { value });
				}),
			editor:
				this.ui.editor &&
				(() => {
					const value = (this.ui.editor as (r: UiRequest) => string | undefined)(req);
					reply(value === undefined ? { cancelled: true } : { value });
				}),
		};
		const handler = handlers[req.method];
		if (handler) handler();
		else fail();
	}

	private write(obj: Record<string, unknown>): void {
		this.child.stdin.write(`${JSON.stringify(obj)}\n`);
	}

	/** Index for `since` marks: matches are only considered at event index ≥ since. */
	mark(): number {
		return this.events.length;
	}

	/** Wait for a protocol message matching pred at event index ≥ since (history included). */
	waitMessage(
		pred: (msg: Record<string, unknown>) => boolean,
		label: string,
		opts: { since?: number; timeoutMs?: number } = {},
	): Promise<Record<string, unknown>> {
		const since = opts.since ?? 0;
		for (let i = since; i < this.events.length; i++) {
			const msg = this.events[i] as Record<string, unknown>;
			if (pred(msg)) return Promise.resolve(msg);
		}
		if (this.exited) return Promise.reject(this.exited);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((w) => w.timer !== timer);
				const recent = this.events
					.slice(-12)
					.map((e) => JSON.stringify(e).slice(0, 160))
					.join("\n");
				reject(
					new Error(`timeout waiting for ${label}\nrecent events:\n${recent}\nstderr: ${this.stderr.slice(-1500)}`),
				);
			}, opts.timeoutMs ?? 20_000);
			this.waiters.push({ pred, resolve, reject, label, timer });
		});
	}

	/** Send a raw RPC command and await its correlated response (ids are unique — no since needed). */
	async request(cmd: Record<string, unknown>, timeoutMs = 20_000): Promise<Record<string, unknown>> {
		this.reqSeq += 1;
		const id = `req-${this.reqSeq}`;
		const wait = this.waitMessage((m) => m.type === "response" && m.id === id, `response to ${cmd.type}`, {
			timeoutMs,
		});
		this.write({ id, ...cmd });
		const res = await wait;
		if (res.success === false) throw new Error(`${cmd.type} failed: ${String(res.error)}`);
		return res;
	}

	/** Send a user turn and wait until the agent loop finishes. */
	async turn(message: string): Promise<void> {
		const since = this.mark();
		await this.request({ type: "prompt", message });
		await this.waitMessage((m) => m.type === "agent_end", `agent_end after ${JSON.stringify(message)}`, {
			since,
			timeoutMs: 30_000,
		});
	}

	/** Invoke an extension command and wait for its closing notify (handler-done signal). */
	async command(message: string, doneNotify: RegExp): Promise<string> {
		const since = this.mark();
		await this.request({ type: "prompt", message });
		const msg = await this.waitMessage(
			(m) => m.type === "extension_ui_request" && m.method === "notify" && doneNotify.test(String(m.message ?? "")),
			`notify ${doneNotify}`,
			{ since, timeoutMs: 30_000 },
		);
		return String(msg.message ?? "");
	}

	async sessionFile(): Promise<string> {
		const res = await this.request({ type: "get_state" });
		const file = (res.data as { sessionFile?: string } | undefined)?.sessionFile;
		if (!file) throw new Error(`get_state returned no sessionFile: ${JSON.stringify(res.data).slice(0, 300)}`);
		return file;
	}

	async stop(): Promise<void> {
		this.exited = this.exited ?? new Error("stopped");
		this.child.kill();
		await new Promise<void>((resolve) => {
			if (this.child.exitCode !== null) return resolve();
			this.child.once("exit", () => resolve());
			setTimeout(() => {
				this.child.kill("SIGKILL");
				resolve();
			}, 3000).unref();
		});
	}
}
