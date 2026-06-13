/**
 * Loads the REAL pinned pi against the repo ROOT (`pi -e <repo-root>`), the way
 * a `git:`/`-e` install does — through the root package.json `pi.extensions`
 * manifest → extensions/pi-context-tree.ts → `@pi-context-tree/extension`.
 * The goldens load packages/extension/src directly and so wouldn't catch a
 * broken root entry point; this does. Self-skips when pi is absent.
 */

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockOpenAI } from "./mock-openai.ts";
import { EXTENSION_ENTRY, PiRpc, piPath, writeMockModels } from "./rpc-driver.ts";

const PI = piPath();
// EXTENSION_ENTRY = …/packages/extension/src/index.ts → up three to the repo root.
const REPO_ROOT = join(dirname(EXTENSION_ENTRY), "..", "..", "..");

describe.skipIf(!PI)("root pi-package entry loads in real pi", () => {
	it(
		"pi -e <repo-root> resolves @pi-context-tree/extension and registers the commands",
		{ timeout: 120_000 },
		async () => {
			const mock = new MockOpenAI();
			const baseUrl = await mock.start();
			const root = realpathSync(mkdtempSync(join(tmpdir(), "ctree-rootentry-")));
			const cwd = join(root, "project");
			const agentDir = join(root, "agent");
			writeMockModels(agentDir, baseUrl, ["trunk-1"]);
			mkdirSync(cwd, { recursive: true });

			const pi = await PiRpc.start({
				pi: PI as string,
				cwd,
				agentDir,
				sessionDir: join(root, "sessions"),
				model: "trunk-1",
				extension: REPO_ROOT,
				ui: {},
			});
			try {
				// if the root entry failed to load the extension, /branch wouldn't be registered
				await pi.turn("hello");
				await pi.command("/branch smoke-test", /^⎇ branched: smoke-test/);
			} finally {
				await pi.stop();
				await mock.close();
			}
			expect(true).toBe(true); // reaching here = the root entry chain loaded and the command ran
		},
	);
});
