import { describe, expect, it } from "vitest";
import { SessionBuilder } from "../src/testkit.ts";
import { SessionTree, contextSlice } from "../src/tree.ts";

/** trunk: u1 → a1 → t1 → a2 ; branch from a1: u2 → a3 (leaf) */
function branched() {
	const b = new SessionBuilder();
	const u1 = b.user("kickoff");
	const a1 = b.assistant("plan");
	const t1 = b.toolResult("read_file", "file body");
	const a2 = b.assistant("trunk continues");
	b.at(a1);
	const u2 = b.user("side quest");
	const a3 = b.assistant("side answer");
	return { b, ids: { u1, a1, t1, a2, u2, a3 } };
}

describe("SessionTree", () => {
	it("indexes children and finds roots", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(tree.roots().map((e) => e.id)).toEqual([ids.u1]);
		expect(tree.children(ids.a1).map((e) => e.id)).toEqual([ids.t1, ids.u2]);
	});

	it("treats the last entry in file order as the loaded leaf (pi semantics)", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(tree.fileLeafId()).toBe(ids.a3);
	});

	it("walks pathToRoot and pathFromRoot", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(tree.pathFromRoot(ids.a3).map((e) => e.id)).toEqual([ids.u1, ids.a1, ids.u2, ids.a3]);
		expect(tree.pathToRoot(ids.a2).map((e) => e.id)).toEqual([ids.a2, ids.t1, ids.a1, ids.u1]);
	});

	it("answers ancestry and depth", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(tree.isAncestorOrSelf(ids.a1, ids.a3)).toBe(true);
		expect(tree.isAncestorOrSelf(ids.t1, ids.a3)).toBe(false);
		expect(tree.isAncestorOrSelf(ids.a3, ids.a3)).toBe(true);
		expect(tree.depth(ids.u1)).toBe(0);
		expect(tree.depth(ids.a3)).toBe(3);
	});

	it("lists leaves (nodes without children)", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(new Set(tree.leaves())).toEqual(new Set([ids.a2, ids.a3]));
	});
});

describe("contextSlice", () => {
	it("returns only the current path, in root→leaf order", () => {
		const { b, ids } = branched();
		const tree = SessionTree.fromEntries(b.build().entries);
		const slice = contextSlice(tree, ids.a3);
		expect(slice.map((e) => e.id)).toEqual([ids.u1, ids.a1, ids.u2, ids.a3]);
	});

	it("excludes non-context entries but keeps custom_message and branch_summary", () => {
		const b = new SessionBuilder();
		const u1 = b.user("hello");
		b.custom("ctree/fork", { v: 1, name: "x", parentEntryId: u1, createdAt: 0, status: "open" });
		b.label(u1, "bookmark");
		b.modelChange("anthropic", "haiku-4.5");
		const d = b.customMessage("ctree/decision", "## Decision: x");
		const s = b.branchSummary(u1, "explored a dead end");
		const a = b.assistant("done");
		const tree = SessionTree.fromEntries(b.build().entries);

		const slice = contextSlice(tree, a);
		expect(slice.map((e) => e.id)).toEqual([u1, d, s, a]);
	});

	it("excludes bashExecution marked excludeFromContext", () => {
		const b = new SessionBuilder();
		const u = b.user("hi");
		b.message({ role: "bashExecution", command: "ls", output: "x", excludeFromContext: true });
		const a = b.assistant("ok");
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(contextSlice(tree, a).map((e) => e.id)).toEqual([u, a]);
	});

	it("honors compaction: summary first, then entries from firstKeptEntryId", () => {
		const b = new SessionBuilder();
		b.user("ancient one");
		b.assistant("ancient two");
		const kept = b.user("kept question");
		const keptA = b.assistant("kept answer");
		const comp = b.compaction("summary of ancient", kept, 50_000);
		const after = b.user("post-compaction");
		const tree = SessionTree.fromEntries(b.build().entries);

		const slice = contextSlice(tree, after);
		expect(slice.map((e) => e.id)).toEqual([comp, kept, keptA, after]);
	});

	it("uses the latest compaction when several are on the path", () => {
		const b = new SessionBuilder();
		b.user("v old");
		const k1 = b.user("old kept");
		const c1 = b.compaction("first compaction", k1, 10_000);
		const k2 = b.user("newer kept");
		const c2 = b.compaction("second compaction", k2, 20_000);
		const tail = b.user("tail");
		const tree = SessionTree.fromEntries(b.build().entries);

		const slice = contextSlice(tree, tail);
		expect(slice.map((e) => e.id)).toEqual([c2, k2, tail]);
	});

	it("degrades to entries-after-compaction when firstKeptEntryId is off-path", () => {
		const b = new SessionBuilder();
		b.user("one");
		const comp = b.compaction("odd compaction", "nonexistent", 1000);
		const tail = b.user("tail");
		const tree = SessionTree.fromEntries(b.build().entries);

		const slice = contextSlice(tree, tail);
		expect(slice.map((e) => e.id)).toEqual([comp, tail]);
	});
});
