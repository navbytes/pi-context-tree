import { describe, expect, it } from "vitest";
import { autoSelect, cropCandidates, planCrop, renderReconstruction, stubLine } from "../src/crop.ts";
import { SessionBuilder, filler } from "../src/testkit.ts";
import { SessionTree } from "../src/tree.ts";

/**
 * u1 → A(call rf) → rf(2k chars) → A(call snap1) → snap1(80k) → a2
 *    → A(call snap2) → snap2(64k) → A(call rt) → rt(16k) → a3 (leaf)
 */
function scenario() {
	const b = new SessionBuilder();
	const u1 = b.user("audit my tabs");
	const rf = b.toolUse("read_file", { path: "src/storage.ts" }, filler(2000));
	const snap1 = b.toolUse("chrome.snapshot", { url: "tab-audit" }, filler(80_000, "SNAPA-"));
	const a2 = b.assistant("41 suspendable tabs found");
	const snap2 = b.toolUse("chrome.snapshot", { url: "post-suspend" }, filler(64_000, "SNAPB-"));
	const rt = b.toolUse("run_tests", {}, filler(16_000));
	const a3 = b.assistant("done");
	const { entries } = b.build();
	return { tree: SessionTree.fromEntries(entries), ids: { u1, rf, snap1, a2, snap2, rt, a3 } };
}

describe("cropCandidates", () => {
	it("lists tool results with tokens, ages, and latest-per-tool protection", () => {
		const { tree, ids } = scenario();
		const cands = cropCandidates(tree, ids.a3);
		const byId = new Map(cands.map((c) => [c.entryId, c]));

		expect(cands).toHaveLength(4);
		expect(byId.get(ids.snap1)?.estTokens).toBe(20_000);
		expect(byId.get(ids.snap1)?.protected).toBe(false);
		expect(byId.get(ids.snap2)?.protected).toBe(true); // latest chrome.snapshot
		expect(byId.get(ids.rf)?.protected).toBe(true); // only read_file
		expect(byId.get(ids.rt)?.protected).toBe(true); // latest run_tests
		expect(byId.get(ids.snap1)?.arg).toBe("tab-audit");

		const age = (id: string) => byId.get(id)?.ageTurns ?? -1;
		expect(age(ids.snap1)).toBeGreaterThan(age(ids.snap2));
		expect(age(ids.snap2)).toBeGreaterThan(age(ids.rt));
	});
});

describe("autoSelect", () => {
	it("marks big, old, unprotected entries only", () => {
		const { tree, ids } = scenario();
		const cands = cropCandidates(tree, ids.a3);
		expect(autoSelect(cands, { minTokens: 10_000, olderThanTurns: 2 })).toEqual([ids.snap1]);
	});

	it("respects keep globs", () => {
		const { tree, ids } = scenario();
		const cands = cropCandidates(tree, ids.a3);
		expect(autoSelect(cands, { minTokens: 10_000, olderThanTurns: 0, keep: ["chrome.*"] })).toEqual([]);
	});
});

describe("planCrop", () => {
	it("anchors at the parent of the earliest marked entry and computes stubs", () => {
		const { tree, ids } = scenario();
		const plan = planCrop(tree, ids.a3, [ids.snap1, ids.snap2]);

		expect(plan.anchorId).toBe(tree.get(ids.snap1)?.parentId);
		expect(plan.reclaimTokens).toBe(20_000 + 16_000);
		expect(plan.stubs).toHaveLength(2);
		const stub = plan.stubs[0];
		expect(stub?.tool).toBe("chrome.snapshot");
		expect(stub?.sha8).toMatch(/^[0-9a-f]{8}$/);
		// deterministic
		const again = planCrop(tree, ids.a3, [ids.snap1, ids.snap2]);
		expect(again.stubs[0]?.sha8).toBe(stub?.sha8);
	});

	it("rejects marks that are not on the current path", () => {
		const { tree, ids } = scenario();
		expect(() => planCrop(tree, ids.a3, ["nonexistent"])).toThrow(/not on the current path/);
		expect(() => planCrop(tree, ids.a3, [ids.u1])).toThrow(/not croppable/);
	});
});

describe("renderReconstruction", () => {
	it("keeps unmarked content, stubs marked bodies, preserves order", () => {
		const { tree, ids } = scenario();
		const plan = planCrop(tree, ids.a3, [ids.snap1, ids.snap2]);
		const text = renderReconstruction(tree, ids.a3, plan);

		expect(text).toContain("[cropped: chrome.snapshot tab-audit");
		expect(text).toContain("[cropped: chrome.snapshot post-suspend");
		expect(text).toContain("41 suspendable tabs found");
		expect(text).toContain("[run_tests]:");
		expect(text).toContain(filler(1000)); // the KEPT run_tests body survives verbatim…
		expect(text).not.toContain("SNAPA-SNAPA-"); // …but cropped bodies do not
		expect(text).not.toContain("SNAPB-SNAPB-");
		expect(text.indexOf("tab-audit")).toBeLessThan(text.indexOf("41 suspendable"));
		expect(text.indexOf("41 suspendable")).toBeLessThan(text.indexOf("post-suspend"));
	});

	it("stubLine matches the spec format", () => {
		expect(
			stubLine({ entryId: "x", tool: "chrome.snapshot", arg: "tab-audit", estTokens: 19_400, sha8: "a3f8c2d1" }),
		).toBe("[cropped: chrome.snapshot tab-audit, ~19.4k, a3f8c2d1]");
	});
});
