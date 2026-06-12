/**
 * Minimal OpenAI-compatible /chat/completions mock for golden tests. Streams
 * SSE chunks in the shape pi-ai's openai-completions provider parses (role
 * chunk → content / tool_call deltas → finish_reason chunk → usage chunk →
 * [DONE]). Agent-loop requests (with tools) consume the FIFO `turns` queue;
 * tool-less requests are extension pi-ai complete() calls, matched against
 * `drafts` by system prompt. Every request is recorded for assertions.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";

export interface CannedTurn {
	text?: string;
	toolCall?: { name: string; args: Record<string, unknown> };
	usage?: { input: number; output: number };
}

export interface DraftMatcher {
	match: (systemPrompt: string) => boolean;
	respond: (body: Record<string, unknown>) => CannedTurn;
}

export interface RecordedRequest {
	model: string;
	hasTools: boolean;
	system: string;
	lastUserText: string;
	body: Record<string, unknown>;
}

interface OpenAIMessage {
	role: string;
	content: unknown;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => (typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : ""))
			.join("");
	}
	return "";
}

export class MockOpenAI {
	readonly requests: RecordedRequest[] = [];
	readonly unexpected: RecordedRequest[] = [];
	turns: CannedTurn[] = [];
	drafts: DraftMatcher[] = [];
	fallback: CannedTurn = { text: "ok" };

	private server: Server | undefined;
	private counter = 0;

	async start(): Promise<string> {
		const server = createServer((req, res) => {
			this.handle(req, res).catch((err) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: String(err) } }));
			});
		});
		this.server = server;
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("mock server failed to bind");
		return `http://127.0.0.1:${address.port}/v1`;
	}

	async close(): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.server = undefined;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.method !== "POST" || !(req.url ?? "").endsWith("/chat/completions")) {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: `mock: unhandled ${req.method} ${req.url}` } }));
			return;
		}
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;

		const messages = (body.messages ?? []) as OpenAIMessage[];
		const recorded: RecordedRequest = {
			model: String(body.model ?? ""),
			hasTools: Array.isArray(body.tools) && body.tools.length > 0,
			system: textOf(messages.find((m) => m.role === "system")?.content),
			lastUserText: textOf([...messages].reverse().find((m) => m.role === "user")?.content),
			body,
		};
		this.requests.push(recorded);

		const turn = this.pick(recorded);
		this.sse(res, String(body.model ?? "mock"), turn);
	}

	private pick(req: RecordedRequest): CannedTurn {
		if (!req.hasTools) {
			for (const d of this.drafts) {
				if (d.match(req.system)) return d.respond(req.body);
			}
		}
		const queued = this.turns.shift();
		if (queued) return queued;
		this.unexpected.push(req);
		return this.fallback;
	}

	private sse(res: ServerResponse, model: string, turn: CannedTurn): void {
		this.counter += 1;
		const id = `chatcmpl-${this.counter}`;
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		const send = (obj: Record<string, unknown>): void => {
			res.write(`data: ${JSON.stringify(obj)}\n\n`);
		};
		const base = { id, object: "chat.completion.chunk", created: 1750000000, model };
		send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
		if (turn.text !== undefined) {
			send({ ...base, choices: [{ index: 0, delta: { content: turn.text }, finish_reason: null }] });
		}
		if (turn.toolCall) {
			send({
				...base,
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{
									index: 0,
									id: `call_${this.counter}`,
									type: "function",
									function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args) },
								},
							],
						},
						finish_reason: null,
					},
				],
			});
		}
		send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.toolCall ? "tool_calls" : "stop" }] });
		const usage = turn.usage ?? { input: 10, output: 5 };
		send({
			...base,
			choices: [],
			usage: {
				prompt_tokens: usage.input,
				completion_tokens: usage.output,
				total_tokens: usage.input + usage.output,
			},
		});
		res.write("data: [DONE]\n\n");
		res.end();
	}
}
