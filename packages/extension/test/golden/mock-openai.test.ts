/**
 * MockOpenAI serves /chat/completions as SSE the way pi-ai's
 * openai-completions provider consumes it: role chunk, content/tool_call
 * deltas, a finish_reason chunk, a usage chunk, then [DONE]. Requests with
 * tools come from the agent loop (FIFO `turns`); tool-less requests are
 * extension draft calls, dispatched on the system prompt.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MockOpenAI } from "./mock-openai.ts";

function sseObjects(body: string): Record<string, unknown>[] {
	return body
		.split("\n\n")
		.map((b) => b.trim())
		.filter((b) => b.startsWith("data: ") && !b.includes("[DONE]"))
		.map((b) => JSON.parse(b.slice("data: ".length)));
}

async function post(baseUrl: string, body: Record<string, unknown>): Promise<string> {
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer test-key" },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(200);
	return await res.text();
}

describe("MockOpenAI", () => {
	let mock: MockOpenAI | undefined;
	afterEach(async () => {
		await mock?.close();
		mock = undefined;
	});

	it("serves a queued text turn as SSE with finish_reason and usage", async () => {
		mock = new MockOpenAI();
		mock.turns.push({ text: "hello there", usage: { input: 11, output: 3 } });
		const baseUrl = await mock.start();

		const body = await post(baseUrl, {
			model: "trunk-1",
			stream: true,
			messages: [{ role: "user", content: "hi" }],
			tools: [{ type: "function", function: { name: "read", parameters: {} } }],
		});

		const chunks = sseObjects(body);
		const text = chunks.map((c) => (c.choices as { delta?: { content?: string } }[])[0]?.delta?.content ?? "").join("");
		expect(text).toBe("hello there");
		const finish = chunks.find((c) => (c.choices as { finish_reason?: string }[])[0]?.finish_reason);
		expect((finish?.choices as { finish_reason: string }[])[0]?.finish_reason).toBe("stop");
		const usage = chunks.find((c) => c.usage) as { usage: { prompt_tokens: number; completion_tokens: number } };
		expect(usage.usage.prompt_tokens).toBe(11);
		expect(usage.usage.completion_tokens).toBe(3);
		expect(body.trim().endsWith("data: [DONE]")).toBe(true);

		expect(mock.requests).toHaveLength(1);
		expect(mock.requests[0]?.model).toBe("trunk-1");
		expect(mock.requests[0]?.hasTools).toBe(true);
	});

	it("serves a tool call with finish_reason tool_calls", async () => {
		mock = new MockOpenAI();
		mock.turns.push({ toolCall: { name: "read", args: { path: "big.txt" } } });
		const baseUrl = await mock.start();

		const body = await post(baseUrl, {
			model: "trunk-1",
			stream: true,
			messages: [{ role: "user", content: "read it" }],
			tools: [{ type: "function", function: { name: "read", parameters: {} } }],
		});

		const chunks = sseObjects(body);
		type Delta = { delta?: { tool_calls?: { id: string; function: { name: string; arguments: string } }[] } };
		const tc = chunks.flatMap((c) => (c.choices as Delta[])[0]?.delta?.tool_calls ?? [])[0];
		expect(tc?.function.name).toBe("read");
		expect(JSON.parse(tc?.function.arguments ?? "{}")).toEqual({ path: "big.txt" });
		const finish = chunks.find((c) => (c.choices as { finish_reason?: string }[])[0]?.finish_reason);
		expect((finish?.choices as { finish_reason: string }[])[0]?.finish_reason).toBe("tool_calls");
	});

	it("dispatches tool-less requests to draft matchers on the system prompt", async () => {
		mock = new MockOpenAI();
		mock.turns.push({ text: "should not be used" });
		mock.drafts.push({
			match: (system) => system.includes("decision records"),
			respond: () => ({ text: "## Decision\nfrom draft matcher" }),
		});
		const baseUrl = await mock.start();

		const body = await post(baseUrl, {
			model: "branch-1",
			stream: true,
			messages: [
				{ role: "system", content: "You write terse engineering decision records." },
				{ role: "user", content: "squash this" },
			],
		});
		const text = sseObjects(body)
			.map((c) => ((c.choices as { delta?: { content?: string } }[])[0]?.delta?.content ?? "").toString())
			.join("");
		expect(text).toContain("from draft matcher");
		expect(mock.requests[0]?.hasTools).toBe(false);
		expect(mock.requests[0]?.system).toContain("decision records");
		expect(mock.turns).toHaveLength(1); // FIFO untouched by the draft call
	});

	it("falls back to `ok` when the queue runs dry and records the unexpected call", async () => {
		mock = new MockOpenAI();
		const baseUrl = await mock.start();
		const body = await post(baseUrl, { model: "trunk-1", stream: true, messages: [], tools: [{}] });
		const text = sseObjects(body)
			.map((c) => ((c.choices as { delta?: { content?: string } }[])[0]?.delta?.content ?? "").toString())
			.join("");
		expect(text).toBe("ok");
		expect(mock.unexpected).toHaveLength(1);
	});
});
