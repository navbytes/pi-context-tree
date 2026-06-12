import { describe, expect, it } from "vitest";
import { SessionBuilder, filler } from "../src/testkit.ts";
import { PanelVm } from "../src/vm/panel.ts";

/** branched session: squashed fork w/ sibling work, dangling fork, active fork */
function build() {
	const b = new SessionBuilder();
	b.user("kickoff");
	const plan = b.assistant("plan");
	const storage = b.fork("storage-layer");
	b.user("noisy branch work");
	b.at(storage);
	const dec = b.decision(storage, "storage-layer", "## Decision: storage-layer\nchose session storage");
	b.close(storage, "squashed", { decisionEntryId: dec });
	const snap = b.toolUse("chrome.snapshot", { url: "tab-audit" }, filler(60_000));
	b.assistant("analysis");
	const snap2 = b.toolUse("chrome.snapshot", { url: "after" }, filler(400)); // latest snapshot → snap is unprotected
	const perf = b.fork("perf-spike");
	b.user("perf rabbit hole");
	b.at(snap2);
	const fix = b.fork("fix-flaky-test", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
	b.user("tests flake");
	const rt = b.toolUse("run_tests", {}, filler(8_000));
	const leaf = b.assistant("root cause found");
	const { entries } = b.build();
	return { entries, ids: { plan, storage, dec, snap, perf, fix, rt, leaf } };
}

function vm(overrides: Record<string, unknown> = {}) {
	const { entries, ids } = build();
	return {
		vm: new PanelVm({ entries, project: "tabwrangler", model: "haiku-4.5", contextWindow: 200_000, ...overrides }),
		ids,
	};
}

describe("PanelVm header", () => {
	it("derives branch name from the nearest open fork and bands the gauge", () => {
		const { vm: p } = vm();
		const h = p.header();
		expect(h.branchName).toBe("fix-flaky-test");
		expect(h.window).toBe(200_000);
		expect(h.tokens).toBeGreaterThan(15_000);
		expect(["low", "healthy", "filling", "red"]).toContain(h.band);
	});
});

describe("PanelVm tree view", () => {
	it("renders fork rows with presentation and folds closed forks by default", () => {
		const { vm: p } = vm();
		const rows = p.rows();
		const forkRows = rows.filter((r) => r.kind === "fork");
		const byName = new Map(forkRows.map((r) => [r.forkName, r]));
		expect(byName.get("storage-layer")?.presentation).toBe("squashed");
		expect(byName.get("storage-layer")?.folded).toBe(true);
		expect(byName.get("perf-spike")?.presentation).toBe("dangling");
		expect(byName.get("fix-flaky-test")?.presentation).toBe("active");
		// folded squashed fork hides its noisy child
		expect(rows.some((r) => r.text.includes("noisy branch work"))).toBe(false);
		// active fork's descendants visible, leaf marked
		expect(rows.some((r) => r.text.includes("tests flake"))).toBe(true);
		expect(rows.find((r) => r.current)?.text).toContain("root cause");
	});

	it("unfolds on enter and refolds, keeping selection in range", () => {
		const { vm: p } = vm();
		const idx = p.rows().findIndex((r) => r.kind === "fork" && r.forkName === "storage-layer");
		while (p.sel < idx) p.handleKey("j");
		const before = p.rows().length;
		p.handleKey("enter");
		expect(p.rows().length).toBeGreaterThan(before);
		expect(p.rows().some((r) => r.text.includes("noisy branch work"))).toBe(true);
		p.handleKey("enter");
		expect(p.rows().length).toBe(before);
	});

	it("emits jump on enter over a plain entry, branch on b, merge on m, close on q", () => {
		const { vm: p, ids } = vm();
		const idx = p.rows().findIndex((r) => r.id === ids.plan);
		while (p.sel < idx) p.handleKey("j");
		expect(p.handleKey("enter").action).toEqual({ type: "jump", entryId: ids.plan });
		expect(p.handleKey("b").action).toEqual({ type: "branch", entryId: ids.plan });
		expect(p.handleKey("m").action).toEqual({ type: "merge" });
		expect(p.handleKey("q").action).toEqual({ type: "close" });
	});

	it("flags huge entries with warn", () => {
		const { vm: p, ids } = vm();
		const snapRow = p.rows().find((r) => r.id === ids.snap);
		expect(snapRow?.warn).toBe(true);
		expect(snapRow?.tokens).toBe(15_000);
	});
});

describe("PanelVm crop view", () => {
	it("marks with space, arms protected entries, applies with enter", () => {
		const { vm: p, ids } = vm();
		p.handleKey("c");
		expect(p.view).toBe("crop");
		const rows = p.rows();
		const snapIdx = rows.findIndex((r) => r.id === ids.snap);
		while (p.sel < snapIdx) p.handleKey("j");
		p.handleKey("space");
		expect(p.rows()[snapIdx]?.marked).toBe(true);

		// protected run_tests needs space twice
		const rtIdx = p.rows().findIndex((r) => r.id === ids.rt);
		while (p.sel < rtIdx) p.handleKey("j");
		const eff = p.handleKey("space");
		expect(eff.notify).toMatch(/latest/);
		expect(p.rows()[rtIdx]?.marked).toBe(false);
		p.handleKey("space");
		expect(p.rows()[rtIdx]?.marked).toBe(true);

		const apply = p.handleKey("enter");
		expect(apply.action?.type).toBe("crop-apply");
		if (apply.action?.type === "crop-apply") {
			expect(apply.action.plan.marked).toContain(ids.snap);
			expect(apply.action.plan.reclaimTokens).toBeGreaterThan(15_000);
		}
	});

	it("pre-marks via --auto rules with a", () => {
		const { vm: p, ids } = vm();
		p.handleKey("c");
		p.handleKey("a");
		const marked = p.rows().filter((r) => r.marked);
		expect(marked.map((r) => r.id)).toEqual([ids.snap]);
	});

	it("esc returns to tree without applying", () => {
		const { vm: p } = vm();
		p.handleKey("c");
		p.handleKey("esc");
		expect(p.view).toBe("tree");
	});
});

describe("PanelVm other views", () => {
	it("shows consumers sorted desc and returns to tree", () => {
		const { vm: p } = vm();
		p.handleKey("u");
		expect(p.view).toBe("consumers");
		const rows = p.rows();
		expect(rows[0]?.text).toContain("chrome.snapshot");
		p.handleKey("esc");
		expect(p.view).toBe("tree");
	});

	it("lists decisions and jumps on enter", () => {
		const { vm: p, ids } = vm();
		p.handleKey("D");
		expect(p.view).toBe("decisions");
		const eff = p.handleKey("enter");
		expect(eff.action).toEqual({ type: "jump", entryId: ids.dec });
	});

	it("inspects the selected entry with i", () => {
		const { vm: p, ids } = vm();
		const idx = p.rows().findIndex((r) => r.id === ids.snap);
		while (p.sel < idx) p.handleKey("j");
		p.handleKey("i");
		expect(p.view).toBe("inspect");
		expect(p.rows().some((r) => r.text.includes("chrome.snapshot"))).toBe(true);
	});
});

describe("PanelVm section titles (mockup sectheads)", () => {
	it("tree shows trunk+branches with the estimator note, session name when present", () => {
		const { vm: p } = vm({ sessionName: "2026-06-12-a" });
		expect(p.sectionTitle()).toBe("SESSION 2026-06-12-a · TRUNK + BRANCHES · est tokens (~chars/4)");
		const { vm: bare } = vm();
		expect(bare.sectionTitle()).toBe("TRUNK + BRANCHES · est tokens (~chars/4)");
	});

	it("crop shows a live reclaim total for marked entries", () => {
		const { vm: p, ids } = vm();
		p.handleKey("c");
		expect(p.sectionTitle()).toContain("CROP — TOOL/MCP RESULTS ON THIS BRANCH");
		expect(p.sectionTitle()).toContain("reclaim ~0");
		const idx = p.rows().findIndex((r) => r.id === ids.snap);
		while (p.sel < idx) p.handleKey("j");
		p.handleKey("space");
		expect(p.sectionTitle()).toContain("reclaim ~15k");
		expect(p.sectionTitle()).toContain("originals untouched");
	});

	it("names the consumers and decisions views", () => {
		const { vm: p } = vm();
		p.handleKey("u");
		expect(p.sectionTitle()).toBe("TOKENS BY SOURCE — CURRENT BRANCH CONTEXT");
		p.handleKey("esc");
		p.handleKey("D");
		expect(p.sectionTitle()).toBe("DECISION RECORDS ON TRUNK (newest first)");
	});
});

describe("PanelVm decisions cards (mockup contract)", () => {
	function cardVm() {
		const b = new SessionBuilder();
		b.user("kickoff");
		const a0 = b.assistant("two options");
		const early = b.fork("storage-layer", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
		b.user("storage work");
		b.at(early);
		const dec1 = b.decision(early, "storage-layer", "## Decision: storage-layer\n**Outcome:** session storage won.");
		b.close(early, "squashed", { decisionEntryId: dec1 });
		const alt = b.fork("alt-b", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
		b.user("try b");
		b.assistant("works");
		b.at(alt);
		const dec2 = b.customMessage(
			"ctree/decision",
			"## Decision: alt-b\n**Outcome:** B wins on simplicity.\n**Why:**\n- speed",
			true,
			{ v: 1, forkEntryId: alt, branchName: "alt-b", siblings: [{ name: "alt-a", reason: "too clever" }] },
		);
		b.close(alt, "squashed", { decisionEntryId: dec2 });
		b.user("onwards");
		const p = new PanelVm({ entries: b.build().entries, project: "tabwrangler" });
		p.handleKey("D");
		return { p, dec1, dec2, alt };
	}

	it("renders each record as a card: header, meta, outcome, epitaphs — newest first", () => {
		const { p, dec2, alt } = cardVm();
		const rows = p.rows();
		expect(rows[0]?.glyph).toBe("◆");
		expect(rows[0]?.text).toBe("alt-b");
		expect(rows[0]?.id).toBe(dec2);
		const meta = rows[1];
		expect(meta?.dim).toBe(true);
		expect(meta?.text).toContain("2026-06-12");
		expect(meta?.text).toContain("drafted by haiku-4.5");
		expect(meta?.text).toContain(`branch ${alt}`);
		expect(meta?.text).toContain("human-confirmed ✓");
		expect(rows[2]?.text).toBe("B wins on simplicity.");
		const epitaph = rows[3];
		expect(epitaph?.glyph).toBe("✗");
		expect(epitaph?.text).toBe("alt-a — too clever");
		// older record's card follows
		const older = rows.findIndex((r) => r.text === "storage-layer" && r.glyph === "◆");
		expect(older).toBeGreaterThan(3);
		expect(rows[older + 2]?.text).toBe("session storage won.");
		// G3 note trails the list
		expect(rows[rows.length - 1]?.text).toContain("G3");
	});

	it("jumps to the record from any row of its card", () => {
		const { p, dec2 } = cardVm();
		p.handleKey("j"); // meta row
		expect(p.handleKey("enter").action).toEqual({ type: "jump", entryId: dec2 });
	});
});

describe("PanelVm read-only mode (pitree)", () => {
	it("blocks mutating actions with a notify", () => {
		const { vm: p } = vm({ readOnly: true });
		expect(p.handleKey("m").action).toBeUndefined();
		expect(p.handleKey("m").notify).toMatch(/read-only/);
		expect(p.handleKey("b").action).toBeUndefined();
		p.handleKey("c");
		p.handleKey("space");
		expect(p.rows().every((r) => !r.marked)).toBe(true);
	});
});
