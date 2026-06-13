import { describe, expect, it } from "vitest";
import type { Deps } from "../src/adapter.ts";
import { branchHandler } from "../src/branch.ts";
import { mergeHandler } from "../src/merge.ts";
import { undoHandler } from "../src/undo.ts";
import { makeFake } from "./fake-pi.ts";

const deps: Deps = { draft: async () => "## Decision: fix-flaky-test\n**Outcome:** done.\n" };

describe("/undo last mutation (append-only, last-only)", () => {
	it("re-opens a squashed branch at its pre-merge leaf, deleting nothing", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		w.session.assistant("plan");
		await branchHandler(w.pi, w.ctx, "fix-flaky-test haiku-4.5");
		w.session.user("tests flake");
		const tip = w.session.assistant("root cause"); // the pre-merge leaf (branch tip)
		w.ui.editorQueue.push("__ACCEPT_PREFILL__");
		await mergeHandler(w.pi, w.ctx, "--squash", deps);
		const countAfterMerge = w.session.entries.length;

		w.ui.confirmQueue.push(true);
		await undoHandler(w.pi, w.ctx);

		expect(w.calls.navigate.at(-1)?.target).toBe(tip); // back on the branch
		expect(w.session.entries.length).toBe(countAfterMerge); // append-only: nothing removed
	});

	it("restores the pre-crop leaf recorded by the crop marker", async () => {
		const w = makeFake();
		const preCrop = w.session.user("original fat context");
		// what applyCropPlan writes: a crop-tail reconstruction + a ctree/crop marker carrying sourceLeafId
		const stub = { entryId: "x002", tool: "chrome.snapshot", estTokens: 20_000, sha8: "abcd1234" };
		w.session.append({
			type: "custom_message",
			customType: "ctree/crop-tail",
			content: "[reconstruction]",
			details: { v: 1, sourceLeafId: preCrop, stubbed: [stub] },
		});
		w.session.append({
			type: "custom",
			customType: "ctree/crop",
			data: { v: 1, sourceLeafId: preCrop, stubbed: [stub] },
		});

		w.ui.confirmQueue.push(true);
		await undoHandler(w.pi, w.ctx);
		expect(w.calls.navigate.at(-1)?.target).toBe(preCrop);
	});

	it("undoes a /branch back to where you branched", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		const here = w.session.assistant("plan"); // pre-branch leaf
		await branchHandler(w.pi, w.ctx, "side-quest");

		w.ui.confirmQueue.push(true);
		await undoHandler(w.pi, w.ctx);
		expect(w.calls.navigate.at(-1)?.target).toBe(here);
	});

	it("says there's nothing to undo on a plain session", async () => {
		const w = makeFake();
		w.session.user("just chatting");
		await undoHandler(w.pi, w.ctx);
		expect(w.ui.notes().some((n) => n.includes("nothing to undo"))).toBe(true);
		expect(w.calls.navigate).toHaveLength(0);
	});

	it("does nothing when the user declines the confirm", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		w.session.assistant("plan");
		await branchHandler(w.pi, w.ctx, "side-quest");
		const navBefore = w.calls.navigate.length;

		w.ui.confirmQueue.push(false);
		await undoHandler(w.pi, w.ctx);
		expect(w.calls.navigate.length).toBe(navBefore); // no navigation
		expect(w.ui.notes().some((n) => n.includes("cancelled"))).toBe(true);
	});
});
