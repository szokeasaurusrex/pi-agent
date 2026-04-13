import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface JsonRpcRequestMessage {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotificationMessage {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface JsonRpcSuccessMessage {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
}

export interface JsonRpcErrorObject {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcErrorMessage {
	jsonrpc: "2.0";
	id: number | string | null;
	error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
	| JsonRpcRequestMessage
	| JsonRpcNotificationMessage
	| JsonRpcSuccessMessage
	| JsonRpcErrorMessage;

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

export interface LspLocationLink {
	originSelectionRange?: LspRange;
	targetUri: string;
	targetRange: LspRange;
	targetSelectionRange: LspRange;
}

export interface LspMarkupContent {
	kind: "plaintext" | "markdown" | string;
	value: string;
}

export type LspMarkedString = string | { language: string; value: string };

export interface LspHover {
	contents: LspMarkupContent | LspMarkedString | LspMarkedString[];
	range?: LspRange;
}

export interface LspSymbolInformation {
	name: string;
	kind: number;
	location: LspLocation;
	containerName?: string;
	deprecated?: boolean;
	tags?: number[];
}

export interface LspWorkspaceSymbol {
	name: string;
	kind: number;
	location: LspLocation | {
		uri: string;
	};
	containerName?: string;
	tags?: number[];
	data?: unknown;
}

export interface LspDocumentSymbol {
	name: string;
	kind: number;
	range: LspRange;
	selectionRange: LspRange;
	detail?: string;
	children?: LspDocumentSymbol[];
	deprecated?: boolean;
	tags?: number[];
}

export interface LspDiagnosticRelatedInformation {
	location: LspLocation;
	message: string;
}

export interface LspCodeDescription {
	href: string;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: number;
	code?: number | string;
	codeDescription?: LspCodeDescription;
	source?: string;
	message: string;
	relatedInformation?: LspDiagnosticRelatedInformation[];
	data?: unknown;
}

export interface PublishDiagnosticsParams {
	uri: string;
	version?: number;
	diagnostics: LspDiagnostic[];
}

export interface RustProjectDiscovery {
	rootPath: string;
	rootUri: string;
	markerPath: string;
	markerType: "cargo" | "rust-project";
	cargoMetadataWorkspaceRoot?: string;
}

export interface RustAnalyzerCommand {
	command: string;
	args: string[];
	displayCommand: string;
	resolvedPath?: string;
	version: string;
}

export interface RustAnalyzerPreflightError {
	message: string;
	attempts: string[];
	stderr?: string;
}

export interface TrackedDocument {
	path: string;
	uri: string;
	languageId: "rust" | "toml" | "json";
	text: string;
	version: number;
	lastSyncedDigest: string;
	lastSyncedMtimeMs?: number;
}

export interface DiagnosticCacheEntry {
	uri: string;
	path: string;
	version?: number;
	diagnostics: LspDiagnostic[];
	digest: string;
	updatedAt: number;
}

export interface DiagnosticSummaryItem {
	path: string;
	severity: "error" | "warning" | "info" | "hint";
	line: number;
	character: number;
	source?: string;
	code?: string;
	message: string;
	codeDescriptionHref?: string;
}

export interface DiagnosticSummaryDetails {
	totalFiles: number;
	totalDiagnostics: number;
	shownDiagnostics: number;
	truncated: boolean;
	severities: Record<"error" | "warning" | "info" | "hint", number>;
	items: DiagnosticSummaryItem[];
	otherFilesWithDiagnostics: number;
	otherDiagnostics: number;
}

export interface CompactLocation {
	path: string;
	line: number;
	character: number;
	endLine?: number;
	endCharacter?: number;
	selectionLine?: number;
	selectionCharacter?: number;
	selectionEndLine?: number;
	selectionEndCharacter?: number;
}

export interface CompactSymbolResult {
	name: string;
	kind: number;
	kindName: string;
	path: string;
	line: number;
	character: number;
	containerName?: string;
	detail?: string;
}

export interface ToolTextResultDetails {
	projectRoot: string;
	count: number;
	truncated?: boolean;
	items: unknown[];
}

export type SessionState = "inactive" | "starting" | "ready" | "broken" | "error";

export interface SessionStatus {
	state: SessionState;
	text: string;
	projectRoot?: string;
	error?: string;
}

export interface ProgressState {
	token: string;
	title?: string;
	message?: string;
	percentage?: number;
}

export interface ProtocolSpawnResult {
	process: ChildProcessWithoutNullStreams;
}
