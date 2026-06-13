import { describe, expect, it } from "vitest";
import { refreshAmbient } from "../src/ambient.ts";
import { makeFake } from "./fake-pi.ts";

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
