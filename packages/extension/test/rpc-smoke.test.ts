/**
 * Integration smoke against the REAL pi (0.79.1): boot `pi --mode rpc` with
 * our extension loaded from source (jiti), ask for the command list, and
 * assert /branch /merge /crop /panel /decisions registered. Skipped when pi
 * is not installed. No API key needed — we never prompt the model.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function piPath(): string | null {
	try {
		return execFileSync("which", ["pi"], { encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
}

const PI = piPath();
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");

describe.skipIf(!PI)("pi --mode rpc loads the extension", () => {
	it("registers all five commands", { timeout: 30_000 }, async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctree-rpc-"));
		const child = spawn(PI as string, ["--mode", "rpc", "-e", EXTENSION], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += String(d);
		});
		child.stderr.on("data", (d) => {
			stderr += String(d);
		});

		const commands = await new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				child.kill();
				reject(new Error(`timeout. stderr: ${stderr.slice(0, 2000)}\nstdout: ${stdout.slice(0, 2000)}`));
			}, 25_000);

			const tryParse = (): void => {
				for (const line of stdout.split("\n")) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.type === "response" && msg.command === "get_commands") {
							clearTimeout(timer);
							const list = msg.data?.commands ?? msg.data ?? [];
							const names = (list as { name?: string }[]).map((c) => c.name).filter(Boolean);
							resolve(names as string[]);
							return;
						}
					} catch {
						// partial line — keep buffering
					}
				}
			};
			child.stdout.on("data", tryParse);

			// give pi a moment to boot, then ask
			setTimeout(() => {
				child.stdin.write(`${JSON.stringify({ type: "get_commands" })}\n`);
			}, 1500);
		}).finally(() => {
			child.kill();
		});

		for (const name of ["branch", "merge", "crop", "panel", "decisions"]) {
			expect(commands, `missing /${name} — stderr: ${stderr.slice(0, 500)}`).toContain(name);
		}
	});
});
