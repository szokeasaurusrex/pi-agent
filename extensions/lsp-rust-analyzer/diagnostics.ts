import { createHash } from "node:crypto";
import type {
	DiagnosticCacheEntry,
	DiagnosticSummaryDetails,
	LspDiagnostic,
	PublishDiagnosticsParams,
} from "./types";
import { fileUriToPath } from "./documents";

interface SummaryOptions {
	paths?: string[];
	detailPaths?: string[];
	includeHints?: boolean;
	limit?: number;
	includeOtherFileSummary?: boolean;
	maxTextLength?: number;
}

interface WaitForPathFreshOptions {
	minVersion?: number;
	minUpdatedAt?: number;
	timeoutMs: number;
}

const DEFAULT_LIMIT = 20;
const MAX_TEXT_LENGTH = 5_000;

function hashValue(value: unknown): string {
	return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

export function severityName(severity?: number): "error" | "warning" | "info" | "hint" {
	switch (severity) {
		case 2:
			return "warning";
		case 3:
			return "info";
		case 4:
			return "hint";
		case 1:
		default:
			return "error";
	}
}

function oneBasedPosition(diagnostic: LspDiagnostic): { line: number; character: number } {
	return {
		line: diagnostic.range.start.line + 1,
		character: diagnostic.range.start.character + 1,
	};
}

function normalizeCode(code: string | number | undefined): string | undefined {
	return code === undefined ? undefined : String(code);
}

export class DiagnosticsStore {
	private readonly entries = new Map<string, DiagnosticCacheEntry>();
	private readonly lastEmittedDigest = new Map<string, string>();
	private revision = 0;
	private readonly waiters = new Set<() => void>();

	update(params: PublishDiagnosticsParams): void {
		const path = fileUriToPath(params.uri);
		const digest = hashValue({ version: params.version, diagnostics: params.diagnostics });
		this.entries.set(params.uri, {
			uri: params.uri,
			path,
			version: params.version,
			diagnostics: params.diagnostics,
			digest,
			updatedAt: Date.now(),
		});
		this.revision += 1;
		for (const resolve of this.waiters) resolve();
		this.waiters.clear();
	}

	clear(): void {
		this.entries.clear();
		this.lastEmittedDigest.clear();
		this.revision = 0;
		for (const resolve of this.waiters) resolve();
		this.waiters.clear();
	}

	getRevision(): number {
		return this.revision;
	}

	async waitForRevisionAfter(revision: number, timeoutMs: number): Promise<boolean> {
		if (this.revision > revision) return true;
		return await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.waiters.delete(onUpdate);
				resolve(this.revision > revision);
			}, timeoutMs);
			const onUpdate = () => {
				clearTimeout(timer);
				this.waiters.delete(onUpdate);
				resolve(this.revision > revision);
			};
			this.waiters.add(onUpdate);
		});
	}

	private isPathFresh(path: string, options: WaitForPathFreshOptions): boolean {
		const entry = this.getByPath(path);
		if (!entry) return false;
		if (options.minUpdatedAt !== undefined && entry.updatedAt < options.minUpdatedAt) return false;
		if (options.minVersion !== undefined && entry.version !== undefined && entry.version < options.minVersion) return false;
		return true;
	}

	async waitForPathFresh(path: string, options: WaitForPathFreshOptions): Promise<boolean> {
		if (this.isPathFresh(path, options)) return true;
		return await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.waiters.delete(onUpdate);
				resolve(this.isPathFresh(path, options));
			}, options.timeoutMs);
			const onUpdate = () => {
				if (!this.isPathFresh(path, options)) return;
				clearTimeout(timer);
				this.waiters.delete(onUpdate);
				resolve(true);
			};
			this.waiters.add(onUpdate);
		});
	}

	getByPath(filePath: string): DiagnosticCacheEntry | undefined {
		for (const entry of this.entries.values()) {
			if (entry.path === filePath) return entry;
		}
		return undefined;
	}

	hasAny(): boolean {
		return this.entries.size > 0;
	}

	summarize(options: SummaryOptions = {}): { text: string; details: DiagnosticSummaryDetails; digest: string } {
		const includeHints = options.includeHints ?? false;
		const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
		const maxTextLength = options.maxTextLength ?? MAX_TEXT_LENGTH;
		const preferredPaths = (options.paths ?? []).map((filePath) => filePath);
		const preferredSet = new Set(preferredPaths);
		const detailPaths = (options.detailPaths ?? []).map((filePath) => filePath);
		const detailSet = new Set(detailPaths);

		const filteredEntries = [...this.entries.values()]
			.map((entry) => ({
				...entry,
				diagnostics: entry.diagnostics.filter((diagnostic) => includeHints || severityName(diagnostic.severity) !== "hint"),
			}))
			.filter((entry) => entry.diagnostics.length > 0)
			.sort((left, right) => {
				const leftPreferred = preferredSet.has(left.path) ? 0 : 1;
				const rightPreferred = preferredSet.has(right.path) ? 0 : 1;
				if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
				return left.path.localeCompare(right.path);
			});

		const severities: DiagnosticSummaryDetails["severities"] = {
			error: 0,
			warning: 0,
			info: 0,
			hint: 0,
		};

		const items: DiagnosticSummaryDetails["items"] = [];
		let otherFilesWithDiagnostics = 0;
		let otherDiagnostics = 0;
		let shown = 0;

		for (const entry of filteredEntries) {
			const entryPreferred = preferredSet.size === 0 || preferredSet.has(entry.path);
			const includeDetailsForEntry = detailSet.size === 0 || detailSet.has(entry.path);
			let countedAsOtherFile = false;
			for (const diagnostic of entry.diagnostics) {
				const severity = severityName(diagnostic.severity);
				severities[severity] += 1;

				if (includeDetailsForEntry && shown < limit) {
					const position = oneBasedPosition(diagnostic);
					items.push({
						path: entry.path,
						severity,
						line: position.line,
						character: position.character,
						source: diagnostic.source,
						code: normalizeCode(diagnostic.code),
						message: diagnostic.message.replace(/\s+/g, " ").trim(),
						codeDescriptionHref: diagnostic.codeDescription?.href,
					});
					shown += 1;
				} else {
					otherDiagnostics += 1;
					if (!countedAsOtherFile && (!entryPreferred || !includeDetailsForEntry)) {
						otherFilesWithDiagnostics += 1;
						countedAsOtherFile = true;
					}
				}
			}
		}

		const totalDiagnostics = Object.values(severities).reduce((sum, count) => sum + count, 0);
		const totalFiles = filteredEntries.length;
		const header = totalDiagnostics === 0
			? "Rust diagnostics: clean"
			: `Rust diagnostics: ${severities.error} error(s), ${severities.warning} warning(s), ${severities.info} info, ${includeHints ? severities.hint : 0} hint(s) across ${totalFiles} file(s)`;

		const lines = [header];
		for (const item of items) {
			const labelParts = [item.source, item.code].filter(Boolean);
			const label = labelParts.length > 0 ? ` [${labelParts.join("/")}]` : "";
			lines.push(`${item.path}:${item.line}:${item.character} ${item.severity}${label} ${item.message}`);
		}

		if (totalDiagnostics > shown) {
			const remaining = totalDiagnostics - shown;
			lines.push(`… ${remaining} more diagnostic(s) not shown`);
		}

		if ((options.includeOtherFileSummary ?? true) && otherDiagnostics > 0 && preferredSet.size > 0) {
			lines.push(`+ ${otherDiagnostics} diagnostic(s) in ${otherFilesWithDiagnostics} other file(s)`);
		}

		let text = lines.join("\n");
		let truncated = false;
		if (text.length > maxTextLength) {
			text = `${text.slice(0, maxTextLength - 1)}…`;
			truncated = true;
		}

		const details: DiagnosticSummaryDetails = {
			totalFiles,
			totalDiagnostics,
			shownDiagnostics: shown,
			truncated,
			severities,
			items,
			otherFilesWithDiagnostics,
			otherDiagnostics,
		};

		return {
			text,
			details,
			digest: hashValue({ preferredPaths, detailPaths, includeHints, limit, maxTextLength, items, totalDiagnostics }),
		};
	}

	shouldEmit(key: string, digest: string): boolean {
		return this.lastEmittedDigest.get(key) !== digest;
	}

	markEmitted(key: string, digest: string): void {
		this.lastEmittedDigest.set(key, digest);
	}
}
