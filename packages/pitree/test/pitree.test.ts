import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanForest } from "@pi-context-tree/core";
import { SessionBuilder } from "@pi-context-tree/core/testkit";
import { describe, expect, it } from "vitest";
import { forestToLines } from "../src/print.ts";
import { loadPanelInputFromFile } from "../src/ui.ts";

function makeForestDir(): { root: string; files: string[] } {
	const root = mkdtempSync(join(tmpdir(), "pitree-"));
	const proj = join(root, "--Users-u-tabwrangler--");
	mkdirSync(proj);

	const b = new SessionBuilder("/Users/u/tabwrangler");
	b.user("kickoff");
	const anchor = b.assistant("plan");
	b.fork("perf-spike");
	b.user("abandoned work");
	b.at(anchor);
	const fix = b.fork("fix-flaky-test");
	b.user("work");
	b.close(fix, "squashed");
	const f1 = join(proj, "2026-06-12_aaa.jsonl");
	writeFileSync(f1, b.build().text);

	const clean = new SessionBuilder("/Users/u/blog");
	clean.user("hello");
	clean.assistant("done");
	const proj2 = join(root, "--Users-u-blog--");
	mkdirSync(proj2);
	const f2 = join(proj2, "2026-06-11_bbb.jsonl");
	writeFileSync(f2, clean.build().text);

	return { root, files: [f1, f2] };
}

describe("forestToLines", () => {
	it("prints projects, sessions, fork statuses and dangling flags", async () => {
		const { root } = makeForestDir();
		const lines = forestToLines(await scanForest(root)).join("\n");
		expect(lines).toContain("/Users/u/tabwrangler");
		expect(lines).toContain("⚠ dangling: perf-spike");
		expect(lines).toContain("⎇ fix-flaky-test");
		expect(lines).toContain("⚠ 1 dangling");
		expect(lines).toContain("/Users/u/blog");
	});

	it("--dangling filters to sessions with dangling branches only", async () => {
		const { root } = makeForestDir();
		const lines = forestToLines(await scanForest(root), { danglingOnly: true }).join("\n");
		expect(lines).toContain("perf-spike");
		expect(lines).not.toContain("/Users/u/blog");
	});
});

describe("read-only guarantees", () => {
	it("scanning and loading never write — mtimes and sizes unchanged (M8 zero-write)", async () => {
		const { root, files } = makeForestDir();
		const before = files.map((f) => {
			const s = statSync(f);
			return { f, mtime: s.mtimeMs, size: s.size };
		});

		const forest = await scanForest(root);
		forestToLines(forest, { danglingOnly: false });
		for (const f of files) await loadPanelInputFromFile(f);

		for (const b of before) {
			const s = await stat(b.f);
			expect(s.mtimeMs).toBe(b.mtime);
			expect(s.size).toBe(b.size);
		}
		// no stray files created
		const dirs = await readdir(root);
		expect(dirs.sort()).toEqual(["--Users-u-blog--", "--Users-u-tabwrangler--"]);
	});

	it("loadPanelInputFromFile marks the panel read-only", async () => {
		const { files } = makeForestDir();
		const input = await loadPanelInputFromFile(files[0]!);
		expect(input.readOnly).toBe(true);
		expect(input.entries.length).toBeGreaterThan(0);
		expect(input.project).toBe("tabwrangler");
	});
});
