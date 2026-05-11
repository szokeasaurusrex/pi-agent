import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { lstat, mkdir, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface SafeDeleteInput {
	path: string;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function stripLeadingAt(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function deletionTimestamp(): string {
	return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.hrtime.bigint()}`;
}

export default function safeDeleteExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "safe_delete",
		label: "safe_delete",
		description: "Delete an existing file or directory by moving it to $TMPDIR/trash so it can be recovered during the current session.",
		promptSnippet: "Delete a file or directory recoverably by moving it to $TMPDIR/trash",
		promptGuidelines: [
			"Use safe_delete when deleting files or directories so they can be recovered from $TMPDIR/trash during the current session.",
		],
		parameters: Type.Object(
			{
				path: Type.String({ description: "File or directory path to move to $TMPDIR/trash" }),
			},
			{ additionalProperties: false },
		),
		renderCall(args, theme) {
			const path = typeof args.path === "string" ? args.path : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("safe_delete "))}${theme.fg("muted", path)}`, 0, 0);
		},
		async execute(_toolCallId, { path }: SafeDeleteInput, _signal, _onUpdate, ctx) {
			const tmpdir = process.env.TMPDIR;
			if (!tmpdir) throw new Error("safe_delete: TMPDIR is not set");

			const target = resolve(ctx.cwd, stripLeadingAt(path));

			return withFileMutationQueue(target, async () => {
				try {
					await lstat(target);
				} catch (error) {
					if (isErrnoException(error) && error.code === "ENOENT") {
						throw new Error(`safe_delete: target path does not exist: ${path}`);
					}
					throw error;
				}

				const trashDir = join(tmpdir, "trash");
				await mkdir(trashDir, { recursive: true });

				const dest = join(trashDir, `${basename(target)}-${deletionTimestamp()}.bak`);

				try {
					await lstat(dest);
					throw new Error(`safe_delete: backup path already exists: ${dest}`);
				} catch (error) {
					if (!(isErrnoException(error) && error.code === "ENOENT")) {
						throw error;
					}
				}

				await rename(target, dest);

				return {
					content: [{ type: "text" as const, text: `Deleted ${path}: recover from ${dest}` }],
					details: { backupPath: dest },
				};
			});
		},
	});
}
