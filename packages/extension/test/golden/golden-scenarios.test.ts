/**
 * RPC golden-file integration tests (TRD §7): drive the REAL pinned pi in
 * --mode rpc against a mock OpenAI endpoint, then pin the resulting session
 * JSONL as goldens. Structural invariants (write order, model restore, no
 * BranchSummaryEntry double-write) are asserted explicitly for readable
 * failures; the goldens then freeze everything else.
 *
 * Skipped when pi is not installed (same policy as rpc-smoke.test.ts).
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	cwd: string;
	agentDir: string;
	sessionDir: string;
}

function makeSandbox(): Sandbox {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ctree-golden-")));
	return { cwd: join(root, "project"), agentDir: join(root, "agent"), sessionDir: join(root, "sessions") };
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
	run: (pi: PiRpc) => Promise<void>,
	opts: { model?: string } = {},
): Promise<{ raw: string }> {
	const baseUrl = await mock.start();
	const sandbox = makeSandbox();
	writeMockModels(sandbox.agentDir, baseUrl, ["trunk-1", "branch-1"]);
	const { mkdirSync } = await import("node:fs");
	mkdirSync(sandbox.cwd, { recursive: true });
	const pi = await PiRpc.start({
		pi: PI as string,
		cwd: sandbox.cwd,
		agentDir: sandbox.agentDir,
		sessionDir: sandbox.sessionDir,
		model: opts.model ?? "trunk-1",
		ui,
	});
	try {
		await run(pi);
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
});
