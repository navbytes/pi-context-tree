import { describe, expect, it } from "vitest";
import { decisionsOnPath, extractForks, nearestOpenFork, siblingForks } from "../src/ctree.ts";
import { SessionBuilder } from "../src/testkit.ts";
import { SessionTree } from "../src/tree.ts";

/**
 * Trunk: u1 → a1 → [fork storage (closed squashed + decision)] → ◆ → t1
 *        → [fork perf (open, abandoned — dangling)] (branch has one user msg)
 *        → [fork fix (open)] → u3 → a3   ← current leaf
 */
function scenario() {
	const b = new SessionBuilder();
	const u1 = b.user("kickoff");
	const a1 = b.assistant("plan");
	const storage = b.fork("storage-layer", { branchModel: "haiku-4.5" });
	b.user("try storage approaches"); // noisy branch work…
	b.at(storage); // …merge returns to the label; work stays on a sibling branch
	const dec = b.decision(storage, "storage-layer", "## Decision: storage-layer\n…");
	const closeStorage = b.close(storage, "squashed", { decisionEntryId: dec });
	const t1 = b.toolResult("read_file", "src body");
	const perf = b.fork("perf-spike");
	const perfMsg = b.user("perf rabbit hole");
	b.at(t1);
	const fix = b.fork("fix-flaky-test", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
	const u3 = b.user("tests flake");
	const a3 = b.assistant("root cause found");
	return { b, ids: { u1, a1, storage, dec, closeStorage, t1, perf, perfMsg, fix, u3, a3 } };
}

describe("extractForks", () => {
	it("derives status and presentation per fork", () => {
		const { b, ids } = scenario();
		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, ids.a3);

		const byName = new Map(forks.map((f) => [f.data.name, f]));
		expect(byName.get("storage-layer")?.status).toBe("squashed");
		expect(byName.get("storage-layer")?.presentation).toBe("squashed");
		expect(byName.get("perf-spike")?.status).toBe("open");
		expect(byName.get("perf-spike")?.presentation).toBe("dangling");
		expect(byName.get("fix-flaky-test")?.status).toBe("open");
		expect(byName.get("fix-flaky-test")?.presentation).toBe("active");
	});

	it("maps discarded to the rejected presentation", () => {
		const b = new SessionBuilder();
		b.user("x");
		const f = b.fork("dead-end");
		b.user("nope");
		b.close(f, "discarded", { note: "wrong theory" });
		const tree = SessionTree.fromEntries(b.build().entries);
		const [fork] = extractForks(tree, tree.fileLeafId() ?? "");
		expect(fork?.status).toBe("discarded");
		expect(fork?.presentation).toBe("rejected");
		expect(fork?.close?.data.note).toBe("wrong theory");
	});

	it("lets the latest close marker win", () => {
		const b = new SessionBuilder();
		b.user("x");
		const f = b.fork("twice-closed");
		b.close(f, "rejected");
		b.close(f, "squashed");
		const tree = SessionTree.fromEntries(b.build().entries);
		const [fork] = extractForks(tree, tree.fileLeafId() ?? "");
		expect(fork?.status).toBe("squashed");
	});

	it("ignores malformed ctree/fork payloads with a warning flag", () => {
		const b = new SessionBuilder();
		b.user("x");
		b.custom("ctree/fork", { v: 99, totally: "different" });
		const tree = SessionTree.fromEntries(b.build().entries);
		expect(extractForks(tree, tree.fileLeafId() ?? "")).toHaveLength(0);
	});
});

describe("siblingForks", () => {
	it("finds open forks sharing parentEntryId (tournament set)", () => {
		const b = new SessionBuilder();
		b.user("kickoff");
		const anchor = b.assistant("let us try three ways");
		const fa = b.fork("storage-a");
		b.user("a work");
		b.at(anchor);
		const fb = b.fork("storage-b");
		b.user("b work");
		b.at(anchor);
		const fc = b.fork("storage-c");
		const cLeaf = b.user("c work");

		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, cLeaf);
		const sibs = siblingForks(forks, fc);
		expect(sibs.map((s) => s.entryId).sort()).toEqual([fa, fb].sort());
	});

	it("excludes closed forks from the sibling set", () => {
		const b = new SessionBuilder();
		const anchor = b.user("anchor");
		const fa = b.fork("a");
		b.at(anchor);
		const fb = b.fork("b");
		b.close(fa, "rejected");
		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, tree.fileLeafId() ?? "");
		expect(siblingForks(forks, fb)).toHaveLength(0);
	});
});

describe("nearestOpenFork", () => {
	it("returns the closest open fork walking leaf→root", () => {
		const { b, ids } = scenario();
		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, ids.a3);
		expect(nearestOpenFork(tree, ids.a3, forks)?.entryId).toBe(ids.fix);
	});

	it("returns undefined on a trunk with no open fork above the leaf", () => {
		const { b, ids } = scenario();
		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, ids.t1);
		expect(nearestOpenFork(tree, ids.t1, forks)).toBeUndefined();
	});

	it("supports nesting: inner fork wins", () => {
		const b = new SessionBuilder();
		b.user("x");
		const outer = b.fork("outer");
		b.user("in outer");
		const inner = b.fork("inner");
		const leaf = b.user("in inner");
		const tree = SessionTree.fromEntries(b.build().entries);
		const forks = extractForks(tree, leaf);
		expect(nearestOpenFork(tree, leaf, forks)?.entryId).toBe(inner);
		expect(forks.find((f) => f.entryId === inner)?.depth).toBe(2);
		expect(forks.find((f) => f.entryId === outer)?.depth).toBe(1);
	});
});

describe("decisionsOnPath", () => {
	it("lists ctree/decision records on the current path, root→leaf", () => {
		const { b, ids } = scenario();
		const tree = SessionTree.fromEntries(b.build().entries);
		const decs = decisionsOnPath(tree, ids.a3);
		expect(decs.map((d) => d.id)).toEqual([ids.dec]);
	});
});
