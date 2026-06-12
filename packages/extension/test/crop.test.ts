import { SessionTree, cropCandidates, planCrop } from "@pi-context-tree/core";
import { describe, expect, it } from "vitest";
import { applyCropPlan, cropHandler, parseCropFlags } from "../src/crop-cmd.ts";
import { type FakeWorld, entriesByType, makeFake } from "./fake-pi.ts";

function seedBigSession(w: FakeWorld): { snap1: string; snap2: string } {
	w.session.user("audit my tabs");
	w.session.assistant("calling snapshot");
	const snap1 = w.session.toolResult("chrome.snapshot", "S1".repeat(40_000));
	w.session.assistant("analysis of tabs");
	const snap2 = w.session.toolResult("chrome.snapshot", "S2".repeat(200));
	w.session.assistant("done");
	return { snap1, snap2 };
}

describe("parseCropFlags", () => {
	it("parses auto/dry-run/thresholds/keep globs", () => {
		const f = parseCropFlags("--auto --dry-run --min-tokens 5000 --older-than 3 --keep chrome.* --keep run_tests");
		expect(f).toEqual({
			auto: true,
			dryRun: true,
			apply: false,
			minTokens: 5000,
			olderThan: 3,
			keep: ["chrome.*", "run_tests"],
		});
	});

	it("parses --apply", () => {
		expect(parseCropFlags("--auto --apply").apply).toBe(true);
	});
});

describe("/crop --auto --apply (headless, no panel)", () => {
	it("applies the auto-selected plan without ui.custom; latest-per-tool stays protected", async () => {
		const w = makeFake();
		const { snap1 } = seedBigSession(w);
		const entriesBefore = w.session.entries.length;

		await cropHandler(w.pi, w.ctx, "--auto --min-tokens 1000 --older-than 1 --apply");

		const tails = entriesByType(w.session, "custom_message", "ctree/crop-tail");
		expect(tails).toHaveLength(1);
		const marker = entriesByType(w.session, "custom", "ctree/crop");
		expect(marker).toHaveLength(1);
		const stubbed = (marker[0] as { data?: { stubbed?: { entryId: string }[] } }).data?.stubbed ?? [];
		expect(stubbed.map((s) => s.entryId)).toEqual([snap1]); // snap2 is latest chrome.snapshot → protected
		// append-only: originals still present
		expect(w.session.entries.length).toBe(entriesBefore + 2);
		expect(w.session.entries.find((e) => e.id === snap1)).toBeDefined();
		expect(w.ui.notes().some((n) => n.includes("✂ cropped 1"))).toBe(true);
	});

	it("--dry-run wins over --apply: reports, writes nothing", async () => {
		const w = makeFake();
		seedBigSession(w);
		const entriesBefore = w.session.entries.length;

		await cropHandler(w.pi, w.ctx, "--auto --min-tokens 1000 --older-than 1 --apply --dry-run");

		expect(w.session.entries.length).toBe(entriesBefore);
		expect(w.ui.notes().some((n) => n.includes("(dry-run) would crop 1"))).toBe(true);
	});

	it("--apply without --auto is refused (interactive review applies from the panel)", async () => {
		const w = makeFake();
		seedBigSession(w);
		const entriesBefore = w.session.entries.length;

		await cropHandler(w.pi, w.ctx, "--apply");

		expect(w.session.entries.length).toBe(entriesBefore);
		expect(w.ui.notesOf("error").some((n) => n.includes("--apply needs --auto"))).toBe(true);
	});

	it("--auto --apply matching nothing writes nothing and says so", async () => {
		const w = makeFake();
		seedBigSession(w);
		const entriesBefore = w.session.entries.length;

		await cropHandler(w.pi, w.ctx, "--auto --min-tokens 999999 --apply");

		expect(w.session.entries.length).toBe(entriesBefore);
		expect(w.ui.notes().some((n) => n.includes("matched nothing"))).toBe(true);
	});
});

describe("applyCropPlan", () => {
	it("branches at the anchor, writes the crop-tail block + marker, keeps originals", async () => {
		const w = makeFake();
		const { snap1 } = seedBigSession(w);
		const tree = SessionTree.fromEntries(w.session.entries);
		const leaf = w.session.leaf!;
		const plan = planCrop(tree, leaf, [snap1]);
		const entriesBefore = w.session.entries.length;

		await applyCropPlan(w.pi, w.ctx, plan);

		// navigated to the anchor with summarize suppressed
		expect(w.calls.navigate).toEqual([{ target: plan.anchorId, options: { summarize: false } }]);
		// crop-tail custom_message carries stubs + kept content
		const tails = entriesByType(w.session, "custom_message", "ctree/crop-tail");
		expect(tails).toHaveLength(1);
		const content = (tails[0] as { content?: string }).content ?? "";
		expect(content).toContain("[cropped: chrome.snapshot");
		expect(content).toContain("analysis of tabs");
		expect(content).not.toContain("S1".repeat(500));
		// marker entry written
		expect(entriesByType(w.session, "custom", "ctree/crop")).toHaveLength(1);
		// append-only: original entries untouched, only additions
		expect(w.session.entries.length).toBe(entriesBefore + 2);
		expect(w.session.entries.find((e) => e.id === snap1)).toBeDefined();
		expect(w.ui.notes().some((n) => n.includes("✂ cropped 1"))).toBe(true);
	});

	it("re-validates the leaf and aborts if the session moved (TRD §6)", async () => {
		const w = makeFake();
		const { snap1 } = seedBigSession(w);
		const tree = SessionTree.fromEntries(w.session.entries);
		const plan = planCrop(tree, w.session.leaf!, [snap1]);

		w.session.user("a new message arrives while the panel was open");
		await applyCropPlan(w.pi, w.ctx, plan);

		expect(w.calls.navigate).toHaveLength(0);
		expect(entriesByType(w.session, "custom_message", "ctree/crop-tail")).toHaveLength(0);
		expect(w.ui.notes().some((n) => n.includes("re-run /crop"))).toBe(true);
	});

	it("protects the latest result per tool in candidates (panel enforces double-mark)", () => {
		const w = makeFake();
		const { snap1, snap2 } = seedBigSession(w);
		const tree = SessionTree.fromEntries(w.session.entries);
		const cands = cropCandidates(tree, w.session.leaf!);
		expect(cands.find((c) => c.entryId === snap1)?.protected).toBe(false);
		expect(cands.find((c) => c.entryId === snap2)?.protected).toBe(true);
	});
});
