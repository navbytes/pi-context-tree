#!/usr/bin/env node
/**
 * pitree — forest CLI over ~/.pi/agent/sessions (F6). Read-only by design.
 *
 *   pitree [dir] [--dangling] [--json]
 *   pitree ui [dir]            read-only standalone panel
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scanForest } from "@pi-context-tree/core";
import { forestToLines } from "./print.ts";
import { runUi } from "./ui.ts";

function defaultRoot(): string {
	return join(homedir(), ".pi", "agent", "sessions");
}

export async function main(argv: string[]): Promise<number> {
	const args = [...argv];
	const ui = args[0] === "ui";
	if (ui) args.shift();

	const flags = new Set(args.filter((a) => a.startsWith("--")));
	const positional = args.filter((a) => !a.startsWith("--"));
	const root = positional[0] ?? defaultRoot();

	if (flags.has("--help") || flags.has("-h")) {
		console.log("usage: pitree [dir] [--dangling] [--json] | pitree ui [dir]");
		return 0;
	}
	if (!existsSync(root)) {
		console.error(`pitree: sessions root not found: ${root}`);
		return 1;
	}

	if (ui) {
		await runUi(root);
		return 0;
	}

	const forest = await scanForest(root);
	if (flags.has("--json")) {
		console.log(JSON.stringify(forest, null, 2));
		return 0;
	}
	for (const line of forestToLines(forest, { danglingOnly: flags.has("--dangling"), color: process.stdout.isTTY })) {
		console.log(line);
	}
	return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts");
if (invokedDirectly) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(`pitree: ${(err as Error).message}`);
			process.exit(1);
		},
	);
}
