import { describe, expect, it } from "vitest";
import { exportDecisionsMarkdown, renderDecisionRecord } from "../src/record.ts";

describe("renderDecisionRecord", () => {
	it("renders the full §6 template including Assumptions", () => {
		const md = renderDecisionRecord({
			branchName: "fix-flaky-test",
			dateIso: "2026-06-12",
			model: "haiku-4.5",
			branchId: "a3f2c1",
			outcome: "Tmpdir collision between vitest workers; fixed with per-worker suffix.",
			why: ["only reproduced with workers >= 2", "both workers wrote to /tmp/tw-fixtures"],
			assumptions: "CI runners share one tmpdir root per host",
			changes: "test/setup.ts — commit 4e2a91c",
			gotchas: "cleanup hook must run per-worker",
			openQuestions: "none",
			confidence: "high · revisit if flakes reappear at >4 workers",
			rejected: [{ name: "storage-b", reason: "breaks on MV3 event-page suspension" }],
		});

		expect(md).toContain("## Decision: fix-flaky-test");
		expect(md).toContain("**Date:** 2026-06-12 · **Model:** haiku-4.5 · **Branch:** a3f2c1");
		expect(md).toContain("**Outcome:** Tmpdir collision");
		expect(md).toContain("- only reproduced with workers >= 2");
		expect(md).toContain("**Assumptions:** CI runners share one tmpdir root per host");
		expect(md).toContain("**Changes:** test/setup.ts — commit 4e2a91c");
		expect(md).toContain("### Rejected alternatives");
		expect(md).toContain("- **storage-b:** breaks on MV3 event-page suspension");
	});

	it("omits the Rejected section when there are no rejects and defaults Changes to none", () => {
		const md = renderDecisionRecord({
			branchName: "tiny",
			dateIso: "2026-06-12",
			model: "opus-4.8",
			branchId: "b1",
			outcome: "Done.",
			why: [],
		});
		expect(md).not.toContain("Rejected alternatives");
		expect(md).toContain("**Changes:** none");
		expect(md.startsWith("## Decision: tiny\n")).toBe(true);
	});
});

describe("exportDecisionsMarkdown", () => {
	it("joins records under a project title with --- separators", () => {
		const md = exportDecisionsMarkdown(
			["## Decision: a\n**Outcome:** did a.", "## Decision: b\n**Outcome:** did b."],
			"myproject",
		);
		expect(md).toContain("# Decision records — myproject");
		expect(md).toContain("_2 records · exported by pi-context-tree_");
		expect(md).toContain("## Decision: a");
		expect(md).toContain("## Decision: b");
		expect(md).toContain("\n\n---\n\n"); // records separated
	});

	it("handles the empty case without a separator", () => {
		const md = exportDecisionsMarkdown([]);
		expect(md).toContain("# Decision records");
		expect(md).toContain("_0 records");
		expect(md).not.toContain("---");
	});
});
