import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import piContextTree from "../src/index.ts";
import { makeFake } from "./fake-pi.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is the point
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

describe("extension entry point", () => {
	it("registers all five commands and the ◆ decision card renderer", () => {
		const w = makeFake();
		const renderers = new Map<
			string,
			(
				m: { customType: string; content: string; details?: unknown; timestamp?: number },
				o: { expanded: boolean },
				t: unknown,
			) => { render(width: number): string[] } | undefined
		>();
		(w.pi as { registerMessageRenderer?: unknown }).registerMessageRenderer = (
			customType: string,
			renderer: never,
		) => {
			renderers.set(customType, renderer);
		};

		piContextTree(w.pi as unknown as ExtensionAPI);

		for (const name of ["branch", "merge", "crop", "panel", "decisions"]) {
			expect(w.commands.has(name), `missing /${name}`).toBe(true);
		}
		const renderer = renderers.get("ctree/decision");
		expect(renderer).toBeDefined();
		const component = renderer?.(
			{
				customType: "ctree/decision",
				content: "## Decision: feat-x\n**Outcome:** works.",
				details: { v: 1, forkEntryId: "e1", branchName: "feat-x", siblings: [{ name: "alt", reason: "slower" }] },
				timestamp: Date.parse("2026-06-12T10:00:00Z"),
			},
			{ expanded: false },
			undefined,
		);
		const lines = (component?.render(90) ?? []).map(strip);
		expect(lines[0]).toContain("◆ feat-x");
		expect(lines.join("\n")).toContain("2026-06-12");
		expect(lines.join("\n")).toContain("✗ alt — slower");
	});
});
