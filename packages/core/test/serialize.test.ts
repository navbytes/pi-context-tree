import { describe, expect, it } from "vitest";
import { serializeEntries, serializeEntry } from "../src/serialize.ts";
import { SessionBuilder, filler } from "../src/testkit.ts";

describe("serializeEntry", () => {
	it("renders role-prefixed lines", () => {
		const b = new SessionBuilder();
		b.user("hello");
		b.toolUse("read_file", { path: "a.ts" }, "body");
		const { entries } = b.build();
		expect(serializeEntry(entries[0]!)).toBe("user: hello");
		expect(serializeEntry(entries[2]!)).toBe("[read_file]: body");
	});
});

describe("serializeEntries", () => {
	it("caps per-entry size for summarizer prompts (pi parity 2000 chars)", () => {
		const b = new SessionBuilder();
		b.user("q");
		b.toolUse("read_file", { path: "a.ts" }, filler(10_000));
		b.assistant("a");
		const { entries } = b.build();
		const text = serializeEntries(entries, { perEntryCap: 2000 });
		expect(text).toContain("user: q");
		expect(text).toContain("…(truncated)");
		expect(text.length).toBeLessThan(4000);
	});
});
