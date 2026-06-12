import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractForks, nearestOpenFork, siblingForks } from "../src/ctree.ts";
import { parseSessionFile } from "../src/jsonl.ts";
import { SessionTree } from "../src/tree.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");

async function load(name: string) {
	const path = join(FIXTURES, name);
	expect(existsSync(path), `${name} missing — run \`npm run fixtures\``).toBe(true);
	const parsed = await parseSessionFile(path);
	return { parsed, tree: SessionTree.fromEntries(parsed.entries) };
}

describe("committed fixtures", () => {
	it("linear.jsonl: clean linear chat", async () => {
		const { parsed, tree } = await load("linear.jsonl");
		expect(parsed.warnings).toEqual([]);
		expect(tree.leaves()).toHaveLength(1);
		expect(extractForks(tree, tree.fileLeafId() ?? "")).toHaveLength(0);
	});

	it("branched.jsonl: open branch with decision history (scenario A shape)", async () => {
		const { parsed, tree } = await load("branched.jsonl");
		expect(parsed.warnings).toEqual([]);
		const leaf = tree.fileLeafId() ?? "";
		const forks = extractForks(tree, leaf);
		expect(forks.some((f) => f.presentation === "active")).toBe(true);
		expect(forks.some((f) => f.presentation === "squashed")).toBe(true);
		expect(nearestOpenFork(tree, leaf, forks)).toBeDefined();
	});

	it("tournament.jsonl: three open siblings off one anchor (scenario B shape)", async () => {
		const { tree } = await load("tournament.jsonl");
		const leaf = tree.fileLeafId() ?? "";
		const forks = extractForks(tree, leaf);
		const current = nearestOpenFork(tree, leaf, forks);
		expect(current).toBeDefined();
		expect(siblingForks(forks, current?.entryId ?? "")).toHaveLength(2);
	});

	it("truncated.jsonl: parses with a warning, no throw", async () => {
		const { parsed } = await load("truncated.jsonl");
		expect(parsed.warnings.length).toBeGreaterThan(0);
		expect(parsed.entries.length).toBeGreaterThan(0);
	});

	it("legacy-v1.jsonl: migrates to a linear chain", async () => {
		const { parsed, tree } = await load("legacy-v1.jsonl");
		expect(parsed.header?.version).toBe(1);
		expect(parsed.warnings.some((w) => w.includes("legacy"))).toBe(true);
		expect(tree.leaves()).toHaveLength(1);
	});
});
