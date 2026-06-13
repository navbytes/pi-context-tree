import { describe, expect, it } from "vitest";
import { contextTurns, planRemoveTurns, renderReconstruction } from "../src/crop.ts";
import { SessionBuilder, filler } from "../src/testkit.ts";
import { SessionTree } from "../src/tree.ts";

/**
 * u1 "audit"      → A "checking" (call rf) → rf → A "found storage"
 * u2 "suspend"    → A "suspending" (call snap) → snap(40k) → A "done, 41 tabs"
 * u3 "thanks"     → A "you're welcome"  (leaf)
 */
function scenario() {
	const b = new SessionBuilder();
	const u1 = b.user("audit my tabs");
	const rf = b.toolUse("read_file", { path: "src/storage.ts" }, filler(1200));
	const a1 = b.assistant("found storage layer");
	const u2 = b.user("now suspend the noisy ones");
	const snap = b.toolUse("chrome.snapshot", { url: "tab-audit" }, filler(40_000, "SNAP-"));
	const a2 = b.assistant("done, 41 tabs suspended");
	const u3 = b.user("thanks");
	const a3 = b.assistant("you're welcome");
	const { entries } = b.build();
	return { tree: SessionTree.fromEntries(entries), ids: { u1, rf, a1, u2, snap, a2, u3, a3 } };
}

describe("contextTurns", () => {
	it("groups each user question with its answers up to the next question", () => {
		const { tree, ids } = scenario();
		const turns = contextTurns(tree, ids.a3);

		expect(turns.map((t) => t.userId)).toEqual([ids.u1, ids.u2, ids.u3]);
		expect(turns[0]?.label).toBe("audit my tabs");
		// turn = the user message + every answer entry it spawned (toolUse = assistant toolCall + result)
		expect(turns[0]?.entryIds[0]).toBe(ids.u1);
		expect(turns[0]?.entryIds).toContain(ids.rf);
		expect(turns[0]?.entryIds).toContain(ids.a1);
		expect(turns[0]?.entryIds).toHaveLength(4);
		expect(turns[1]?.entryIds).toContain(ids.snap);
		expect(turns[1]?.entryIds).toContain(ids.a2);
		expect(turns[2]?.entryIds).toEqual([ids.u3, ids.a3]);
		// the fat turn dominates token-wise
		expect(turns[1]?.estTokens).toBeGreaterThan(9_000);
		expect(turns[2]?.estTokens).toBeLessThan(100);
	});

	it("treats injected custom_messages (decision records) as boundaries, never turn members", () => {
		const b = new SessionBuilder();
		const u1 = b.user("kickoff");
		b.assistant("ok");
		const fork = b.fork("feat");
		b.at(fork);
		const dec = b.decision(fork, "feat", "## Decision: feat\n**Outcome:** done.");
		b.close(fork, "squashed", { decisionEntryId: dec });
		const u2 = b.user("next");
		const a2 = b.assistant("sure");
		const { entries } = b.build();
		const tree = SessionTree.fromEntries(entries);
		const turns = contextTurns(tree, a2);
		// the decision record is its own context entry, not swept into either turn
		expect(turns.map((t) => t.userId)).toEqual([u1, u2]);
		for (const t of turns) expect(t.entryIds).not.toContain(dec);
	});
});

describe("planRemoveTurns", () => {
	it("anchors at the parent of the earliest removed turn and reclaims the whole turn", () => {
		const { tree, ids } = scenario();
		const plan = planRemoveTurns(tree, ids.a3, [ids.u2]);

		expect(plan.anchorId).toBe(tree.get(ids.u2)?.parentId);
		expect(plan.stubs).toEqual([]);
		expect(plan.dropped).toHaveLength(1);
		const drop = plan.dropped[0];
		expect(drop?.userId).toBe(ids.u2);
		expect(drop?.entryIds[0]).toBe(ids.u2);
		expect(drop?.entryIds).toContain(ids.snap);
		expect(drop?.entryIds).toContain(ids.a2);
		expect(drop?.label).toBe("now suspend the noisy ones");
		expect(drop?.sha8).toMatch(/^[0-9a-f]{8}$/);
		expect(plan.reclaimTokens).toBeGreaterThan(9_000);
		// deterministic
		expect(planRemoveTurns(tree, ids.a3, [ids.u2]).dropped[0]?.sha8).toBe(drop?.sha8);
	});

	it("rejects ids that are not turn openers", () => {
		const { tree, ids } = scenario();
		expect(() => planRemoveTurns(tree, ids.a3, [ids.snap])).toThrow(/not a user question/);
		expect(() => planRemoveTurns(tree, ids.a3, ["nope"])).toThrow(/not a user question/);
	});
});

describe("renderReconstruction with dropped turns", () => {
	it("omits the whole turn, leaves a recoverable drop note, keeps later turns verbatim", () => {
		const { tree, ids } = scenario();
		const plan = planRemoveTurns(tree, ids.a3, [ids.u2]);
		const text = renderReconstruction(tree, ids.a3, plan);

		// the removed turn is gone entirely — question text NOT echoed back into context
		expect(text).not.toContain("now suspend the noisy ones");
		expect(text).not.toContain("done, 41 tabs suspended");
		expect(text).not.toContain("SNAP-SNAP-");
		// a single label-free drop note marks where it was, with a recovery handle
		expect(text).toContain("[dropped turn — ");
		expect(text).toContain("recoverable:");
		expect((text.match(/\[dropped turn —/g) ?? []).length).toBe(1);
		// the later turn survives verbatim
		expect(text).toContain("thanks");
		expect(text).toContain("you're welcome");
	});

	it("removes several turns and keeps the survivor in order", () => {
		const { tree, ids } = scenario();
		const plan = planRemoveTurns(tree, ids.a3, [ids.u1, ids.u3]);
		const text = renderReconstruction(tree, ids.a3, plan);
		expect(text).not.toContain("found storage layer"); // u1's answer gone
		expect(text).not.toContain("you're welcome"); // u3's answer gone
		expect(text).toContain("now suspend the noisy ones"); // the un-removed middle turn stays live
		expect(text).toContain("done, 41 tabs suspended");
		expect((text.match(/\[dropped turn —/g) ?? []).length).toBe(2);
	});
});
