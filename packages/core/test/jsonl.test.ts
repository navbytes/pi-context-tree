import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionFile, parseSessionText } from "../src/jsonl.ts";
import { SessionBuilder } from "../src/testkit.ts";

function tmpFile(text: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ctree-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, text);
	return file;
}

describe("parseSessionText", () => {
	it("parses header and entries of a well-formed session", () => {
		const b = new SessionBuilder("/work/proj");
		const u = b.user("hello");
		b.assistant("hi there");
		const { text } = b.build();

		const parsed = parseSessionText(text);
		expect(parsed.header?.version).toBe(3);
		expect(parsed.header?.cwd).toBe("/work/proj");
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.entries[0]?.id).toBe(u);
		expect(parsed.entries[0]?.parentId).toBeNull();
		expect(parsed.entries[1]?.parentId).toBe(u);
		expect(parsed.warnings).toEqual([]);
	});

	it("skips a truncated final line with a warning, keeping prior entries", () => {
		const b = new SessionBuilder();
		b.user("one");
		b.assistant("two");
		const { text } = b.build();
		const truncated = text.trimEnd().slice(0, -25); // chop mid-JSON

		const parsed = parseSessionText(truncated);
		expect(parsed.entries).toHaveLength(1);
		expect(parsed.warnings).toHaveLength(1);
		expect(parsed.warnings[0]).toMatch(/line 3/);
	});

	it("skips garbage lines mid-file and continues", () => {
		const b = new SessionBuilder();
		b.user("one");
		b.assistant("two");
		const lines = b.build().text.trimEnd().split("\n");
		lines.splice(2, 0, "%%% not json %%%");

		const parsed = parseSessionText(`${lines.join("\n")}\n`);
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.warnings).toHaveLength(1);
	});

	it("preserves unknown entry types and warns once per type", () => {
		const b = new SessionBuilder();
		const u = b.user("one");
		const lines = b.build().text.trimEnd().split("\n");
		lines.push(
			JSON.stringify({ type: "hologram", id: "x1", parentId: u, timestamp: "2026-06-12T01:00:00Z", payload: 1 }),
		);
		lines.push(JSON.stringify({ type: "hologram", id: "x2", parentId: "x1", timestamp: "2026-06-12T01:01:00Z" }));

		const parsed = parseSessionText(`${lines.join("\n")}\n`);
		expect(parsed.entries).toHaveLength(3);
		expect(parsed.entries[1]?.type).toBe("hologram");
		expect(parsed.warnings.filter((w) => w.includes("hologram"))).toHaveLength(1);
	});

	it("migrates legacy v1 linear sessions (no parentId) into a chain", () => {
		const header = JSON.stringify({
			type: "session",
			version: 1,
			id: "legacy-uuid",
			timestamp: "2024-01-01T00:00:00Z",
			cwd: "/old",
		});
		const m1 = JSON.stringify({ type: "message", message: { role: "user", content: "a" } });
		const m2 = JSON.stringify({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "b" }] },
		});

		const parsed = parseSessionText(`${header}\n${m1}\n${m2}\n`);
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.entries[0]?.id).toBeTruthy();
		expect(parsed.entries[0]?.parentId).toBeNull();
		expect(parsed.entries[1]?.parentId).toBe(parsed.entries[0]?.id);
		expect(parsed.warnings.some((w) => w.includes("legacy"))).toBe(true);
	});

	it("tolerates a missing header", () => {
		const b = new SessionBuilder();
		b.user("hi");
		const noHeader = b.build().text.split("\n").slice(1).join("\n");
		const parsed = parseSessionText(noHeader);
		expect(parsed.header).toBeNull();
		expect(parsed.entries).toHaveLength(1);
	});
});

describe("parseSessionFile", () => {
	it("streams a file to the same result as text parsing", async () => {
		const b = new SessionBuilder();
		b.user("file test");
		b.toolUse("read_file", { path: "src/a.ts" }, "contents here");
		const { text } = b.build();

		const fromFile = await parseSessionFile(tmpFile(text));
		const fromText = parseSessionText(text);
		expect(fromFile.entries).toEqual(fromText.entries);
		expect(fromFile.header).toEqual(fromText.header);
	});
});

describe("testkit pi-fidelity", () => {
	it("assistant messages carry usage — pi's TUI footer reads message.usage.input unconditionally", () => {
		const b = new SessionBuilder();
		b.user("q");
		b.assistant("a");
		b.toolUse("read_file", { path: "x" }, "y");
		const assistants = b
			.build()
			.entries.filter((e) => e.type === "message" && (e as { message: { role: string } }).message.role === "assistant")
			.map((e) => (e as { message: { usage?: { input?: number; cost?: { total?: number } } } }).message);
		expect(assistants.length).toBeGreaterThan(1);
		for (const m of assistants) {
			expect(typeof m.usage?.input).toBe("number");
			expect(typeof m.usage?.cost?.total).toBe("number");
		}
	});
});
