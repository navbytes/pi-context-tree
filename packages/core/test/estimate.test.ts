import { describe, expect, it } from "vitest";
import { aggregateConsumers } from "../src/consumers.ts";
import {
	IMAGE_CHARS,
	band,
	entryChars,
	estimateContextTokens,
	estimateEntryTokens,
	fmtTokens,
} from "../src/estimate.ts";
import { SessionBuilder, filler } from "../src/testkit.ts";
import { SessionTree, contextSlice } from "../src/tree.ts";
import type { SessionEntry } from "../src/types.ts";

function entryOf(build: (b: SessionBuilder) => void): SessionEntry {
	const b = new SessionBuilder();
	build(b);
	const { entries } = b.build();
	const last = entries[entries.length - 1];
	if (!last) throw new Error("no entry built");
	return last;
}

describe("entryChars / estimateEntryTokens", () => {
	it("counts user string content", () => {
		const e = entryOf((b) => b.user("abcd"));
		expect(entryChars(e)).toBe(4);
		expect(estimateEntryTokens(e)).toBe(1);
	});

	it("counts assistant text + thinking + toolCall argument JSON", () => {
		const e = entryOf((b) =>
			b.message({
				role: "assistant",
				content: [
					{ type: "text", text: "12345678" },
					{ type: "thinking", thinking: "1234" },
					{ type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.ts" } },
				],
			}),
		);
		expect(entryChars(e)).toBe(8 + 4 + JSON.stringify({ path: "a.ts" }).length);
	});

	it("counts images at pi parity (4800 chars)", () => {
		const e = entryOf((b) =>
			b.message({
				role: "toolResult",
				toolCallId: "c",
				toolName: "screenshot",
				content: [{ type: "image", data: "xxxx", mimeType: "image/png" }],
				isError: false,
			}),
		);
		expect(entryChars(e)).toBe(IMAGE_CHARS);
	});

	it("counts bash command + output, custom_message content, summaries", () => {
		expect(entryChars(entryOf((b) => b.bash("ls", "abc")))).toBe(2 + 3);
		expect(entryChars(entryOf((b) => b.customMessage("ctree/decision", "12345")))).toBe(5);
		expect(entryChars(entryOf((b) => b.compaction("sum", "x", 1)))).toBe(3);
		expect(entryChars(entryOf((b) => b.branchSummary("x", "abcd")))).toBe(4);
	});

	it("counts zero for non-context entries", () => {
		expect(entryChars(entryOf((b) => b.custom("ctree/fork", { v: 1 })))).toBe(0);
		expect(entryChars(entryOf((b) => b.modelChange("anthropic", "haiku-4.5")))).toBe(0);
		expect(entryChars(entryOf((b) => b.label("x", "name")))).toBe(0);
	});

	it("rounds tokens up", () => {
		const e = entryOf((b) => b.user("abcde")); // 5 chars → 2 tokens
		expect(estimateEntryTokens(e)).toBe(2);
	});
});

describe("estimateContextTokens", () => {
	it("sums the slice", () => {
		const b = new SessionBuilder();
		b.user(filler(400));
		b.assistant(filler(400));
		const leaf = b.toolResult("read_file", filler(800));
		const tree = SessionTree.fromEntries(b.build().entries);
		const slice = contextSlice(tree, leaf);
		expect(estimateContextTokens(slice)).toBe(100 + 100 + 200);
	});
});

describe("band", () => {
	it("maps percent to spec bands (5/15/40)", () => {
		expect(band(0)).toBe("low");
		expect(band(4.9)).toBe("low");
		expect(band(5)).toBe("healthy");
		expect(band(14.9)).toBe("healthy");
		expect(band(15)).toBe("filling");
		expect(band(40)).toBe("filling");
		expect(band(40.1)).toBe("red");
		expect(band(120)).toBe("red");
	});
});

describe("fmtTokens", () => {
	it("formats with one decimal, stripping .0", () => {
		expect(fmtTokens(950)).toBe("950");
		expect(fmtTokens(19_400)).toBe("19.4k");
		expect(fmtTokens(200_000)).toBe("200k");
		expect(fmtTokens(6_400)).toBe("6.4k");
	});
});

describe("aggregateConsumers", () => {
	it("groups by tool and role, sorted by tokens desc, with shares", () => {
		const b = new SessionBuilder();
		b.user(filler(100));
		b.toolUse("chrome.snapshot", { url: "tabs" }, filler(8000));
		b.toolUse("chrome.snapshot", { url: "tabs2" }, filler(4000));
		b.toolUse("run_tests", {}, filler(2000));
		const leaf = b.assistant(filler(400));
		const tree = SessionTree.fromEntries(b.build().entries);
		const rows = aggregateConsumers(contextSlice(tree, leaf));

		expect(rows[0]?.key).toBe("chrome.snapshot");
		expect(rows[0]?.entries).toBe(2);
		expect(rows[0]?.tokens).toBe(3000);
		const total = rows.reduce((s, r) => s + r.tokens, 0);
		expect(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 1)).toBeLessThan(1e-9);
		expect(total).toBe(estimateContextTokens(contextSlice(tree, leaf)));
	});

	it("labels decision records and crop stubs distinctly", () => {
		const b = new SessionBuilder();
		b.user("q");
		b.customMessage("ctree/decision", filler(400));
		b.customMessage("ctree/crop-tail", filler(200));
		const leaf = b.assistant("a");
		const tree = SessionTree.fromEntries(b.build().entries);
		const keys = aggregateConsumers(contextSlice(tree, leaf)).map((r) => r.key);
		expect(keys).toContain("decision records");
		expect(keys).toContain("crop stubs");
	});
});
