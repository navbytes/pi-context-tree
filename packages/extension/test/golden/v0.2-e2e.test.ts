/**
 * v0.2 friction-killers — end-to-end against the REAL pinned pi (--mode rpc).
 * Covers the new commands the existing goldens don't: bare /merge = squash,
 * /undo (verifying it actually re-opens the branch by checking a post-undo turn
 * parents under the pre-merge leaf), /crop --top, and /decisions --export.
 *
 * Skipped when pi is not installed (same policy as the goldens).
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockOpenAI } from "./mock-openai.ts";
import { PiRpc, type UiHandlers, piPath, writeMockModels } from "./rpc-driver.ts";

const PI = piPath();

const DRAFT = ["## Decision: feat-x", "**Outcome:** the thing works.", "**Why:**", "- the transcript said so"].join(
	"\n",
);

interface Entry {
	type: string;
	id: string;
	parentId?: string;
	customType?: string;
	message?: unknown;
	data?: Record<string, unknown>;
	[k: string]: unknown;
}

function entriesOf(raw: string): Entry[] {
	return raw
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as Entry)
		.filter((e) => e.type !== "session");
}

function ofType(entries: Entry[], type: string, customType?: string): Entry[] {
	return entries.filter((e) => e.type === type && (customType === undefined || e.customType === customType));
}

function roleOf(e: Entry): string | undefined {
	return (e.message as { role?: string } | undefined)?.role;
}

async function runScenario(
	mock: MockOpenAI,
	ui: UiHandlers,
	run: (pi: PiRpc) => Promise<void>,
	files: Record<string, string> = {},
): Promise<Entry[]> {
	const baseUrl = await mock.start();
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ctree-e2e-")));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	writeMockModels(agentDir, baseUrl, ["trunk-1", "branch-1"]);
	mkdirSync(cwd, { recursive: true });
	for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
	const pi = await PiRpc.start({
		pi: PI as string,
		cwd,
		agentDir,
		sessionDir: join(root, "sessions"),
		model: "trunk-1",
		ui,
	});
	try {
		await run(pi);
		return entriesOf(readFileSync(await pi.sessionFile(), "utf8"));
	} finally {
		await pi.stop();
		await mock.close();
	}
}

describe.skipIf(!PI)("v0.2 friction-killers e2e (real pi)", () => {
	it(
		"bare /merge squashes · /undo re-opens the branch · /decisions --export writes markdown",
		{ timeout: 120_000 },
		async () => {
			const mock = new MockOpenAI();
			mock.turns.push(
				{ text: "trunk hi", usage: { input: 20, output: 4 } },
				{ text: "branch attempt done", usage: { input: 30, output: 6 } },
				{ text: "back on the re-opened branch", usage: { input: 22, output: 5 } },
			);
			mock.drafts.push({
				match: (system) => system.includes("decision records"),
				respond: () => ({ text: DRAFT, usage: { input: 50, output: 25 } }),
			});
			const exportPath = join(tmpdir(), `ctree-e2e-decisions-${process.pid}.md`);

			const entries = await runScenario(
				mock,
				{ editor: (req) => `${req.prefill ?? ""}\n<!-- ok -->`, confirm: () => true },
				async (pi) => {
					await pi.turn("hello trunk");
					await pi.command("/branch feat-x", /^⎇ branched: feat-x/);
					await pi.turn("attempt the thing");
					// bare /merge — NO flag — must default to squash (the v0.2 change)
					await pi.command("/merge", /^⎇ squashed feat-x/);
					// /decisions --export on the trunk, where the squashed record lives on-path
					await pi.command(`/decisions --export ${exportPath}`, /^wrote 1 decision record/);
					// /undo re-opens the branch — append-only, navigates back to the pre-merge leaf
					await pi.command("/undo", /^↩ undone/);
					await pi.turn("keep working");
				},
			);

			// bare /merge produced a squash without a selector: one decision + a squashed close carrying prevLeafId
			expect(ofType(entries, "custom_message", "ctree/decision")).toHaveLength(1);
			const close = ofType(entries, "custom", "ctree/close")[0] as Entry;
			expect(close.data?.status).toBe("squashed");
			const prevLeafId = close.data?.prevLeafId as string;
			expect(prevLeafId).toBeTruthy();

			// /undo actually moved the leaf back: the post-undo turn parents under the pre-merge tip
			const reopened = entries.find((e) => roleOf(e) === "user" && JSON.stringify(e.message).includes("keep working"));
			expect(reopened?.parentId).toBe(prevLeafId);

			// nothing was deleted (append-only): the decision + close markers are still present
			expect(ofType(entries, "custom", "ctree/close")).toHaveLength(1);

			// /decisions --export wrote portable markdown
			const md = readFileSync(exportPath, "utf8");
			expect(md).toContain("# Decision records");
			expect(md).toContain("## Decision: feat-x");
		},
	);

	it("/crop --top stubs the biggest unprotected result after a confirm", { timeout: 120_000 }, async () => {
		const mock = new MockOpenAI();
		const bigLine = "0123456789abcdef".repeat(24);
		const files = {
			"big.txt": Array.from({ length: 20 }, () => bigLine).join("\n"),
			"big2.txt": Array.from({ length: 4 }, () => bigLine).join("\n"),
		};
		mock.turns.push(
			{ toolCall: { name: "read", args: { path: "big.txt" } } },
			{ text: "scanned big", usage: { input: 40, output: 8 } },
			{ toolCall: { name: "read", args: { path: "big2.txt" } } },
			{ text: "scanned big2", usage: { input: 42, output: 8 } },
		);

		const entries = await runScenario(
			mock,
			{ confirm: () => true },
			async (pi) => {
				await pi.turn("read the big file");
				await pi.turn("read the second file");
				await pi.command("/crop --top", /^✂ cropped 1/);
			},
			files,
		);

		const markers = ofType(entries, "custom", "ctree/crop");
		expect(markers).toHaveLength(1);
		const stubbed = (markers[0] as Entry).data?.stubbed as { entryId: string; tool: string }[];
		expect(stubbed).toHaveLength(1);
		expect(stubbed[0]?.tool).toBe("read");
		// it cropped the OLDER read (big.txt); the latest read (big2) is latest-per-tool protected
		const toolResults = entries.filter((e) => roleOf(e) === "toolResult");
		expect(stubbed[0]?.entryId).toBe((toolResults[0] as Entry).id);
	});
});
