import { type CtreeForkData, ctreeForkData } from "@pi-context-tree/core";
import { describe, expect, it } from "vitest";
import { branchHandler, registerBranch } from "../src/branch.ts";
import { forgetCtx, rememberCtx } from "../src/ctx-cache.ts";
import { entriesByType, makeFake } from "./fake-pi.ts";

describe("/branch", () => {
	it("appends a fork entry, mirrors a native label, and switches model", async () => {
		const { pi, ctx, ui, session, calls } = makeFake();
		session.user("kickoff");
		session.assistant("plan");

		await branchHandler(pi, ctx, "fix-flaky-test haiku-4.5");

		const forks = entriesByType(session, "custom", "ctree/fork");
		expect(forks).toHaveLength(1);
		const data = ctreeForkData(forks[0]!) as CtreeForkData;
		expect(data.name).toBe("fix-flaky-test");
		expect(data.trunkModel).toBe("anthropic/opus-4.8");
		expect(data.branchModel).toBe("anthropic/haiku-4.5");
		expect(data.status).toBe("open");
		expect(calls.labels).toEqual([[forks[0]!.id, "fix-flaky-test"]]);
		expect(calls.setModel.map((m) => m.id)).toEqual(["haiku-4.5"]);
		expect(ui.notes().some((n) => n.includes("branched: fix-flaky-test"))).toBe(true);
		expect(ui.statuses.get("ctree")).toContain("fix-flaky-test");
		expect(ui.titles.at(-1)).toContain("(fix-flaky-test)");
	});

	it("rejects bad names, duplicates, and unknown models without writing", async () => {
		const { pi, ctx, ui, session, calls } = makeFake();
		session.user("kickoff");

		await branchHandler(pi, ctx, "no spaces allowed");
		await branchHandler(pi, ctx, "");
		expect(entriesByType(session, "custom", "ctree/fork")).toHaveLength(0);

		await branchHandler(pi, ctx, "real-branch");
		await branchHandler(pi, ctx, "real-branch");
		expect(entriesByType(session, "custom", "ctree/fork")).toHaveLength(1);
		expect(ui.notes().some((n) => n.includes("already exists"))).toBe(true);

		await branchHandler(pi, ctx, "other mystery-model-9000");
		expect(entriesByType(session, "custom", "ctree/fork")).toHaveLength(1);
		expect(calls.setModel).toHaveLength(0);
	});

	it("resolves provider/id model refs", async () => {
		const { pi, ctx, session, calls } = makeFake();
		session.user("kickoff");
		await branchHandler(pi, ctx, "try-gpt openai/gpt-5.2");
		expect(calls.setModel.map((m) => `${m.provider}/${m.id}`)).toEqual(["openai/gpt-5.2"]);
	});
});

describe("/branch model autocomplete (remembered-ctx bridge)", () => {
	it("completes the model argument from the registry seen on the last event", () => {
		const { pi, ctx, completions } = makeFake();
		registerBranch(pi);
		rememberCtx(ctx); // ambient events stash the ctx — completions have no ctx param in pi 0.79.1
		const complete = completions.get("branch");
		expect(complete?.("fix-x ha")?.map((c) => c.value)).toEqual(["anthropic/haiku-4.5"]);
		expect(complete?.("fix-x anthropic/")?.map((c) => c.value)).toEqual([
			"anthropic/opus-4.8",
			"anthropic/haiku-4.5",
		]);
	});

	it("offers nothing for the name argument or when no ctx has been seen", () => {
		const { pi, completions } = makeFake();
		registerBranch(pi);
		forgetCtx();
		const complete = completions.get("branch");
		expect(complete?.("fix")).toBeNull(); // first arg = branch name, not a model
		expect(complete?.("fix-x ha")).toBeNull(); // no ctx seen yet
	});
});
