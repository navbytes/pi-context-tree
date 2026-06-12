/**
 * Decision-record drafting via the branch's own model (F2.2), using pi-ai's
 * complete() with auth borrowed from pi's model registry — the same pattern
 * pi's own example extensions use (qna.ts, handoff.ts).
 */

import { complete } from "@earendil-works/pi-ai";
import type { CmdCtxLike, DraftFn, ModelLike } from "./adapter.ts";
import { resolveModel } from "./adapter.ts";

export const DRAFT_SYSTEM_PROMPT = [
	"You write terse engineering decision records for a coding-agent session.",
	"Output ONLY the markdown record, no preamble. Target 1,000–2,000 tokens.",
	"Be specific: real file paths, real failure modes, real numbers from the transcript.",
].join("\n");

export const realDraft: DraftFn = async (ctx, modelRef, system, user) => {
	const model: ModelLike | undefined = (modelRef ? resolveModel(ctx, modelRef) : undefined) ?? ctx.model;
	if (!model) throw new Error("no model available for drafting");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `no API key for ${model.provider}/${model.id}` : (auth.error ?? "auth failed"));
	}
	const response = await complete(
		model as any,
		{
			systemPrompt: system,
			messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
		},
		{ apiKey: auth.apiKey, headers: auth.headers },
	);
	const text = (response.content as { type: string; text?: string }[])
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("\n")
		.trim();
	if (!text) throw new Error("model returned an empty draft");
	return text;
};

export function draftUserPrompt(branchName: string, template: string, serialized: string, extra?: string): string {
	return [
		`Squash-merge the branch "${branchName}" into a decision record using EXACTLY this template:`,
		"",
		template,
		extra ? `Additional instructions from the user: ${extra}` : "",
		"",
		"Branch transcript (tool outputs truncated):",
		"---",
		serialized,
		"---",
	]
		.filter(Boolean)
		.join("\n");
}
