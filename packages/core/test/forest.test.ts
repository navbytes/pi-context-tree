import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanForest, summarizeSession } from "../src/forest.ts";
import { SessionBuilder } from "../src/testkit.ts";

function makeForest(): string {
	const root = mkdtempSync(join(tmpdir(), "ctree-forest-"));

	// project A: one session with a dangling fork
	const a = join(root, "--Users-u-tabwrangler--");
	mkdirSync(a);
	const b1 = new SessionBuilder("/Users/u/tabwrangler");
	b1.user("kickoff");
	const anchor = b1.assistant("plan");
	b1.fork("perf-spike"); // open, then abandoned:
	b1.user("rabbit hole");
	b1.at(anchor);
	const fix = b1.fork("fix-flaky-test");
	b1.user("work");
	b1.close(fix, "squashed");
	writeFileSync(join(a, "2026-06-12_aaa.jsonl"), b1.build().text);

	// project B: clean session with a name
	const bdir = join(root, "--Users-u-blog--");
	mkdirSync(bdir);
	const b2 = new SessionBuilder("/Users/u/blog");
	b2.user("write a post");
	b2.assistant("done");
	b2.custom("other-ext/state", { x: 1 });
	const lines = b2.build().text;
	writeFileSync(join(bdir, "2026-06-11_bbb.jsonl"), lines);

	// project B: a truncated file (crash mid-write)
	writeFileSync(join(bdir, "2026-06-10_ccc.jsonl"), lines.trimEnd().slice(0, -20));

	return root;
}

describe("summarizeSession", () => {
	it("summarizes entries, forks, dangling and leaf context tokens", async () => {
		const root = makeForest();
		const file = join(root, "--Users-u-tabwrangler--", "2026-06-12_aaa.jsonl");
		const s = await summarizeSession(file);

		expect(s.entryCount).toBe(7);
		expect(s.forks.map((f) => f.name).sort()).toEqual(["fix-flaky-test", "perf-spike"]);
		expect(s.dangling).toEqual(["perf-spike"]);
		expect(s.leafTokens).toBeGreaterThan(0);
		expect(s.header?.cwd).toBe("/Users/u/tabwrangler");
	});

	it("tolerates truncated files, reporting warnings instead of throwing", async () => {
		const root = makeForest();
		const file = join(root, "--Users-u-blog--", "2026-06-10_ccc.jsonl");
		const s = await summarizeSession(file);
		expect(s.warnings.length).toBeGreaterThan(0);
		expect(s.entryCount).toBeGreaterThan(0);
	});
});

describe("scanForest", () => {
	it("groups sessions by project dir with dangling counts", async () => {
		const root = makeForest();
		const forest = await scanForest(root);

		expect(forest.projects).toHaveLength(2);
		const byDir = new Map(forest.projects.map((p) => [p.dir, p]));
		const tab = byDir.get("--Users-u-tabwrangler--");
		expect(tab?.sessions).toHaveLength(1);
		expect(tab?.sessions[0]?.dangling).toEqual(["perf-spike"]);
		const blog = byDir.get("--Users-u-blog--");
		expect(blog?.sessions).toHaveLength(2);
	});

	it("supports headers-only mode for cheap listings", async () => {
		const root = makeForest();
		const forest = await scanForest(root, { headersOnly: true });
		const all = forest.projects.flatMap((p) => p.sessions);
		expect(all.every((s) => s.entryCount === -1)).toBe(true);
		expect(all.some((s) => s.header?.cwd === "/Users/u/blog")).toBe(true);
	});
});
