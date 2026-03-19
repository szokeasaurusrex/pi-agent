/**
 * Context Fork Extension
 *
 * Provides three tools for navigating Pi's session tree programmatically:
 * - ctx_checkpoint: Mark the current session position with a name
 * - ctx_inspect: Show named checkpoints and recent tree entries
 * - ctx_return: Navigate back to a checkpoint with a summary
 *
 * Enables forked exploration, context discard, and structured context management.
 */

import type { ExtensionAPI, ExtensionContext, SessionManager } from "@mariozechner/pi-coding-agent";

interface ExtensionAPIWithRebuildContext extends ExtensionAPI {
	rebuildContext(): void;
}
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

export default function contextForkExtension(pi: ExtensionAPIWithRebuildContext) {
	// State: checkpoint name → entry ID
	let checkpoints = new Map<string, string>();

	/**
	 * Reconstruct checkpoint state from session entries.
	 * Scans custom entries with customType "ctx-fork" and label entries.
	 * Prunes checkpoints whose entry IDs are not on the current branch.
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		checkpoints = new Map<string, string>();

		const branchEntries = ctx.sessionManager.getBranch();
		const branchIds = new Set(branchEntries.map((e) => e.id));

		// Rebuild from ctx-fork custom entries on the current branch
		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "ctx-fork") {
				const data = entry.data as { checkpoints?: Record<string, string> } | undefined;
				if (data?.checkpoints) {
					for (const [name, id] of Object.entries(data.checkpoints)) {
						checkpoints.set(name, id);
					}
				}
			}
		}

		// Also scan labels as a cross-reference (labels survive tree navigation)
		for (const entry of ctx.sessionManager.getEntries()) {
			const label = ctx.sessionManager.getLabel(entry.id);
			if (label && !checkpoints.has(label)) {
				// Only add if the target entry is on the current branch
				if (branchIds.has(entry.id)) {
					checkpoints.set(label, entry.id);
				}
			}
		}

		// Prune checkpoints pointing to entries not on the current branch
		for (const [name, id] of checkpoints) {
			if (!branchIds.has(id)) {
				checkpoints.delete(name);
			}
		}
	};

	/** Persist checkpoint map as a custom entry. */
	const persistCheckpoints = () => {
		pi.appendEntry("ctx-fork", {
			checkpoints: Object.fromEntries(checkpoints),
		});
	};

	// Reconstruct state on session lifecycle events
	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
	});

	// ── ctx_checkpoint ──────────────────────────────────────────────────

	pi.registerTool({
		name: "ctx_checkpoint",
		label: "Checkpoint",
		description:
			"Mark the current session position with a name. Use before uncertain exploration, investigations, or long operations.",
		promptSnippet: "Mark current session position with a named checkpoint for later return.",
		promptGuidelines: [
			"Set a checkpoint before uncertain exploration, investigations, large file reads, or long commands. When the user asks for a 'forked agent' or to 'fork and do X', checkpoint immediately, do the work, then ctx_return with a summary.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Identifier for this checkpoint" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { name } = params as { name: string };

			const leafId = ctx.sessionManager.getLeafId();
			if (!leafId) {
				throw new Error("Cannot create checkpoint: no current leaf (empty session).");
			}

			let warning = "";
			if (checkpoints.has(name)) {
				warning = `Warning: checkpoint "${name}" already existed (entry ${checkpoints.get(name)}), overwriting.\n`;
			}

			checkpoints.set(name, leafId);
			pi.setLabel(leafId, name);
			persistCheckpoints();

			return {
				content: [
					{
						type: "text",
						text: `${warning}Checkpoint "${name}" set at entry ${leafId}.`,
					},
				],
				details: { name, entryId: leafId },
			};
		},
	});

	// ── ctx_inspect ─────────────────────────────────────────────────────

	pi.registerTool({
		name: "ctx_inspect",
		label: "Inspect Context",
		description: "Show named checkpoints and recent tree entries on the current branch.",
		promptSnippet: "Show named checkpoints and recent tree entries.",
		promptGuidelines: [
			"Use to find entry IDs when you need to return to a point that was not explicitly checkpointed.",
		],
		parameters: Type.Object({
			count: Type.Optional(
				Type.Number({
					description: "Number of recent tree entries to show (default: 5)",
					minimum: 1,
					maximum: 50,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const count = (params as { count?: number }).count ?? 5;
			const lines: string[] = [];

			// Named checkpoints
			lines.push("Named checkpoints:");
			if (checkpoints.size === 0) {
				lines.push("  (none)");
			} else {
				for (const [name, entryId] of checkpoints) {
					const entry = ctx.sessionManager.getEntry(entryId);
					const ts = entry?.timestamp ?? "unknown";

					// Check if entry is still valid on branch
					const branch = ctx.sessionManager.getBranch();
					const onBranch = branch.some((e) => e.id === entryId);
					const validity = onBranch ? "" : " [INVALID: not on current branch]";

					lines.push(`  ${name}  →  ${entryId}  (${ts})${validity}`);
				}
			}

			lines.push("");

			// Recent entries on the current branch
			const branch = ctx.sessionManager.getBranch();
			// getBranch returns root→leaf order; we want leaf→root for "recent"
			const recentEntries = branch.slice(-count).reverse();

			lines.push(`Recent entries (last ${Math.min(count, branch.length)}):`);
			for (const entry of recentEntries) {
				let entryType: string;
				let preview = "";

				if (entry.type === "message") {
					const msg = entry.message;
					entryType = msg.role;

					if (msg.role === "user") {
						const text =
							typeof msg.content === "string"
								? msg.content
								: msg.content
										.filter((c): c is { type: "text"; text: string } => c.type === "text")
										.map((c) => c.text)
										.join(" ");
						preview = `"${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
					} else if (msg.role === "assistant") {
						const textParts = msg.content.filter(
							(c): c is { type: "text"; text: string } => c.type === "text",
						);
						const text = textParts.map((c) => c.text).join(" ");
						preview = `"${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
					} else if (msg.role === "toolResult") {
						const toolMsg = msg as { toolName: string; isError: boolean };
						preview = `[${toolMsg.toolName}]${toolMsg.isError ? " ERROR" : ""}`;
					} else if (msg.role === "custom") {
						const customMsg = msg as { customType: string; content: string | unknown[] };
						const text =
							typeof customMsg.content === "string" ? customMsg.content : JSON.stringify(customMsg.content);
						entryType = `custom(${customMsg.customType})`;
						preview = `"${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
					} else if (msg.role === "branchSummary") {
						entryType = "branchSummary";
						const bsMsg = msg as { summary: string };
						preview = `"${bsMsg.summary.slice(0, 80)}${bsMsg.summary.length > 80 ? "..." : ""}"`;
					} else if (msg.role === "compactionSummary") {
						entryType = "compaction";
						const csMsg = msg as { summary: string };
						preview = `"${csMsg.summary.slice(0, 80)}${csMsg.summary.length > 80 ? "..." : ""}"`;
					}
				} else if (entry.type === "compaction") {
					entryType = "compaction";
					const compEntry = entry as { summary: string };
					preview = `"${compEntry.summary.slice(0, 80)}${compEntry.summary.length > 80 ? "..." : ""}"`;
				} else if (entry.type === "branch_summary") {
					entryType = "branchSummary";
					const bsEntry = entry as { summary: string };
					preview = `"${bsEntry.summary.slice(0, 80)}${bsEntry.summary.length > 80 ? "..." : ""}"`;
				} else if (entry.type === "custom") {
					entryType = `custom(${(entry as { customType: string }).customType})`;
				} else {
					entryType = entry.type;
				}

				// Check for checkpoint label
				const label = ctx.sessionManager.getLabel(entry.id);
				const labelTag = label ? `  [checkpoint: ${label}]` : "";

				lines.push(`  ${entry.id}  ${entryType.padEnd(16)}  ${entry.timestamp}  ${preview}${labelTag}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					checkpoints: Object.fromEntries(checkpoints),
					recentCount: recentEntries.length,
				},
			};
		},
	});

	// ── ctx_return ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "ctx_return",
		label: "Return to Checkpoint",
		description:
			"Navigate back to a checkpoint or entry ID, carrying a summary of work done. The summary is the only information that persists after navigation.",
		promptSnippet: "Navigate back to a checkpoint with a summary of work done.",
		promptGuidelines: [
			"Always provide a thorough summary — it is the only information that persists after navigation. Include concrete findings, file paths, and decisions.",
		],
		parameters: Type.Object({
			target: Type.String({ description: "Checkpoint name or entry ID" }),
			summary: Type.String({
				description:
					"Summary of the work done since the target point. This is the only information that survives navigation.",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { target, summary } = params as { target: string; summary: string };

			// Resolve target: checkpoint name first, then direct entry ID
			let targetId = checkpoints.get(target);
			if (!targetId) {
				// Try as direct entry ID
				const entry = ctx.sessionManager.getEntry(target);
				if (entry) {
					targetId = target;
				}
			}

			if (!targetId) {
				throw new Error(
					`Target "${target}" not found. Not a checkpoint name or valid entry ID. Use ctx_inspect to see available checkpoints and entries.`,
				);
			}

			// Validate target entry exists
			const targetEntry = ctx.sessionManager.getEntry(targetId);
			if (!targetEntry) {
				throw new Error(
					`Entry ${targetId} no longer exists in the session (may have been compacted). Use ctx_inspect to find a valid target.`,
				);
			}

			// Auto-checkpoint the current position before navigating away
			const currentLeafId = ctx.sessionManager.getLeafId();
			let returnCheckpointName: string | undefined;
			if (currentLeafId && currentLeafId !== targetId) {
				returnCheckpointName = `before-return-to-${target}`;
				checkpoints.set(returnCheckpointName, currentLeafId);
				pi.setLabel(currentLeafId, returnCheckpointName);
				persistCheckpoints();
			}

			// Branch the session tree to the target entry
			(ctx.sessionManager as SessionManager).branch(targetId);

			// Rebuild the agent's in-memory context from the new branch
			pi.rebuildContext();

			// Abort the current agent turn to prevent any stale-context response
			ctx.abort();

			// Inject the summary and trigger a fresh turn with rebuilt context
			const returnNote = returnCheckpointName
				? `\n\n[Navigated from checkpoint "${returnCheckpointName}".]`
				: "";
			pi.sendMessage(
				{
					customType: "ctx-fork-summary",
					content: summary + returnNote,
					display: true,
				},
				{ triggerTurn: true },
			);

			return {
				content: [
					{
						type: "text",
						text: `Returned to "${target}" (entry ${targetId}). Branch summary injected.`,
					},
				],
				details: { target, targetId, returnCheckpoint: returnCheckpointName, summaryLength: summary.length },
			};
		},
	});

	// ── Custom message renderer for ctx-fork-summary ────────────────────

	pi.registerMessageRenderer("ctx-fork-summary", (message, _options, theme) => {
		const header = theme.fg("accent", theme.bold("Branch Summary (ctx-fork)"));
		const body = theme.fg("muted", typeof message.content === "string" ? message.content : "");
		return new Text(`${header}\n${body}`, 0, 0);
	});
}
