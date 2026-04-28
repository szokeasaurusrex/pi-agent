import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Box, Markdown, Text } from "@mariozechner/pi-tui";
import { RustAnalyzerClient, normalizeHoverContents } from "./client";
import { DiagnosticsStore } from "./diagnostics";
import { discoverRustProject, detectRustAnalyzer, resolveAbsolutePath, stripLeadingAt } from "./discovery";
import { DocumentTracker, fileUriToPath } from "./documents";
import type {
	CompactLocation,
	CompactSymbolResult,
	LspDocumentSymbol,
	LspHover,
	LspLocation,
	LspLocationLink,
	LspRange,
	LspSymbolInformation,
	LspWorkspaceSymbol,
	ProgressState,
	RustAnalyzerCommand,
	RustAnalyzerPreflightError,
	RustProjectDiscovery,
	SessionState,
} from "./types";

const EXTENSION_KEY = "lsp-rust-analyzer";
const DIAGNOSTIC_MESSAGE_TYPE = "lsp-rust-analyzer-diagnostics";
const DIAGNOSTIC_RETRIGGER_MESSAGE_TYPE = "lsp-rust-analyzer-diagnostics-retrigger";
const DIAGNOSTIC_SETTLE_MS = 450;
const DIAGNOSTIC_DEBOUNCE_MS = 1_000;
const DIAGNOSTIC_WAIT_TIMEOUT_MS = 15_000;
const AUTO_INJECT_MAX_TEXT_LENGTH = 1_500;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;
const RUST_LSP_TOOL_NAMES = ["lsp_find_symbol", "lsp_document_symbols", "lsp_hover", "lsp_definition", "lsp_references", "lsp_diagnostics"];
const RUST_LSP_APPEND_PROMPT = "When searching for Rust symbols, use the appropriate LSP tool. Do not use rg, grep, or any other plain text search tool, unless the LSP tool fails to surface the needed information. Always try LSP-based symbol-resolution first.";

const PathParams = Type.Object({
	path: Type.String({ description: "Rust file path. Leading @ is accepted." }),
});

const SymbolLookupParams = Type.Object({
	name: Type.String({ description: "Rust symbol name." }),
	path: Type.Optional(Type.String({ description: "Optional Rust file or directory path. Leading @ is accepted." })),
	line: Type.Optional(Type.Number({ description: "1-based start line.", minimum: 1 })),
	character: Type.Optional(Type.Number({ description: "1-based start character.", minimum: 1 })),
	endLine: Type.Optional(Type.Number({ description: "1-based end line.", minimum: 1 })),
	endCharacter: Type.Optional(Type.Number({ description: "1-based end character.", minimum: 1 })),
	limit: Type.Optional(Type.Number({ description: "Maximum results.", minimum: 1, maximum: MAX_RESULT_LIMIT })),
});

const ReferencesParams = Type.Object({
	name: Type.String({ description: "Rust symbol name." }),
	path: Type.Optional(Type.String({ description: "Optional Rust file or directory path. Leading @ is accepted." })),
	line: Type.Optional(Type.Number({ description: "1-based start line.", minimum: 1 })),
	character: Type.Optional(Type.Number({ description: "1-based start character.", minimum: 1 })),
	endLine: Type.Optional(Type.Number({ description: "1-based end line.", minimum: 1 })),
	endCharacter: Type.Optional(Type.Number({ description: "1-based end character.", minimum: 1 })),
	includeDeclaration: Type.Optional(Type.Boolean({ description: "Include declaration." })),
	limit: Type.Optional(Type.Number({ description: "Maximum results.", minimum: 1, maximum: MAX_RESULT_LIMIT })),
});

const DiagnosticsParams = Type.Object({
	path: Type.Optional(Type.String({ description: "Optional Rust file path. Leading @ is accepted." })),
	includeHints: Type.Optional(Type.Boolean({ description: "Include hints." })),
	limit: Type.Optional(Type.Number({ description: "Maximum results.", minimum: 1, maximum: MAX_RESULT_LIMIT })),
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function symbolKindName(kind: number): string {
	const names: Record<number, string> = {
		1: "File",
		2: "Module",
		3: "Namespace",
		4: "Package",
		5: "Class",
		6: "Method",
		7: "Property",
		8: "Field",
		9: "Constructor",
		10: "Enum",
		11: "Interface",
		12: "Function",
		13: "Variable",
		14: "Constant",
		15: "String",
		16: "Number",
		17: "Boolean",
		18: "Array",
		19: "Object",
		20: "Key",
		21: "Null",
		22: "EnumMember",
		23: "Struct",
		24: "Event",
		25: "Operator",
		26: "TypeParameter",
	};
	return names[kind] ?? `Kind${kind}`;
}

function clampLimit(limit: number | undefined, fallback = DEFAULT_RESULT_LIMIT): number {
	return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.trunc(limit ?? fallback)));
}

function rangeToCompact(range: LspRange): Pick<CompactLocation, "line" | "character" | "endLine" | "endCharacter"> {
	return {
		line: range.start.line + 1,
		character: range.start.character + 1,
		endLine: range.end.line + 1,
		endCharacter: range.end.character + 1,
	};
}

function locationToCompact(location: LspLocation): CompactLocation {
	const filePath = fileUriToPath(location.uri);
	return {
		path: filePath,
		...rangeToCompact(location.range),
	};
}

function locationLinkToCompact(location: LspLocationLink): CompactLocation {
	const filePath = fileUriToPath(location.targetUri);
	return {
		path: filePath,
		...rangeToCompact(location.targetRange),
		selectionLine: location.targetSelectionRange.start.line + 1,
		selectionCharacter: location.targetSelectionRange.start.character + 1,
		selectionEndLine: location.targetSelectionRange.end.line + 1,
		selectionEndCharacter: location.targetSelectionRange.end.character + 1,
	};
}

function isLocationLink(value: LspLocation | LspLocationLink): value is LspLocationLink {
	return "targetUri" in value && "targetRange" in value && "targetSelectionRange" in value;
}

function normalizeWorkspaceSymbol(symbol: LspSymbolInformation | LspWorkspaceSymbol): CompactSymbolResult {
	const location = "range" in symbol.location
		? symbol.location
		: { uri: symbol.location.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
	const compact = locationToCompact(location);
	return {
		name: symbol.name,
		kind: symbol.kind,
		kindName: symbolKindName(symbol.kind),
		path: compact.path,
		line: compact.line,
		character: compact.character,
		containerName: "containerName" in symbol ? symbol.containerName : undefined,
	};
}

function flattenDocumentSymbols(symbols: LspDocumentSymbol[], depth = 0, output: Array<CompactSymbolResult & { depth: number }> = []): Array<CompactSymbolResult & { depth: number }> {
	for (const symbol of symbols) {
		output.push({
			name: symbol.name,
			kind: symbol.kind,
			kindName: symbolKindName(symbol.kind),
			path: "",
			line: symbol.selectionRange.start.line + 1,
			character: symbol.selectionRange.start.character + 1,
			detail: symbol.detail,
			depth,
		});
		if (symbol.children) flattenDocumentSymbols(symbol.children, depth + 1, output);
	}
	return output;
}

function displayPath(filePath: string, cwd?: string): string {
	if (!cwd) return filePath;
	const relativePath = path.relative(cwd, filePath);
	if (!relativePath || relativePath.startsWith("..")) return filePath;
	return relativePath;
}

function formatLocation(location: CompactLocation, cwd?: string): string {
	const end = location.endLine !== undefined && location.endCharacter !== undefined
		? `-${location.endLine}:${location.endCharacter}`
		: "";
	return `${displayPath(location.path, cwd)}:${location.line}:${location.character}${end}`;
}

function formatCompactSymbol(symbol: CompactSymbolResult, cwd?: string): string {
	const suffixParts = [symbol.containerName, symbol.detail].filter(Boolean);
	const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(" • ")})` : "";
	return `${symbol.kindName} ${symbol.name} ${displayPath(symbol.path, cwd)}:${symbol.line}:${symbol.character}${suffix}`;
}

function formatDefinitionLocation(location: CompactLocation, cwd?: string): string {
	const target = formatLocation(location, cwd);
	if (location.selectionLine === undefined || location.selectionCharacter === undefined) return target;
	const selectionEnd = location.selectionEndLine !== undefined && location.selectionEndCharacter !== undefined
		? `-${location.selectionEndLine}:${location.selectionEndCharacter}`
		: "";
	return `${target} (selection ${location.selectionLine}:${location.selectionCharacter}${selectionEnd})`;
}

function renderToolCallSummary(theme: ExtensionContext["ui"]["theme"], label: string, summary: string): Text {
	return new Text(`${theme.fg("toolTitle", label)} ${theme.fg("toolOutput", summary)}`, 0, 0);
}

async function buildDefinitionPreview(location: CompactLocation): Promise<string | undefined> {
	try {
		const text = await readFile(location.path, "utf8");
		const lines = text.split(/\r?\n/);
		const startLine = Math.max(1, location.selectionLine ?? location.line);
		const endLine = Math.max(startLine, Math.min(lines.length, location.endLine ?? startLine));
		const previewLines = lines.slice(startLine - 1, Math.min(endLine, startLine + 11));
		if (previewLines.length === 0) return undefined;
		return previewLines.join("\n");
	} catch {
		return undefined;
	}
}

interface SymbolLookupInput {
	name: string;
	path?: string;
	line?: number;
	character?: number;
	endLine?: number;
	endCharacter?: number;
	limit?: number;
}

interface ResolvedSymbol {
	symbol: CompactSymbolResult;
	synced: { path: string; uri: string };
}

function formatLookupScope(params: SymbolLookupInput, cwd: string): string {
	const parts = [JSON.stringify(params.name)];
	if (params.path) parts.push(`in ${displayPath(params.path, cwd)}`);
	if (params.line !== undefined) {
		const start = `${params.line}:${params.character ?? 1}`;
		const end = params.endLine !== undefined ? `-${params.endLine}:${params.endCharacter ?? 1}` : "";
		parts.push(`within ${start}${end}`);
	}
	return parts.join(" ");
}

type LookupPathKind = "workspace" | "file" | "directory";

async function classifyLookupPath(inputPath: string, cwd: string): Promise<{ kind: "file" | "directory"; absolutePath: string }> {
	const absolutePath = resolveAbsolutePath(inputPath, cwd);
	try {
		const info = await stat(absolutePath);
		if (info.isFile()) return { kind: "file", absolutePath };
		if (info.isDirectory()) return { kind: "directory", absolutePath };
	} catch {
		throw new Error(`Path not found: ${stripLeadingAt(inputPath.trim())}`);
	}
	throw new Error(`Path not found: ${stripLeadingAt(inputPath.trim())}`);
}

function isWithinDirectory(filePath: string, directoryPath: string): boolean {
	const relativePath = path.relative(directoryPath, filePath);
	return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function hasRangeDisambiguation(params: SymbolLookupInput): boolean {
	return params.line !== undefined || params.character !== undefined || params.endLine !== undefined || params.endCharacter !== undefined;
}

function ambiguityRetryLine(pathKind: LookupPathKind): string {
	switch (pathKind) {
		case "directory":
			return "Retry with a file path, or with a different directory path that narrows the subtree further.";
		case "file":
			return "Retry with a tighter file range.";
		default:
			return "Retry with path when known, or with a file path plus line or line/column range.";
	}
}

function candidateWithinRange(symbol: CompactSymbolResult, params: SymbolLookupInput): boolean {
	if (params.line === undefined) return true;
	const startLine = params.line;
	const startCharacter = params.character ?? 1;
	const endLine = params.endLine ?? startLine;
	const endCharacter = params.endCharacter ?? (params.endLine !== undefined ? Number.MAX_SAFE_INTEGER : startCharacter);
	const afterStart = symbol.line > startLine || (symbol.line === startLine && symbol.character >= startCharacter);
	const beforeEnd = symbol.line < endLine || (symbol.line === endLine && symbol.character <= endCharacter);
	return afterStart && beforeEnd;
}

function filterNamedSymbols(symbols: CompactSymbolResult[], name: string): CompactSymbolResult[] {
	const exact = symbols.filter((item) => item.name === name);
	if (exact.length > 0) return exact;
	const caseInsensitive = symbols.filter((item) => item.name.toLowerCase() === name.toLowerCase());
	if (caseInsensitive.length > 0) return caseInsensitive;
	return [];
}

async function collectSymbolCandidates(
	manager: RustAnalyzerManager,
	ctx: ExtensionContext,
	params: SymbolLookupInput,
	signal?: AbortSignal,
): Promise<CompactSymbolResult[]> {
	await manager.ensureReady(ctx, params.path, signal);
	if (params.path) {
		const scopedPath = await classifyLookupPath(params.path, ctx.cwd);
		if (scopedPath.kind === "file") {
			const synced = await manager.syncPath(ctx, scopedPath.absolutePath);
			const rawSymbols = await manager.getClient().documentSymbols(synced.uri, signal);
			let items: CompactSymbolResult[] = [];
			if (rawSymbols.length > 0 && "selectionRange" in rawSymbols[0]!) {
				items = flattenDocumentSymbols(rawSymbols as LspDocumentSymbol[]).map((item) => ({ ...item, path: synced.path }));
			} else {
				items = (rawSymbols as LspSymbolInformation[]).map(normalizeWorkspaceSymbol);
			}
			return filterNamedSymbols(items, params.name).filter((item) => candidateWithinRange(item, params));
		}
		if (hasRangeDisambiguation(params)) {
			throw new Error("Directory-scoped lookup does not support line or character disambiguation. Use a file path for range-based disambiguation.");
		}
		const workspace = (await manager.getClient().workspaceSymbols(params.name, signal))
			.map(normalizeWorkspaceSymbol)
			.filter((item) => isWithinDirectory(item.path, scopedPath.absolutePath));
		return filterNamedSymbols(workspace, params.name).filter((item) => candidateWithinRange(item, params));
	}
	const workspace = (await manager.getClient().workspaceSymbols(params.name, signal)).map(normalizeWorkspaceSymbol);
	return filterNamedSymbols(workspace, params.name).filter((item) => candidateWithinRange(item, params));
}

async function resolveNamedSymbol(
	manager: RustAnalyzerManager,
	ctx: ExtensionContext,
	params: SymbolLookupInput,
	signal?: AbortSignal,
): Promise<{ resolved?: ResolvedSymbol; candidates: CompactSymbolResult[]; message?: string; pathKind: LookupPathKind }> {
	const pathKind = params.path ? (await classifyLookupPath(params.path, ctx.cwd)).kind : "workspace";
	const candidates = await collectSymbolCandidates(manager, ctx, params, signal);
	if (candidates.length === 0) {
		return { candidates, pathKind, message: `No Rust symbols matched ${formatLookupScope(params, ctx.cwd)}.` };
	}
	if (candidates.length !== 1) {
		return {
			candidates,
			pathKind,
			message: `Ambiguous Rust symbol lookup for ${formatLookupScope(params, ctx.cwd)}. ${ambiguityRetryLine(pathKind)}`,
		};
	}
	const symbol = candidates[0]!;
	const synced = await manager.syncPath(ctx, symbol.path);
	return { candidates, pathKind, resolved: { symbol, synced } };
}

class RustAnalyzerManager {
	private readonly pi: ExtensionAPI;
	private readonly diagnostics = new DiagnosticsStore();
	private project?: RustProjectDiscovery;
	private command?: RustAnalyzerCommand;
	private preflightError?: RustAnalyzerPreflightError;
	private client?: RustAnalyzerClient;
	private documents?: DocumentTracker;
	private lastCtx?: ExtensionContext;
	private state: SessionState = "inactive";
	private stateError?: string;
	private progress?: ProgressState;
	private readonly pendingFileRefreshes = new Map<string, number>();
	private readonly pendingTurnRefreshes = new Set<Promise<void>>();
	private waitingForTurnDiagnostics = false;
	private diagnosticsInjectedDuringTurnWait = false;
	private readonly lastAutoInjectedState = new Map<string, { hasProblems: boolean; digest: string }>();

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	rememberContext(ctx: ExtensionContext): void {
		this.lastCtx = ctx;
		this.renderStatus();
	}

	async shutdown(): Promise<void> {
		if (this.documents) {
			await this.documents.closeAll();
			this.documents = undefined;
		}
		if (this.client) {
			await this.client.shutdown();
			this.client = undefined;
		}
		this.project = undefined;
		this.command = undefined;
		this.preflightError = undefined;
		this.progress = undefined;
		this.state = "inactive";
		this.stateError = undefined;
		this.diagnostics.clear();
		this.renderStatus();
	}

	async maybeActivateFromCwd(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
		this.rememberContext(ctx);
		const project = await discoverRustProject(ctx.cwd);
		if (!project) {
			if (!this.project) this.renderStatus();
			return;
		}
		try {
			await this.ensureProject(ctx, project, signal);
			await this.client?.ensureReady(signal);
		} catch {
			// Surface through status and tool failures later.
		}
	}

	isActive(): boolean {
		return this.state === "ready" && !!this.project && !!this.client;
	}

	getProjectRoot(): string {
		if (!this.project) throw new Error("No active Rust project");
		return this.project.rootPath;
	}

	getClient(): RustAnalyzerClient {
		if (!this.client) throw new Error("rust-analyzer client is unavailable");
		return this.client;
	}

	getDocuments(): DocumentTracker {
		if (!this.documents) throw new Error("No tracked Rust documents are available");
		return this.documents;
	}

	refreshDiagnosticsForToolResult(_toolName: string, _input: Record<string, unknown>, ctx: ExtensionContext): void {
		this.rememberContext(ctx);
		// Auto-injected diagnostics are disabled for now because rust-analyzer can publish stale file diagnostics.
	}

	async waitForPendingTurnDiagnostics(ctx: ExtensionContext): Promise<void> {
		this.rememberContext(ctx);
	}

	private async refreshTouchedFileDiagnostics(filePath: string, generation: number, ctx: ExtensionContext): Promise<void> {
		try {
			await sleep(DIAGNOSTIC_DEBOUNCE_MS);
			if (this.pendingFileRefreshes.get(filePath) !== generation) return;
			await this.ensureReady(ctx, filePath, ctx.signal);
			const rootPath = this.project?.rootPath;
			if (rootPath && !filePath.startsWith(rootPath)) return;
			if (!(filePath.endsWith(".rs") || path.basename(filePath) === "Cargo.toml" || path.basename(filePath) === "rust-project.json")) return;

			const minUpdatedAt = Date.now();
			const document = await this.getDocuments().ensureSynced(filePath);
			const receivedFreshDiagnostics = await this.diagnostics.waitForPathFresh(document.path, {
				minVersion: document.version,
				minUpdatedAt,
				timeoutMs: DIAGNOSTIC_WAIT_TIMEOUT_MS,
			});
			if (!receivedFreshDiagnostics) return;
			if (this.pendingFileRefreshes.get(filePath) !== generation) return;
			await sleep(DIAGNOSTIC_SETTLE_MS);
			if (this.pendingFileRefreshes.get(filePath) !== generation) return;
			await this.emitDiagnosticsSummary({
				ctx: this.lastCtx ?? ctx,
				paths: [document.path],
				detailPaths: [document.path],
				includeHints: false,
				limit: 12,
				maxTextLength: AUTO_INJECT_MAX_TEXT_LENGTH,
				key: `auto:${document.path}`,
				suppressCleanUnlessResolved: true,
			});
		} catch {
			// Diagnostic auto-refresh failures are reflected through explicit tool failures and status.
		}
	}

	async explicitDiagnostics(ctx: ExtensionContext, params: { path?: string; includeHints?: boolean; limit?: number }): Promise<{
		text: string;
		details: unknown;
	}> {
		this.rememberContext(ctx);
		if (params.path) {
			const scopedPath = await classifyLookupPath(params.path, ctx.cwd);
			if (scopedPath.kind === "directory") {
				throw new Error("lsp_diagnostics path must be a Rust file path. Omit path to inspect the tracked Rust document set.");
			}
			await this.ensureReady(ctx, scopedPath.absolutePath, ctx.signal);
			const minUpdatedAt = Date.now();
			const document = await this.getDocuments().ensureSynced(scopedPath.absolutePath);
			await this.diagnostics.waitForPathFresh(document.path, {
				minVersion: document.version,
				minUpdatedAt,
				timeoutMs: DIAGNOSTIC_WAIT_TIMEOUT_MS,
			});
			await sleep(DIAGNOSTIC_SETTLE_MS);
			const summary = this.diagnostics.summarize({
				paths: [scopedPath.absolutePath],
				detailPaths: [scopedPath.absolutePath],
				includeHints: params.includeHints,
				limit: clampLimit(params.limit, 20),
			});
			return {
				text: summary.text,
				details: {
					projectRoot: this.project!.rootPath,
					...summary.details,
				},
			};
		}

		await this.ensureReady(ctx, undefined, ctx.signal);
		const tracked = this.documents?.getTrackedPaths() ?? [];
		if (tracked.length === 0 && !this.diagnostics.hasAny()) {
			return {
				text: "No tracked Rust documents yet. Use a path-based LSP tool or call lsp_diagnostics with path first.",
				details: {
					projectRoot: this.project!.rootPath,
					trackedCount: 0,
				},
			};
		}
		if (tracked.length > 0) {
			const revisionBeforeSync = this.diagnostics.getRevision();
			await this.getDocuments().ensureManySynced(tracked);
			await this.diagnostics.waitForRevisionAfter(revisionBeforeSync, DIAGNOSTIC_WAIT_TIMEOUT_MS);
			await sleep(DIAGNOSTIC_SETTLE_MS);
		}
		const summary = this.diagnostics.summarize({
			includeHints: params.includeHints,
			limit: clampLimit(params.limit, 20),
		});
		return {
			text: summary.text,
			details: {
				projectRoot: this.project!.rootPath,
				...summary.details,
			},
		};
	}

	async ensureReady(ctx: ExtensionContext, pathHint?: string, signal?: AbortSignal): Promise<void> {
		this.rememberContext(ctx);
		const target = pathHint ? resolveAbsolutePath(pathHint, ctx.cwd) : ctx.cwd;
		const project = (await discoverRustProject(target)) ?? (!pathHint ? this.project : undefined);
		if (!project) {
			throw new Error(pathHint ? `No Rust project detected for ${target}` : "No Rust project detected in the current working directory.");
		}
		await this.ensureProject(ctx, project, signal);
		if (!this.client) {
			throw new Error(this.preflightError?.message ?? "rust-analyzer client is unavailable");
		}
		if (this.preflightError) {
			throw new Error(this.preflightError.message);
		}
		await this.client.ensureReady(signal);
	}

	async syncPath(ctx: ExtensionContext, filePath: string): Promise<{ path: string; uri: string }> {
		await this.ensureReady(ctx, filePath, ctx.signal);
		const document = await this.documents!.ensureSynced(filePath);
		return { path: document.path, uri: document.uri };
	}

	private async ensureProject(ctx: ExtensionContext, project: RustProjectDiscovery, signal?: AbortSignal): Promise<void> {
		const switchingProjects = this.project?.rootPath && this.project.rootPath !== project.rootPath;
		if (switchingProjects) {
			await this.shutdown();
			this.rememberContext(ctx);
		}

		if (!this.project || this.project.rootPath !== project.rootPath || !this.client) {
			this.project = project;
			this.state = "starting";
			this.renderStatus();
			const detection = await detectRustAnalyzer();
			if ("error" in detection) {
				this.preflightError = detection.error;
				this.command = undefined;
				this.client = undefined;
				this.documents = undefined;
				this.state = "error";
				this.stateError = detection.error.message;
				this.renderStatus();
				throw new Error(detection.error.message);
			}

			this.command = detection.command;
			this.preflightError = undefined;
			this.client = new RustAnalyzerClient(project, detection.command, {
				onDiagnostics: (params) => {
					this.diagnostics.update(params);
				},
				onLogMessage: (message) => {
					this.stateError = message;
				},
				onProgress: (progress) => {
					this.progress = progress;
					this.renderStatus();
				},
				onStateChange: (state, error) => {
					this.state = state;
					this.stateError = error;
					this.renderStatus();
				},
			});
			this.documents = new DocumentTracker(this.client, ctx.cwd);
		}
		if (!this.documents && this.client) {
			this.documents = new DocumentTracker(this.client, ctx.cwd);
		}

		if (signal?.aborted) {
			throw new Error("rust-analyzer activation aborted");
		}
	}

	private renderStatus(): void {
		const ctx = this.lastCtx;
		if (!ctx?.hasUI) return;
		let text: string | undefined;
		switch (this.state) {
			case "starting":
				text = ctx.ui.theme.fg("accent", "RA starting");
				break;
			case "ready": {
				const progressText = this.progress?.message || this.progress?.title;
				text = ctx.ui.theme.fg("success", "RA ready");
				if (progressText) text += ctx.ui.theme.fg("dim", ` ${progressText}`);
				break;
			}
			case "broken":
			case "error":
				text = ctx.ui.theme.fg("warning", "RA error");
				break;
			default:
				text = this.project ? ctx.ui.theme.fg("dim", "RA idle") : undefined;
				break;
		}
		ctx.ui.setStatus(EXTENSION_KEY, text);
	}

	private async emitDiagnosticsSummary(options: {
		ctx: ExtensionContext;
		paths?: string[];
		detailPaths?: string[];
		includeHints?: boolean;
		limit?: number;
		maxTextLength?: number;
		suppressCleanUnlessResolved?: boolean;
		key: string;
	}): Promise<void> {
		const summary = this.diagnostics.summarize({
			paths: options.paths,
			detailPaths: options.detailPaths,
			includeHints: options.includeHints,
			limit: options.limit,
			maxTextLength: options.maxTextLength,
		});
		const hasProblems = summary.details.totalDiagnostics > 0;
		const previousAutoState = this.lastAutoInjectedState.get(options.key);
		if (options.suppressCleanUnlessResolved && !hasProblems && !previousAutoState?.hasProblems) {
			return;
		}
		if (!this.diagnostics.shouldEmit(options.key, summary.digest)) return;
		this.diagnostics.markEmitted(options.key, summary.digest);
		this.lastAutoInjectedState.set(options.key, { hasProblems, digest: summary.digest });
		const message = {
			customType: DIAGNOSTIC_MESSAGE_TYPE,
			content: summary.text,
			display: true,
			details: {
				projectRoot: this.project?.rootPath,
				paths: options.paths,
				...summary.details,
			},
		};
		if (this.waitingForTurnDiagnostics) {
			this.diagnosticsInjectedDuringTurnWait = true;
		}
		if (options.ctx.isIdle()) {
			this.pi.sendMessage(message);
		} else {
			this.pi.sendMessage(message, { deliverAs: "steer" });
		}
	}
}

async function updateRustLspToolActivation(pi: ExtensionAPI, ctx: ExtensionContext, _signal?: AbortSignal): Promise<{ rustLspActive: boolean }> {
	const activeTools = new Set(pi.getActiveTools());
	const project = await discoverRustProject(ctx.cwd);
	if (!project) {
		for (const toolName of RUST_LSP_TOOL_NAMES) activeTools.delete(toolName);
		pi.setActiveTools([...activeTools]);
		return { rustLspActive: false };
	}
	const detection = await detectRustAnalyzer();
	if ("error" in detection) {
		for (const toolName of RUST_LSP_TOOL_NAMES) activeTools.delete(toolName);
		pi.setActiveTools([...activeTools]);
		return { rustLspActive: false };
	}
	for (const toolName of RUST_LSP_TOOL_NAMES) activeTools.add(toolName);
	pi.setActiveTools([...activeTools]);
	return { rustLspActive: true };
}

export default function lspRustAnalyzerExtension(pi: ExtensionAPI) {
	const manager = new RustAnalyzerManager(pi);

	pi.registerMessageRenderer(DIAGNOSTIC_MESSAGE_TYPE, (message, _options, theme) => {
		const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageText", String(message.content)), 0, 0));
		return box;
	});

	pi.on("session_start", async (_event, ctx) => {
		await updateRustLspToolActivation(pi, ctx, ctx.signal);
		manager.rememberContext(ctx);
		await manager.maybeActivateFromCwd(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		manager.rememberContext(ctx);
		await manager.shutdown();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const { rustLspActive } = await updateRustLspToolActivation(pi, ctx, ctx.signal);
		manager.rememberContext(ctx);
		await manager.maybeActivateFromCwd(ctx, ctx.signal);
		if (!rustLspActive) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${RUST_LSP_APPEND_PROMPT}`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		manager.rememberContext(ctx);
		if (event.isError) return;
		manager.refreshDiagnosticsForToolResult(event.toolName, event.input, ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		manager.rememberContext(ctx);
		await manager.waitForPendingTurnDiagnostics(ctx);
	});

	pi.registerTool({
		name: "lsp_find_symbol",
		label: "LSP Find Symbol",
		description: "Find Rust symbols by name. Prefer over rg when the symbol is known.",
		promptSnippet: "Find Rust symbols by name. Prefer over rg when the symbol is known.",
		parameters: SymbolLookupParams,
		renderCall(args, theme) {
			return renderToolCallSummary(theme, "lsp_find_symbol", formatLookupScope(args, process.cwd()));
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const pathKind = params.path ? (await classifyLookupPath(params.path, ctx.cwd)).kind : "workspace";
			const candidates = await collectSymbolCandidates(manager, ctx, params, signal);
			const limit = clampLimit(params.limit);
			const shown = candidates.slice(0, limit);
			const resolved = candidates.length === 1 ? `Resolved unambiguously: ${formatCompactSymbol(candidates[0]!, ctx.cwd)}` : undefined;
			const header = candidates.length === 0
				? `No Rust symbols matched ${formatLookupScope(params, ctx.cwd)}.`
				: candidates.length === 1
					? `Rust symbol lookup for ${formatLookupScope(params, ctx.cwd)}`
					: `Ambiguous Rust symbol lookup for ${formatLookupScope(params, ctx.cwd)} (${shown.length}${candidates.length > shown.length ? ` of ${candidates.length}` : ""})`;
			const lines = [header, resolved, ...shown.map((item) => formatCompactSymbol(item, ctx.cwd))].filter(Boolean) as string[];
			if (candidates.length > shown.length) lines.push(`… ${candidates.length - shown.length} more symbol match(es) omitted`);
			if (candidates.length > 1) lines.push(ambiguityRetryLine(pathKind));
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					projectRoot: manager.getProjectRoot(),
					count: candidates.length,
					truncated: candidates.length > shown.length,
					resolved: candidates.length === 1 ? candidates[0] : undefined,
					items: shown,
				},
			};
		},
	});

	pi.registerTool({
		name: "lsp_document_symbols",
		label: "LSP Document Symbols",
		description: "Show a Rust file's symbol outline.",
		promptSnippet: "Show a Rust file's symbol outline.",
		parameters: PathParams,
		renderCall(args, theme) {
			return renderToolCallSummary(theme, "lsp_document_symbols", args.path);
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const scopedPath = await classifyLookupPath(params.path, ctx.cwd);
			if (scopedPath.kind === "directory") {
				throw new Error("lsp_document_symbols requires a Rust file path. Directory paths are not supported.");
			}
			const synced = await manager.syncPath(ctx, scopedPath.absolutePath);
			const rawSymbols = await manager.getClient().documentSymbols(synced.uri, signal);
			let items: Array<CompactSymbolResult & { depth: number }> = [];
			if (rawSymbols.length > 0 && "selectionRange" in rawSymbols[0]!) {
				items = flattenDocumentSymbols(rawSymbols as LspDocumentSymbol[]).map((item) => ({ ...item, path: synced.path }));
			} else {
				items = (rawSymbols as LspSymbolInformation[]).map((item) => ({ ...normalizeWorkspaceSymbol(item), depth: 0 }));
			}
			const text = items.length > 0
				? [
					`Rust document symbols for ${displayPath(synced.path, ctx.cwd)} (${items.length})`,
					...items.map((item) => `${"  ".repeat(item.depth)}${item.kindName} ${item.name}${item.detail ? ` (${item.detail})` : ""} ${item.line}:${item.character}`),
				].join("\n")
				: `No document symbols found for ${displayPath(synced.path, ctx.cwd)}`;
			return {
				content: [{ type: "text", text }],
				details: {
					projectRoot: manager.getProjectRoot(),
					count: items.length,
					items,
				},
			};
		},
	});

	pi.registerTool({
		name: "lsp_hover",
		label: "LSP Hover",
		description: "Show Rust hover info for a symbol.",
		promptSnippet: "Show Rust hover info for a symbol.",
		parameters: SymbolLookupParams,
		renderCall(args, theme) {
			return renderToolCallSummary(theme, "lsp_hover", formatLookupScope(args, process.cwd()));
		},
		renderResult(result) {
			const text = result.content.find((item) => item.type === "text")?.text;
			if (!text) return new Text("", 0, 0);
			return new Markdown(text, 0, 0, getMarkdownTheme());
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const lookup = await resolveNamedSymbol(manager, ctx, params, signal);
			if (!lookup.resolved) {
				const shown = lookup.candidates.slice(0, clampLimit(params.limit, 10));
				return {
					content: [{ type: "text", text: [lookup.message ?? `No Rust symbols matched ${formatLookupScope(params, ctx.cwd)}.`, ...shown.map((item) => formatCompactSymbol(item, ctx.cwd))].join("\n") }],
					details: { projectRoot: manager.getProjectRoot(), count: lookup.candidates.length, items: shown },
				};
			}
			const { symbol, synced } = lookup.resolved;
			const position = manager.getDocuments().toLspPosition(synced.path, symbol.line, symbol.character);
			const hover = await manager.getClient().hover(synced.uri, position, signal);
			const hoverText = hover ? normalizeHoverContents((hover as LspHover).contents) : undefined;
			const rangeText = hover?.range ? formatLocation({ path: synced.path, ...rangeToCompact(hover.range) }, ctx.cwd) : undefined;
			const text = hoverText
				? [`Rust hover for ${formatCompactSymbol(symbol, ctx.cwd)}`, rangeText ? `Hover range: ${rangeText}` : undefined, "", hoverText].filter(Boolean).join("\n")
				: `No hover information for ${formatCompactSymbol(symbol, ctx.cwd)}`;
			return {
				content: [{ type: "text", text }],
				details: {
					projectRoot: manager.getProjectRoot(),
					resolved: symbol,
					range: hover?.range ? rangeToCompact(hover.range) : undefined,
					path: synced.path,
				},
			};
		},
	});

	pi.registerTool({
		name: "lsp_definition",
		label: "LSP Definition",
		description: "Find a Rust symbol's definition. Prefer over rg for Rust code navigation.",
		promptSnippet: "Find a Rust symbol's definition. Prefer over rg for Rust code navigation.",
		parameters: SymbolLookupParams,
		renderCall(args, theme) {
			return renderToolCallSummary(theme, "lsp_definition", formatLookupScope(args, process.cwd()));
		},
		renderResult(result) {
			const text = result.content.find((item) => item.type === "text")?.text;
			if (!text) return new Text("", 0, 0);
			return new Markdown(text, 0, 0, getMarkdownTheme());
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const lookup = await resolveNamedSymbol(manager, ctx, params, signal);
			if (!lookup.resolved) {
				const shown = lookup.candidates.slice(0, clampLimit(params.limit, 10));
				return {
					content: [{ type: "text", text: [lookup.message ?? `No Rust symbols matched ${formatLookupScope(params, ctx.cwd)}.`, ...shown.map((item) => formatCompactSymbol(item, ctx.cwd))].join("\n") }],
					details: { projectRoot: manager.getProjectRoot(), count: lookup.candidates.length, items: shown },
				};
			}
			const { symbol, synced } = lookup.resolved;
			const limit = clampLimit(params.limit);
			const position = manager.getDocuments().toLspPosition(synced.path, symbol.line, symbol.character);
			const raw = await manager.getClient().definition(synced.uri, position, signal);
			const locations = Array.isArray(raw)
				? raw.map((item) => (isLocationLink(item) ? locationLinkToCompact(item) : locationToCompact(item)))
				: raw
					? [isLocationLink(raw) ? locationLinkToCompact(raw) : locationToCompact(raw)]
					: [];
			const shown = locations.slice(0, limit);
			const previews = await Promise.all(shown.map(async (item) => ({ location: item, preview: await buildDefinitionPreview(item) })));
			const text = shown.length > 0
				? [
					`Rust definitions for ${formatCompactSymbol(symbol, ctx.cwd)} (${shown.length}${locations.length > shown.length ? ` of ${locations.length}` : ""})`,
					...previews.flatMap(({ location, preview }, index) => ["", `${index + 1}. ${formatDefinitionLocation(location, ctx.cwd)}`, preview ? `\n\`\`\`rust\n${preview}\n\`\`\`` : ""].filter(Boolean)),
				].join("\n")
				: `No definition found for ${formatCompactSymbol(symbol, ctx.cwd)}`;
			return {
				content: [{ type: "text", text }],
				details: {
					projectRoot: manager.getProjectRoot(),
					resolved: symbol,
					count: locations.length,
					truncated: locations.length > shown.length,
					items: shown,
				},
			};
		},
	});

	pi.registerTool({
		name: "lsp_references",
		label: "LSP References",
		description: "Find references to a Rust symbol. Prefer over rg for Rust usage checks.",
		promptSnippet: "Find references to a Rust symbol. Prefer over rg for Rust usage checks.",
		parameters: ReferencesParams,
		renderCall(args, theme) {
			return renderToolCallSummary(theme, "lsp_references", formatLookupScope(args, process.cwd()));
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const lookup = await resolveNamedSymbol(manager, ctx, params, signal);
			if (!lookup.resolved) {
				const shown = lookup.candidates.slice(0, clampLimit(params.limit, 10));
				return {
					content: [{ type: "text", text: [lookup.message ?? `No Rust symbols matched ${formatLookupScope(params, ctx.cwd)}.`, ...shown.map((item) => formatCompactSymbol(item, ctx.cwd))].join("\n") }],
					details: { projectRoot: manager.getProjectRoot(), count: lookup.candidates.length, items: shown },
				};
			}
			const { symbol, synced } = lookup.resolved;
			const limit = clampLimit(params.limit);
			const position = manager.getDocuments().toLspPosition(synced.path, symbol.line, symbol.character);
			const references = await manager.getClient().references(synced.uri, position, params.includeDeclaration ?? false, signal);
			const normalized = references.map(locationToCompact);
			const shown = normalized.slice(0, limit);
			const lines = shown.length > 0
				? [
					`Rust references for ${formatCompactSymbol(symbol, ctx.cwd)} (${shown.length}${normalized.length > shown.length ? ` of ${normalized.length}` : ""})`,
					...shown.map((item) => formatLocation(item, ctx.cwd)),
				]
				: [`No references found for ${formatCompactSymbol(symbol, ctx.cwd)}`];
			if (normalized.length > shown.length) lines.push(`… ${normalized.length - shown.length} more reference(s) omitted`);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					projectRoot: manager.getProjectRoot(),
					resolved: symbol,
					count: normalized.length,
					truncated: normalized.length > shown.length,
					items: shown,
				},
			};
		},
	});

	pi.registerTool({
		name: "lsp_diagnostics",
		label: "LSP Diagnostics",
		description: "Show Rust diagnostics.",
		promptSnippet: "Show Rust diagnostics.",
		parameters: DiagnosticsParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await manager.explicitDiagnostics(ctx, params);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	});
}
