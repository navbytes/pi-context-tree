/**
 * normalizeSession turns a real pi session JSONL into a byte-stable golden:
 * entry ids → e001… (in file order, mapped everywhere they appear, including
 * inside content strings), timestamps/dates/cwd/responseId → placeholders.
 * Everything else (entry order, types, payloads, usage from the mock) is
 * preserved verbatim — that's what the goldens assert.
 */

import { describe, expect, it } from "vitest";
import { normalizeSession } from "./normalize.ts";

const HEADER = JSON.stringify({
	type: "session",
	version: 3,
	id: "019ebba2-a3f7-7152-b68e-f1b3e98f5b36",
	timestamp: "2026-06-12T11:40:58.743Z",
	cwd: "/var/folders/zz/ctree-cwd",
});

function line(obj: Record<string, unknown>): string {
	return JSON.stringify(obj);
}

function parse(out: string): Record<string, unknown>[] {
	return out
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
}

describe("normalizeSession", () => {
	const raw = [
		HEADER,
		line({
			type: "model_change",
			id: "d48f08bb",
			parentId: null,
			timestamp: "2026-06-12T11:40:58.788Z",
			provider: "mock",
			modelId: "trunk-1",
		}),
		line({
			type: "message",
			id: "7af419ec",
			parentId: "d48f08bb",
			timestamp: "2026-06-12T11:43:13.938Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "hi from /var/folders/zz/ctree-cwd" }],
				timestamp: 1781264593935,
			},
		}),
		line({
			type: "message",
			id: "675a7aad",
			parentId: "7af419ec",
			timestamp: "2026-06-12T11:43:24.276Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
				api: "openai-completions",
				provider: "mock",
				model: "trunk-1",
				usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
				stopReason: "stop",
				timestamp: 1781264594000,
				responseId: "chatcmpl-339",
			},
		}),
		line({
			type: "custom",
			id: "aa11bb22",
			parentId: "675a7aad",
			timestamp: "2026-06-12T11:44:00.000Z",
			customType: "ctree/fork",
			data: {
				v: 1,
				name: "feat-x",
				parentEntryId: "675a7aad",
				trunkModel: "mock/trunk-1",
				createdAt: 1781264640000,
				status: "open",
			},
		}),
		line({
			type: "label",
			id: "cc33dd44",
			parentId: "aa11bb22",
			timestamp: "2026-06-12T11:44:00.100Z",
			targetId: "aa11bb22",
			label: "feat-x",
		}),
		line({
			type: "custom_message",
			id: "ee55ff66",
			parentId: "cc33dd44",
			timestamp: "2026-06-12T11:45:00.000Z",
			customType: "ctree/decision",
			content: "## Decision: feat-x\n**Date:** 2026-06-12 · branch aa11bb22\nDone.",
			display: true,
			details: { v: 1, forkEntryId: "aa11bb22" },
		}),
		line({
			type: "custom",
			id: "99887766",
			parentId: "ee55ff66",
			timestamp: "2026-06-12T11:45:01.000Z",
			customType: "ctree/close",
			data: { v: 1, forkEntryId: "aa11bb22", status: "squashed", decisionEntryId: "ee55ff66" },
		}),
	].join("\n");

	it("maps entry ids to e00N in file order, everywhere they appear", () => {
		const out = parse(normalizeSession(raw));
		const [, modelChange, user, assistant, fork, label, decision, close] = out;
		expect(modelChange?.id).toBe("e001");
		expect(user?.id).toBe("e002");
		expect(user?.parentId).toBe("e001");
		expect(assistant?.id).toBe("e003");
		expect(fork?.id).toBe("e004");
		expect((fork?.data as { parentEntryId: string }).parentEntryId).toBe("e003");
		expect(label?.targetId).toBe("e004");
		expect((decision?.details as { forkEntryId: string }).forkEntryId).toBe("e004");
		// ids embedded in content strings get mapped too
		expect(decision?.content).toContain("branch e004");
		const closeData = close?.data as { forkEntryId: string; decisionEntryId: string };
		expect(closeData.forkEntryId).toBe("e004");
		expect(closeData.decisionEntryId).toBe("e006");
	});

	it("normalizes header, timestamps, dates, cwd and responseId; keeps usage and order", () => {
		const out = parse(normalizeSession(raw));
		const header = out[0] as Record<string, unknown>;
		expect(header.id).toBe("<session>");
		expect(header.timestamp).toBe("<ts>");
		expect(header.cwd).toBe("<cwd>");
		expect(header.version).toBe(3);

		const user = out[2] as { message: { content: { text: string }[]; timestamp: number } };
		expect(user.message.content[0]?.text).toBe("hi from <cwd>");
		expect(user.message.timestamp).toBe(0);

		const assistant = out[3] as { timestamp: string; message: { responseId: string; usage: { input: number } } };
		expect(assistant.timestamp).toBe("<ts>");
		expect(assistant.message.responseId).toBe("<resp>");
		expect(assistant.message.usage.input).toBe(10);

		const fork = out[4] as { data: { createdAt: number } };
		expect(fork.data.createdAt).toBe(0);

		const decision = out[6] as { content: string };
		expect(decision.content).toContain("**Date:** <date>");
	});

	it("treats /var and /private/var forms of the cwd as the same path", () => {
		const privateRaw = raw.replaceAll("/var/folders/zz/ctree-cwd", "/private/var/folders/zz/ctree-cwd");
		expect(normalizeSession(privateRaw)).toBe(normalizeSession(raw));
	});

	it("is deterministic across sessions that differ only in ids/timestamps", () => {
		const reIded = raw
			.replaceAll("d48f08bb", "11110000")
			.replaceAll("7af419ec", "22220000")
			.replaceAll("675a7aad", "33330000")
			.replaceAll("aa11bb22", "44440000")
			.replaceAll("cc33dd44", "55550000")
			.replaceAll("ee55ff66", "66660000")
			.replaceAll("99887766", "77770000")
			.replaceAll("019ebba2-a3f7-7152-b68e-f1b3e98f5b36", "11111111-2222-4333-8444-555566667777")
			.replaceAll("2026-06-12T11:4", "2027-01-01T09:0");
		expect(normalizeSession(reIded)).toBe(normalizeSession(raw));
	});

	it("is idempotent", () => {
		const once = normalizeSession(raw);
		expect(normalizeSession(once)).toBe(once);
	});

	it("ends with a newline and skips blank lines", () => {
		const out = normalizeSession(`${raw}\n\n`);
		expect(out.endsWith("\n")).toBe(true);
		expect(out.split("\n").filter((l) => l === "").length).toBe(1);
	});
});
