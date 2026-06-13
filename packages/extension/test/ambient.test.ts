import { describe, expect, it } from "vitest";
import { refreshAmbient } from "../src/ambient.ts";
import { makeFake } from "./fake-pi.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const STRIP = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("refreshAmbient", () => {
	it("shows branch and banded percentage from pi usage", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("hello");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.statuses.get("ctree")).toBe("⎇ trunk · ctx 15.0% filling");
	});

	it("falls back to the chars/4 estimate when pi reports zero usage on a non-empty session", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("x".repeat(40_000)); // ~10k tokens ≈ 5% of 200k
		w.ctx.getContextUsage = () => ({ tokens: 0, contextWindow: 200_000, percent: 0 });
		refreshAmbient(w.pi, w.ctx);
		const status = w.ui.statuses.get("ctree") ?? "";
		expect(status).toContain("~"); // marked as estimated
		expect(status).not.toContain("0.0%");
		expect(status).toMatch(/ctx ~5\.\d% (healthy|low)/);
	});

	it("pins a context-health gauge bar above the prompt (G1)", () => {
		const w = makeFake();
		w.session.user("hi");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);

		const widget = w.ui.widgets.get("ctree-gauge");
		expect(widget?.placement ?? "aboveEditor").toBe("aboveEditor");
		const line = STRIP(widget?.lines?.[0] ?? "");
		expect(line).toContain("CONTEXT"); // the panel gauge, pinned above the prompt
		expect(line).toContain("15.0% filling"); // band-labeled (color verified live; chalk is off in vitest)
	});

	it("falls back to the estimate in the bar when pi reports zero usage", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("x".repeat(40_000));
		w.ctx.getContextUsage = () => ({ tokens: 0, contextWindow: 200_000, percent: 0 });
		refreshAmbient(w.pi, w.ctx);
		const line = STRIP(w.ui.widgets.get("ctree-gauge")?.lines?.[0] ?? "");
		expect(line).toContain("~"); // estimated marker in the gauge label
		expect(line).not.toContain("0.0%");
	});

	it("keeps the estimating state when there is no window to band against", () => {
		const w = makeFake();
		w.session.user("hi");
		w.ctx.getContextUsage = () => undefined;
		const model = w.ctx.model as { contextWindow?: number };
		const saved = model.contextWindow;
		model.contextWindow = undefined;
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.statuses.get("ctree")).toBe("⎇ trunk · ctx —");
		model.contextWindow = saved;
	});
});
