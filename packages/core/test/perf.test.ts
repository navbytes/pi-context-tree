import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateContextTokens } from "../src/estimate.ts";
import { parseSessionFile } from "../src/jsonl.ts";
import { SessionBuilder, filler } from "../src/testkit.ts";
import { SessionTree, contextSlice } from "../src/tree.ts";

describe("50MB session", () => {
	it("stream-parses and models a ~50MB file in reasonable time", { timeout: 60_000 }, async () => {
		const b = new SessionBuilder("/big/project");
		// ~8.4k chars per turn triple × 6200 ≈ 52MB
		for (let i = 0; i < 6200; i++) {
			b.user(`question ${i}`);
			b.toolUse("read_file", { path: `src/file${i}.ts` }, filler(8000));
			b.assistant(`answer ${i} with some explanatory text`);
		}
		const { text } = b.build();
		const dir = mkdtempSync(join(tmpdir(), "ctree-big-"));
		const file = join(dir, "big.jsonl");
		writeFileSync(file, text);
		expect(statSync(file).size).toBeGreaterThan(50 * 1024 * 1024);

		const t0 = performance.now();
		const parsed = await parseSessionFile(file);
		const tree = SessionTree.fromEntries(parsed.entries);
		const leaf = tree.fileLeafId();
		const slice = contextSlice(tree, leaf ?? "");
		const tokens = estimateContextTokens(slice);
		const elapsed = performance.now() - t0;

		expect(parsed.warnings).toEqual([]);
		expect(parsed.entries.length).toBe(6200 * 4); // user + assistant(call) + result + assistant
		expect(tokens).toBeGreaterThan(6200 * 2000);
		expect(elapsed).toBeLessThan(15_000);
	});
});
