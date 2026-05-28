import { renderDiff, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import * as Diff from "diff";
import { statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "typebox";

interface WriteInput {
	path: string;
	content: string;
}

interface WriteDetails {
	overwroteExistingFile?: boolean;
	diff?: string;
	firstChangedLine?: number;
}

const writeSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
		content: Type.String({ description: "Content to write to the file" }),
	},
	{ additionalProperties: false },
);

function stripLeadingAt(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function resolveToCwd(filePath: string, cwd: string): string {
	const normalized = stripLeadingAt(filePath.replace(/\u202f/g, " "));
	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

function generateDiff(oldContent: string, newContent: string, contextLines = 4): { diff: string; firstChangedLine?: number } {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added || part.removed) {
			firstChangedLine ??= newLineNum;
			for (const line of raw) {
				if (part.added) {
					output.push(`+${String(newLineNum).padStart(lineNumWidth, " ")} ${line}`);
					newLineNum++;
				} else {
					output.push(`-${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
			continue;
		}

		const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
		const hasLeadingChange = lastWasChange;
		const hasTrailingChange = nextPartIsChange;

		if (hasLeadingChange && hasTrailingChange) {
			if (raw.length <= contextLines * 2) {
				for (const line of raw) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				const leadingLines = raw.slice(0, contextLines);
				const trailingLines = raw.slice(raw.length - contextLines);
				const skippedLines = raw.length - leadingLines.length - trailingLines.length;
				for (const line of leadingLines) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
				for (const line of trailingLines) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			}
		} else if (hasLeadingChange) {
			const shownLines = raw.slice(0, contextLines);
			const skippedLines = raw.length - shownLines.length;
			for (const line of shownLines) {
				output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
		} else if (hasTrailingChange) {
			const skippedLines = Math.max(0, raw.length - contextLines);
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
			for (const line of raw.slice(skippedLines)) {
				output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
		} else {
			oldLineNum += raw.length;
			newLineNum += raw.length;
		}

		lastWasChange = false;
	}

	return { diff: output.join("\n"), firstChangedLine };
}

function overwriteReminder(path: string, diff: string): string {
	return [
		`Notice: write overwrote an existing non-empty file: ${path}`,
		"",
		"Diff from before to after:",
		"```diff",
		diff,
		"```",
		"",
		"Reminder: prefer edit for existing files unless making extensive changes.",
		"Check the diff to verify the overwrite did not introduce unintentional changes.",
	].join("\n");
}

function getPathArg(args: Partial<WriteInput>): string {
	return typeof args.path === "string" ? args.path : typeof (args as { file_path?: unknown }).file_path === "string" ? (args as { file_path: string }).file_path : "...";
}

function formatWriteCall(args: Partial<WriteInput>, theme: { bold: (text: string) => string; fg: (name: string, text: string) => string }): string {
	return `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", getPathArg(args))}`;
}

function targetIsExistingNonEmptyFile(path: string, cwd: string): boolean {
	try {
		const info = statSync(resolveToCwd(path, cwd));
		return info.isFile() && info.size > 0;
	} catch {
		return false;
	}
}

function formatWritePreview(content: string, theme: { fg: (name: string, text: string) => string }, maxLines = 10): string {
	const lines = content.replace(/\t/g, "   ").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const shown = lines.slice(0, maxLines);
	const remaining = lines.length - shown.length;
	let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) text += theme.fg("muted", `\n... (${remaining} more lines, ${lines.length} total)`);
	return text;
}

function createWriteCallComponent() {
	return Object.assign(new Box(1, 1, (text) => text), {
		diff: undefined as string | undefined,
		previewContent: undefined as string | undefined,
		settled: false,
		settledError: false,
	});
}

function getWriteCallComponent(state: { callComponent?: ReturnType<typeof createWriteCallComponent> }, lastComponent: unknown) {
	if (lastComponent instanceof Box) {
		const component = lastComponent as ReturnType<typeof createWriteCallComponent>;
		state.callComponent = component;
		return component;
	}
	if (state.callComponent) return state.callComponent;
	const component = createWriteCallComponent();
	state.callComponent = component;
	return component;
}

function buildWriteCallComponent(component: ReturnType<typeof createWriteCallComponent>, args: Partial<WriteInput>, theme: any) {
	component.setBgFn(
		component.settledError
			? (text: string) => theme.bg("toolErrorBg", text)
			: component.settled
				? (text: string) => theme.bg("toolSuccessBg", text)
				: (text: string) => theme.bg("toolPendingBg", text),
	);
	component.clear();
	component.addChild(new Text(formatWriteCall(args, theme), 0, 0));
	if (component.diff) {
		component.addChild(new Spacer(1));
		component.addChild(new Text(renderDiff(component.diff), 0, 0));
	} else if (component.previewContent) {
		component.addChild(new Spacer(1));
		component.addChild(new Text(formatWritePreview(component.previewContent, theme), 0, 0));
	}
	return component;
}

export default function writeOverwriteDiff(pi: ExtensionAPI) {
	pi.registerTool({
		name: "write",
		label: "write",
		description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		renderShell: "self",
		async execute(_toolCallId, { path, content }: WriteInput, signal, _onUpdate, ctx) {
			const absolutePath = resolveToCwd(path, ctx.cwd);
			const dir = dirname(absolutePath);

			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();

				let oldContent: string | undefined;
				try {
					const before = await stat(absolutePath);
					throwIfAborted();
					if (before.isFile() && before.size > 0) {
						oldContent = await readFile(absolutePath, "utf-8");
					}
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
				}

				throwIfAborted();
				await mkdir(dir, { recursive: true });
				throwIfAborted();
				await writeFile(absolutePath, content, "utf-8");
				throwIfAborted();

				const contentBlocks = [{ type: "text" as const, text: `Successfully wrote ${content.length} bytes to ${path}` }];
				let details: WriteDetails | undefined;

				if (oldContent !== undefined) {
					const { diff, firstChangedLine } = generateDiff(oldContent, content);
					details = { overwroteExistingFile: true, diff, firstChangedLine };
					contentBlocks.push({ type: "text" as const, text: overwriteReminder(path, diff) });
				}

				return { content: contentBlocks, details };
			});
		},
		renderCall(args, theme, context) {
			const component = getWriteCallComponent(context.state, context.lastComponent);
			const path = getPathArg(args);
			const isOverwrite = path !== "..." && targetIsExistingNonEmptyFile(path, context.cwd);
			component.previewContent = !isOverwrite && typeof args.content === "string" ? args.content : undefined;
			return buildWriteCallComponent(component, args, theme);
		},
		renderResult(result, _options, theme, context) {
			const callComponent = context.state.callComponent as ReturnType<typeof createWriteCallComponent> | undefined;
			const details = result.details as WriteDetails | undefined;
			if (callComponent) {
				const overwroteExistingFile = !context.isError && Boolean(details?.overwroteExistingFile);
				callComponent.settled = true;
				callComponent.settledError = context.isError;
				callComponent.diff = overwroteExistingFile ? details?.diff : undefined;
				callComponent.previewContent = !overwroteExistingFile && typeof context.args.content === "string" ? context.args.content : undefined;
				buildWriteCallComponent(callComponent, context.args, theme);
			}

			const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
			component.clear();
			if (context.isError) {
				const output = result.content
					.filter((c) => c.type === "text")
					.map((c) => c.text || "")
					.join("\n");
				if (output) component.addChild(new Text(theme.fg("error", output), 0, 0));
			}
			return component;
		},
	});
}
