/**
 * RPC golden-file integration tests (TRD §7): drive the REAL pinned pi in
 * --mode rpc against a mock OpenAI endpoint, then pin the resulting session
 * JSONL as goldens. Structural invariants (write order, model restore, no
 * BranchSummaryEntry double-write) are asserted explicitly for readable
 * failures; the goldens then freeze everything else.
 *
 * Skipped when pi is not installed (same policy as rpc-smoke.test.ts).
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionBuilder } from "@pi-context-tree/core/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { expectGolden } from "./golden.ts";
import { MockOpenAI } from "./mock-openai.ts";
import { normalizeSession } from "./normalize.ts";
import { PiRpc, type UiHandlers, piPath, writeMockModels } from "./rpc-driver.ts";

const PI = piPath();

const SQUASH_DRAFT = [
	"## Decision: feat-x",
	"**Outcome:** the thing works.",
	"**Why:**",
	"- because the transcript said so",
	"- and the mock model agrees",
].join("\n");

interface Sandbox {
	root: string;
	cwd: string;
	agentDir: string;
	sessionDir: string;
}

function makeSandbox(): Sandbox {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ctree-golden-")));
	return { root, cwd: join(root, "project"), agentDir: join(root, "agent"), sessionDir: join(root, "sessions") };
}

interface Entry {
	type: string;
	id: string;
	customType?: string;
	content?: string;
	modelId?: string;
	data?: Record<string, unknown>;
	details?: Record<string, unknown>;
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

async function withScenario(
	mock: MockOpenAI,
	ui: UiHandlers,
	run: (pi: PiRpc, sandbox: Sandbox) => Promise<void>,
	opts: { model?: string; files?: Record<string, string> } = {},
): Promise<{ raw: string }> {
	const baseUrl = await mock.start();
	const sandbox = makeSandbox();
	writeMockModels(sandbox.agentDir, baseUrl, ["trunk-1", "branch-1"]);
	mkdirSync(sandbox.cwd, { recursive: true });
	for (const [name, content] of Object.entries(opts.files ?? {})) {
		writeFileSync(join(sandbox.cwd, name), content);
	}
	const pi = await PiRpc.start({
		pi: PI as string,
		cwd: sandbox.cwd,
		agentDir: sandbox.agentDir,
		sessionDir: sandbox.sessionDir,
		model: opts.model ?? "trunk-1",
		ui,
	});
	try {
		await run(pi, sandbox);
		const file = await pi.sessionFile();
		return { raw: readFileSync(file, "utf8") };
	} finally {
		await pi.stop();
		await mock.close();
	}
}

describe.skipIf(!PI)("rpc goldens", () => {
	const mocks: MockOpenAI[] = [];
	afterEach(async () => {
		for (const m of mocks.splice(0)) await m.close();
	});

	it("squash: /branch onto branch model → turns → /merge --squash via editor gate", { timeout: 120_000 }, async () => {
		const mock = new MockOpenAI();
		mocks.push(mock);
		mock.turns.push(
			{ text: "trunk says hi", usage: { input: 20, output: 4 } },
			{ text: "branch attempt done", usage: { input: 30, output: 6 } },
		);
		mock.drafts.push({
			match: (system) => system.includes("decision records"),
			respond: () => ({ text: SQUASH_DRAFT, usage: { input: 50, output: 25 } }),
		});

		const { raw } = await withScenario(
			mock,
			{ editor: (req) => `${req.prefill ?? ""}\n\n<!-- reviewed-by-human -->` },
			async (pi) => {
				await pi.turn("hello trunk");
				await pi.command("/branch feat-x mock/branch-1", /^⎇ branched: feat-x/);
				await pi.turn("attempt the thing");
				await pi.command("/merge --squash", /^⎇ squashed feat-x/);
			},
		);

		const entries = entriesOf(raw);

		// F2.2: exactly one human-confirmed decision record, landed immediately
		const decisions = ofType(entries, "custom_message", "ctree/decision");
		expect(decisions).toHaveLength(1);
		const decision = decisions[0] as Entry;
		expect(decision.content).toContain("reviewed-by-human");
		expect(decision.content).toContain("## Decision: feat-x");

		// TRD §5 write order: decision record BEFORE the close marker, which points back at it
		const closes = ofType(entries, "custom", "ctree/close");
		expect(closes).toHaveLength(1);
		const close = closes[0] as Entry;
		expect(close.data?.status).toBe("squashed");
		expect(close.data?.decisionEntryId).toBe(decision.id);
		expect(entries.indexOf(decision)).toBeLessThan(entries.indexOf(close));

		// F2.5: navigateTree(summarize:false) means pi never writes its own summary
		expect(ofType(entries, "branch_summary")).toHaveLength(0);

		// model tiering through the real pi: trunk → branch → restored trunk
		const modelChanges = ofType(entries, "model_change").map((e) => e.modelId);
		expect(modelChanges).toEqual(["trunk-1", "branch-1", "trunk-1"]);

		// agent turns hit the models the tier says; the draft ran on the branch model
		expect(mock.requests.filter((r) => r.hasTools).map((r) => r.model)).toEqual(["trunk-1", "branch-1"]);
		expect(mock.requests.filter((r) => !r.hasTools).map((r) => r.model)).toEqual(["branch-1"]);
		expect(mock.unexpected).toHaveLength(0);

		expectGolden("squash.jsonl", normalizeSession(raw));
	});

	it("discard: /merge --discard writes only a close marker, injects nothing", { timeout: 120_000 }, async () => {
		const mock = new MockOpenAI();
		mocks.push(mock);
		mock.turns.push({ text: "trunk ok", usage: { input: 12, output: 3 } }, { text: "spike went nowhere" });

		const { raw } = await withScenario(mock, {}, async (pi) => {
			await pi.turn("hello trunk");
			await pi.command("/branch spike-y", /^⎇ branched: spike-y/);
			await pi.turn("try the spike");
			await pi.command("/merge --discard dead end", /^⎇ discarded spike-y/);
		});

		const entries = entriesOf(raw);

		// no record of any kind lands — only the close marker
		expect(ofType(entries, "custom_message", "ctree/decision")).toHaveLength(0);
		expect(ofType(entries, "branch_summary")).toHaveLength(0);
		const closes = ofType(entries, "custom", "ctree/close");
		expect(closes).toHaveLength(1);
		const close = closes[0] as Entry;
		expect(close.data?.status).toBe("discarded");
		expect(close.data?.note).toBe("dead end");

		// the close marker hangs off the fork label (history kept, context rolled back)
		const fork = ofType(entries, "custom", "ctree/fork")[0] as Entry;
		expect(close.data?.forkEntryId).toBe(fork.id);
		expect(close.parentId).toBe(fork.id);

		// no LLM involvement beyond the two agent turns
		expect(mock.requests.map((r) => r.hasTools)).toEqual([true, true]);
		expect(mock.unexpected).toHaveLength(0);

		expectGolden("discard.jsonl", normalizeSession(raw));
	});

	it(
		"tournament: ONE combined record, per-sibling close markers with drafted epitaphs",
		{ timeout: 120_000 },
		async () => {
			const mock = new MockOpenAI();
			mocks.push(mock);
			mock.drafts.push(
				{
					match: (system) => system.includes("decision records"),
					respond: () => ({ text: "## Decision: alt-b\n**Outcome:** B wins on simplicity." }),
				},
				{
					match: (system) => system.includes("epitaphs"),
					respond: () => ({ text: "chose stability over cleverness" }),
				},
			);

			const { raw } = await withScenario(
				mock,
				{ editor: (req) => `${req.prefill ?? ""}\n\n<!-- reviewed-by-human -->` },
				async (pi, sandbox) => {
					// Seed the two-open-siblings topology with the deterministic testkit and load it.
					const b = new SessionBuilder(sandbox.cwd);
					b.modelChange("mock", "trunk-1");
					b.user("we need an approach");
					const a0 = b.assistant("two options exist", { provider: "mock", model: "trunk-1" });
					b.fork("alt-a", { trunkModel: "mock/trunk-1", branchModel: "mock/branch-1" });
					b.user("try approach A");
					b.assistant("A is fragile", { provider: "mock", model: "branch-1" });
					b.at(a0);
					b.fork("alt-b", { trunkModel: "mock/trunk-1", branchModel: "mock/branch-1" });
					b.user("try approach B");
					b.assistant("B works", { provider: "mock", model: "branch-1" });
					const fixture = join(sandbox.root, "tournament-seed.jsonl");
					writeFileSync(fixture, b.build().text);

					await pi.request({ type: "switch_session", sessionPath: fixture });
					await pi.command("/merge --tournament", /^⎇ tournament: alt-b won/);
				},
			);

			const entries = entriesOf(raw);
			const forks = ofType(entries, "custom", "ctree/fork");
			expect(forks).toHaveLength(2);
			const [forkA, forkB] = forks as [Entry, Entry];

			// F2.4: ONE combined node — winner record carries the rejected-alternatives section
			const decisions = ofType(entries, "custom_message", "ctree/decision");
			expect(decisions).toHaveLength(1);
			const decision = decisions[0] as Entry;
			expect(decision.content).toContain("## Decision: alt-b");
			expect(decision.content).toContain("### Rejected alternatives");
			expect(decision.content).toContain("**alt-a:** chose stability over cleverness");
			expect(decision.content).toContain("reviewed-by-human");
			expect((decision.details as { siblings: { name: string }[] }).siblings).toEqual([
				{ name: "alt-a", reason: "chose stability over cleverness" },
			]);

			// per-sibling close markers: winner squashed first (after the decision), loser rejected with epitaph
			const closes = ofType(entries, "custom", "ctree/close");
			expect(closes).toHaveLength(2);
			const [closeWin, closeLose] = closes as [Entry, Entry];
			expect(closeWin.data?.forkEntryId).toBe(forkB.id);
			expect(closeWin.data?.status).toBe("squashed");
			expect(closeWin.data?.decisionEntryId).toBe(decision.id);
			expect(closeLose.data?.forkEntryId).toBe(forkA.id);
			expect(closeLose.data?.status).toBe("rejected");
			expect(closeLose.data?.note).toBe("chose stability over cleverness");
			expect(entries.indexOf(decision)).toBeLessThan(entries.indexOf(closeWin));
			expect(ofType(entries, "branch_summary")).toHaveLength(0);

			// both drafts ran on the branch model; no agent turns at all
			expect(mock.requests.map((r) => [r.hasTools, r.model])).toEqual([
				[false, "branch-1"],
				[false, "branch-1"],
			]);
			expect(mock.unexpected).toHaveLength(0);

			expectGolden("tournament.jsonl", normalizeSession(raw));
		},
	);

	it("crop: --auto --apply stubs the old fat tool result, keeps originals", { timeout: 120_000 }, async () => {
		const mock = new MockOpenAI();
		mocks.push(mock);
		const bigLine = "0123456789abcdef".repeat(24); // 384 chars per line
		const files = { "big.txt": Array.from({ length: 20 }, () => bigLine).join("\n"), "small.txt": "tiny\n" };
		mock.turns.push(
			{ toolCall: { name: "read", args: { path: "big.txt" } } },
			{ text: "scanned the big file", usage: { input: 40, output: 8 } },
			{ toolCall: { name: "read", args: { path: "small.txt" } } },
			{ text: "scanned the small file", usage: { input: 44, output: 9 } },
		);

		const { raw } = await withScenario(
			mock,
			{},
			async (pi) => {
				await pi.turn("read the big file");
				await pi.turn("read the small file");
				await pi.command("/crop --auto --min-tokens 500 --older-than 1 --apply", /^✂ cropped 1/);
			},
			{ files },
		);

		const entries = entriesOf(raw);
		const toolResults = entries.filter((e) => (e.message as { role?: string } | undefined)?.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		const bigResult = toolResults[0] as Entry;

		// the reconstruction block stubs exactly the old fat read; the fresh one is latest-per-tool protected
		const tails = ofType(entries, "custom_message", "ctree/crop-tail");
		expect(tails).toHaveLength(1);
		const tail = tails[0] as Entry;
		expect(tail.content).toContain("[cropped: read");
		expect(tail.content).not.toContain(bigLine);

		const markers = ofType(entries, "custom", "ctree/crop");
		expect(markers).toHaveLength(1);
		const stubbed = (markers[0] as Entry).data?.stubbed as { entryId: string; tool: string; sha8: string }[];
		expect(stubbed.map((s) => [s.entryId, s.tool])).toEqual([[bigResult.id, "read"]]);
		expect(stubbed[0]?.sha8).toMatch(/^[0-9a-f]{8}$/);

		// crop-tail before marker; original fat result still in the file, content intact (G4)
		expect(entries.indexOf(tail)).toBeLessThan(entries.indexOf(markers[0] as Entry));
		const bigContent = JSON.stringify(bigResult.message);
		expect(bigContent).toContain(bigLine);

		expect(mock.unexpected).toHaveLength(0);

		expectGolden("crop.jsonl", normalizeSession(raw));
	});
});
