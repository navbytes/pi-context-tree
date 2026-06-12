/**
 * Real-terminal e2e: pi's actual TUI in a pseudo-terminal (expect), extension
 * loaded from source, /panel hosted via ui.custom({overlay:true}) — the
 * experimental-overlay path that RPC mode can't exercise. Walks the mockup
 * keymap time-driven (tree → c crop → esc → u consumers → esc → D decisions →
 * q), captures every PTY byte via log_file, then asserts each screen's
 * section header reached the terminal and pi never crashed.
 *
 * Time-driven beats event-driven here: pi-tui diff-repaints flow through
 * expect's match buffer unpredictably, but the byte capture is complete.
 * Skipped when pi or expect(1) is missing. The mock provider is configured
 * but never called — the fixture session needs no LLM turns.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionBuilder, filler } from "@pi-context-tree/core/testkit";
import { describe, expect, it } from "vitest";
import { EXTENSION_ENTRY, piPath, writeMockModels } from "./rpc-driver.ts";

const PI = piPath();
const EXPECT = ["/usr/bin/expect", "/bin/expect", "/usr/local/bin/expect"].find((p) => existsSync(p));

function fixtureSession(cwd: string): string {
	const b = new SessionBuilder(cwd);
	b.modelChange("mock", "trunk-1");
	b.user("build the importer");
	b.assistant("plan: storage first", { provider: "mock", model: "trunk-1" });
	const storage = b.fork("storage-layer", { trunkModel: "mock/trunk-1", branchModel: "mock/branch-1" });
	b.user("storage work");
	b.at(storage);
	const dec = b.customMessage("ctree/decision", "## Decision: storage-layer\n**Outcome:** session storage won.", true, {
		v: 1,
		forkEntryId: storage,
		branchName: "storage-layer",
		siblings: [{ name: "storage-a", reason: "quota" }],
	});
	b.close(storage, "squashed", { decisionEntryId: dec });
	b.toolUse("chrome.snapshot", { url: "audit" }, filler(50_000));
	b.assistant("41 suspendable tabs", { provider: "mock", model: "trunk-1" });
	b.toolUse("chrome.snapshot", { url: "after" }, filler(600));
	b.fork("fix-flaky-test", { trunkModel: "mock/trunk-1", branchModel: "mock/branch-1" });
	b.user("tests flake on CI");
	b.assistant("root cause found", { provider: "mock", model: "trunk-1" });
	return b.build().text;
}

describe.skipIf(!PI || !EXPECT)("real pi TUI in a PTY (mockup keymap walk)", () => {
	it("opens /panel and reaches tree, crop, consumers and decisions screens", { timeout: 120_000 }, () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "ctree-pty-")));
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const sessionDir = join(root, "sessions");
		const capture = join(root, "capture.raw");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
		writeMockModels(agentDir, "http://127.0.0.1:9/v1", ["trunk-1", "branch-1"]);
		const sessionFile = join(root, "seed.jsonl");
		writeFileSync(sessionFile, fixtureSession(cwd));

		const script = join(root, "walk.exp");
		writeFileSync(
			script,
			[
				"set timeout 30",
				'set stty_init "rows 45 columns 120"',
				`set env(PI_CODING_AGENT_DIR) "${agentDir}"`,
				`log_file -noappend "${capture}"`,
				`cd "${cwd}"`,
				`spawn "${PI}" --session "${sessionFile}" --session-dir "${sessionDir}" --provider mock --model trunk-1 -e "${EXTENSION_ENTRY}"`,
				// pump: read PTY output for N seconds (log_file only records what expect reads)
				'proc pump {secs} { expect -timeout $secs -re "ZZZ_NEVER_MATCHES_ZZZ" {} timeout {} }',
				"pump 6",
				'send "/panel\\r"',
				"pump 4",
				'send "c"',
				"pump 3",
				'send "\\x1b"',
				"pump 2",
				'send "u"',
				"pump 3",
				'send "\\x1b"',
				"pump 2",
				'send "D"',
				"pump 3",
				'send "q"',
				"pump 2",
				'send "\\x03"',
				"pump 1",
				'send "\\x03"',
				"pump 2",
				"exit 0",
			].join("\n"),
		);

		try {
			execFileSync(EXPECT as string, [script], { encoding: "utf8", timeout: 100_000 });
		} catch (err) {
			const e = err as { stdout?: string; message: string };
			throw new Error(`expect walk failed: ${e.message}\n${(e.stdout ?? "").slice(-1500)}`);
		}

		const raw = readFileSync(capture, "utf8");
		const tail = `\n--- capture tail ---\n${raw.slice(-2000)}`;
		expect(raw, `pi crashed during the walk${tail}`).not.toContain("uncaughtException");
		// one assertion per mockup screen, matched on the section headers the panel paints
		expect(raw, `tree view never painted${tail}`).toContain("TRUNK + BRANCHES");
		expect(raw, `tree marker missing${tail}`).toContain("← you are here");
		expect(raw, `crop view never painted${tail}`).toContain("CROP — TOOL/MCP RESULTS");
		expect(raw, `consumers view never painted${tail}`).toContain("TOKENS BY SOURCE");
		expect(raw, `decisions view never painted${tail}`).toContain("DECISION RECORDS ON TRUNK");
		expect(raw, `decision epitaph missing${tail}`).toContain("storage-a — quota");
	});
});
