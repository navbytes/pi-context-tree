#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section body for a version (e.g. "0.1.0") to stdout.
 * Used by .github/workflows/release.yml to build the GitHub Release notes.
 * Stops at the next "## " heading or the link-reference block at the bottom.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
	console.error("usage: node scripts/changelog-section.mjs <version>");
	process.exit(1);
}

const changelog = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const lines = readFileSync(changelog, "utf8").split("\n");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const start = lines.findIndex((line) => new RegExp(`^##\\s*\\[${escaped}\\]`).test(line));
if (start === -1) {
	console.error(`no "## [${version}]" section in CHANGELOG.md`);
	process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
	const line = lines[i];
	if (/^##\s/.test(line) || /^\[[^\]]+\]:\s/.test(line)) {
		end = i;
		break;
	}
}

process.stdout.write(
	`${lines
		.slice(start + 1, end)
		.join("\n")
		.trim()}\n`,
);
