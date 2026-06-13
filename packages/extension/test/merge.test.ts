import type { CtreeCloseData } from "@pi-context-tree/core";
import { describe, expect, it } from "vitest";
import type { Deps } from "../src/adapter.ts";
import { branchHandler } from "../src/branch.ts";
import { mergeHandler } from "../src/merge.ts";
import { type FakeWorld, entriesByType, makeFake } from "./fake-pi.ts";

const CANNED_RECORD = "## Decision: fix-flaky-test\n**Outcome:** fixed tmpdir collision.\n";

function depsWith(record = CANNED_RECORD): Deps & { draftCalls: { system: string; user: string }[] } {
	const draftCalls: { system: string; user: string }[] = [];
	return {
		draftCalls,
		draft: async (_ctx, _model, system, user) => {
			draftCalls.push({ system, user });
			if (system.includes("epitaph")) return "breaks on MV3 event-page suspension";
			return record;
		},
	};
}

async function seedBranch(w: FakeWorld): Promise<string> {
	w.session.user("kickoff");
	w.session.assistant("plan");
	await branchHandler(w.pi, w.ctx, "fix-flaky-test haiku-4.5");
	const fork = entriesByType(w.session, "custom", "ctree/fork")[0]!;
	w.session.user("tests flake");
	w.session.toolResult("run_tests", "2 failed, then 1 passed");
	w.session.assistant("root cause: tmpdir collision");
	return fork.id;
}

describe("/merge --squash", () => {
	it("drafts, gates on the editor, then writes decision → close → restores trunk model", async () => {
		const w = makeFake();
		const deps = depsWith();
		const forkId = await seedBranch(w);
		w.ui.editorQueue.push("## Decision: fix-flaky-test (EDITED)\nbody");

		await mergeHandler(w.pi, w.ctx, "--squash", deps);

		// draft saw the branch transcript
		expect(deps.draftCalls[0]?.user).toContain("tests flake");
		// navigation suppressed pi's summarize-on-leave (F2.5)
		expect(w.calls.navigate).toEqual([{ target: forkId, options: { summarize: false } }]);
		// decision landed as custom_message with the EDITED text
		const decisions = entriesByType(w.session, "custom_message", "ctree/decision");
		expect(decisions).toHaveLength(1);
		expect((decisions[0] as { content?: string }).content).toContain("(EDITED)");
		// close marker references the decision, status squashed
		const closes = entriesByType(w.session, "custom", "ctree/close");
		expect(closes).toHaveLength(1);
		const close = (closes[0] as { data?: CtreeCloseData }).data!;
		expect(close.status).toBe("squashed");
		expect(close.forkEntryId).toBe(forkId);
		expect(close.decisionEntryId).toBe(decisions[0]!.id);
		// decision written BEFORE close (TRD §5 ordering)
		expect(w.session.entries.indexOf(decisions[0]!)).toBeLessThan(w.session.entries.indexOf(closes[0]!));
		// trunk model restored
		expect(w.calls.setModel.at(-1)?.id).toBe("opus-4.8");
	});

	it("aborts cleanly when the editor is cancelled — nothing written, no navigation", async () => {
		const w = makeFake();
		await seedBranch(w);
		w.ui.editorQueue.push(undefined);

		await mergeHandler(w.pi, w.ctx, "--squash", depsWith());

		expect(w.calls.navigate).toHaveLength(0);
		expect(entriesByType(w.session, "custom_message", "ctree/decision")).toHaveLength(0);
		expect(entriesByType(w.session, "custom", "ctree/close")).toHaveLength(0);
		expect(w.ui.notes().some((n) => n.includes("aborted"))).toBe(true);
	});

	it("falls back to the manual template when drafting fails", async () => {
		const w = makeFake();
		await seedBranch(w);
		w.ui.editorQueue.push("__ACCEPT_PREFILL__");
		const deps: Deps = {
			draft: async () => {
				throw new Error("no API key");
			},
		};

		await mergeHandler(w.pi, w.ctx, "--squash", deps);

		const decisions = entriesByType(w.session, "custom_message", "ctree/decision");
		expect(decisions).toHaveLength(1);
		expect((decisions[0] as { content?: string }).content).toContain("## Decision: fix-flaky-test");
		expect(w.ui.notes().some((n) => n.includes("drafting failed"))).toBe(true);
	});

	it("errors with guidance when no open fork exists (F2.1)", async () => {
		const w = makeFake();
		w.session.user("plain trunk");
		await mergeHandler(w.pi, w.ctx, "", depsWith());
		expect(w.ui.notes().some((n) => n.includes("/branch <name> first"))).toBe(true);
		expect(w.calls.navigate).toHaveLength(0);
	});
});

describe("/merge --discard", () => {
	it("returns to the label, injects nothing, closes as discarded with the note", async () => {
		const w = makeFake();
		const forkId = await seedBranch(w);

		await mergeHandler(w.pi, w.ctx, "--discard wrong theory", depsWith());

		expect(entriesByType(w.session, "custom_message", "ctree/decision")).toHaveLength(0);
		const close = (entriesByType(w.session, "custom", "ctree/close")[0] as { data?: CtreeCloseData }).data!;
		expect(close.status).toBe("discarded");
		expect(close.note).toBe("wrong theory");
		expect(close.forkEntryId).toBe(forkId);
		expect(w.calls.navigate[0]?.target).toBe(forkId);
		expect(w.calls.setModel.at(-1)?.id).toBe("opus-4.8");
	});
});

describe("/merge --tournament", () => {
	it("combines winner record + epitaphs in ONE node and closes all siblings", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		const anchor = w.session.assistant("three ways to do storage");
		await branchHandler(w.pi, w.ctx, "storage-a");
		w.session.user("a work");
		w.session.at(anchor);
		await branchHandler(w.pi, w.ctx, "storage-b");
		w.session.user("b work");
		w.session.at(anchor);
		await branchHandler(w.pi, w.ctx, "storage-c");
		w.session.user("c work — the winner");
		w.ui.editorQueue.push("__ACCEPT_PREFILL__");

		await mergeHandler(
			w.pi,
			w.ctx,
			"--tournament",
			depsWith("## Decision: storage-c\n**Outcome:** session storage wins.\n"),
		);

		const decisions = entriesByType(w.session, "custom_message", "ctree/decision");
		expect(decisions).toHaveLength(1);
		const content = (decisions[0] as { content?: string }).content ?? "";
		expect(content).toContain("### Rejected alternatives");
		expect(content).toContain("**storage-a:**");
		expect(content).toContain("**storage-b:**");
		const closes = entriesByType(w.session, "custom", "ctree/close").map((c) => (c as { data?: CtreeCloseData }).data!);
		expect(closes).toHaveLength(3);
		expect(closes.filter((c) => c.status === "squashed")).toHaveLength(1);
		expect(closes.filter((c) => c.status === "rejected")).toHaveLength(2);
	});

	it("refuses tournament with no open siblings (F2.4)", async () => {
		const w = makeFake();
		await seedBranch(w);
		await mergeHandler(w.pi, w.ctx, "--tournament", depsWith());
		expect(w.ui.notes().some((n) => n.includes("sibling"))).toBe(true);
		expect(entriesByType(w.session, "custom", "ctree/close")).toHaveLength(0);
	});
});

describe("/merge default mode (bare = squash, --pick = selector)", () => {
	it("bare /merge defaults to squash — no 'pick a mode' tax, straight to the editor gate", async () => {
		const w = makeFake();
		const forkId = await seedBranch(w);
		w.ui.editorQueue.push("__ACCEPT_PREFILL__");

		await mergeHandler(w.pi, w.ctx, "", depsWith());

		expect(w.ui.selectCalls).toHaveLength(0); // no selector on the 99% path
		expect(entriesByType(w.session, "custom_message", "ctree/decision")).toHaveLength(1);
		const close = (entriesByType(w.session, "custom", "ctree/close")[0] as { data?: CtreeCloseData }).data!;
		expect(close.status).toBe("squashed");
		expect(close.forkEntryId).toBe(forkId);
	});

	it("--pick opens the native selector and honors the choice", async () => {
		const w = makeFake();
		const forkId = await seedBranch(w);
		w.ui.selectQueue.push("discard — return to the label, inject nothing, mark rejected");
		w.ui.inputQueue.push("dead end");

		await mergeHandler(w.pi, w.ctx, "--pick", depsWith());

		expect(w.ui.selectCalls[0]?.title).toContain("fix-flaky-test");
		const close = (entriesByType(w.session, "custom", "ctree/close")[0] as { data?: CtreeCloseData }).data!;
		expect(close.status).toBe("discarded");
		expect(close.forkEntryId).toBe(forkId);
	});
});
