/**
 * Deterministic fixture generator — `npm run fixtures` (plain node ≥22.19,
 * type stripping). Emits the committed JSONL fixtures used by core tests and,
 * later, the RPC golden-file tests. Never randomized: same output every run.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionBuilder, filler } from "../packages/core/src/testkit.ts";

const OUT = import.meta.dirname;

function emit(name: string, text: string): void {
	writeFileSync(join(OUT, name), text);
	console.log(`wrote fixtures/${name} (${text.length} bytes)`);
}

// -- linear.jsonl: clean linear chat ----------------------------------------
{
	const b = new SessionBuilder("/home/u/linear-project");
	b.user("explain the build pipeline");
	b.toolUse("read_file", { path: "Makefile" }, filler(1200));
	b.assistant("the pipeline has three stages: lint, test, package");
	b.user("add a docs stage");
	b.assistant("added — see Makefile target docs");
	emit("linear.jsonl", b.build().text);
}

// -- branched.jsonl: scenario A shape (squashed history + active branch) ----
{
	const b = new SessionBuilder("/home/u/tabwrangler");
	b.user("build the tab-suspender importer");
	const plan = b.assistant("plan: storage layer first, then importer");
	const storage = b.fork("storage-layer", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
	b.user("evaluate storage options"); // noisy branch work…
	b.toolUse("read_file", { path: "src/storage.ts" }, filler(2400));
	b.at(storage); // …merge returns to the label
	const dec = b.decision(
		storage,
		"storage-layer",
		"## Decision: storage-layer\n**Outcome:** chrome.storage.session with write-through cache.\n**Assumptions:** MV3 service-worker restarts are the common failure mode\n",
	);
	b.close(storage, "squashed", { decisionEntryId: dec });
	b.toolUse("chrome.snapshot", { url: "tab-audit" }, filler(19_000));
	b.assistant("41 suspendable tabs across 6 windows");
	const fix = b.fork("fix-flaky-test", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
	b.modelChange("anthropic", "haiku-4.5");
	b.user("tests flake on CI — suspect tmpdir");
	b.toolUse("run_tests", {}, filler(6000));
	b.assistant("root cause: shared tmpdir collision between vitest workers");
	emit("branched.jsonl", b.build().text);
}

// -- tournament.jsonl: scenario B shape (three open siblings) ---------------
{
	const b = new SessionBuilder("/home/u/tabwrangler");
	b.user("we need a storage layer");
	const anchor = b.assistant("three candidate designs — trying each on a branch");
	b.fork("storage-a");
	b.user("try chrome.storage.sync");
	b.assistant("sync quota is only 100KB — tight");
	b.at(anchor);
	b.fork("storage-b");
	b.user("try in-memory plus events");
	b.assistant("breaks on MV3 event-page suspension");
	b.at(anchor);
	b.fork("storage-c");
	b.user("try chrome.storage.session");
	b.assistant("survives service-worker restarts; this is the one");
	emit("tournament.jsonl", b.build().text);
}

// -- truncated.jsonl: crash mid-write ---------------------------------------
{
	const b = new SessionBuilder("/home/u/flaky-disk");
	b.user("start something");
	b.assistant("working on it");
	b.user("this entry will be cut off mid-line");
	emit("truncated.jsonl", b.build().text.trimEnd().slice(0, -30));
}

// -- legacy-v1.jsonl: linear pre-tree format (no id/parentId) ----------------
{
	const header = JSON.stringify({
		type: "session",
		version: 1,
		id: "legacy-session-uuid",
		timestamp: "2024-01-01T00:00:00.000Z",
		cwd: "/home/u/old-project",
	});
	const lines = [
		header,
		JSON.stringify({ type: "message", message: { role: "user", content: "old style question" } }),
		JSON.stringify({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "old style answer" }] },
		}),
		JSON.stringify({ type: "message", message: { role: "user", content: "follow-up" } }),
	];
	emit("legacy-v1.jsonl", `${lines.join("\n")}\n`);
}
