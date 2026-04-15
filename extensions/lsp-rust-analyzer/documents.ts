import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LspPosition, LspRange, TrackedDocument } from "./types";
import { pathToFileUri, resolveAbsolutePath, stripLeadingAt } from "./discovery";

interface SyncTransport {
	notify(method: string, params?: unknown): Promise<void>;
}

function digestText(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

function splitLines(text: string): string[] {
	const lines = text.split(/\r?\n/);
	return lines.length === 0 ? [""] : lines;
}

function utf16Length(text: string): number {
	return Array.from(text).reduce((count, char) => count + (char.codePointAt(0)! > 0xffff ? 2 : 1), 0);
}

function utf16OffsetForCharacter(lineText: string, oneBasedCharacter: number): number {
	const targetColumn = Math.max(1, oneBasedCharacter);
	let utf16Units = 0;
	let column = 1;
	for (const char of lineText) {
		if (column >= targetColumn) break;
		utf16Units += char.codePointAt(0)! > 0xffff ? 2 : 1;
		column += 1;
	}
	return utf16Units;
}

function wholeDocumentRange(text: string): LspRange {
	const lines = splitLines(text);
	const lastLineIndex = Math.max(0, lines.length - 1);
	const lastLine = lines[lastLineIndex] ?? "";
	return {
		start: { line: 0, character: 0 },
		end: {
			line: lastLineIndex,
			character: utf16Length(lastLine),
		},
	};
}

function inferLanguageId(filePath: string): TrackedDocument["languageId"] | null {
	const basename = path.basename(filePath);
	if (filePath.endsWith(".rs")) return "rust";
	if (basename === "Cargo.toml") return "toml";
	if (basename === "rust-project.json") return "json";
	return null;
}

export function fileUriToPath(uri: string): string {
	return path.normalize(fileURLToPath(uri));
}

export class DocumentTracker {
	private readonly documents = new Map<string, TrackedDocument>();
	private readonly transport: SyncTransport;
	private readonly cwd: string;

	constructor(transport: SyncTransport, cwd: string) {
		this.transport = transport;
		this.cwd = cwd;
	}

	getTrackedPaths(): string[] {
		return [...this.documents.keys()];
	}

	getTrackedDocument(filePath: string): TrackedDocument | undefined {
		return this.documents.get(path.normalize(filePath));
	}

	getTrackedByUri(uri: string): TrackedDocument | undefined {
		for (const document of this.documents.values()) {
			if (document.uri === uri) return document;
		}
		return undefined;
	}

	async ensureSynced(inputPath: string): Promise<TrackedDocument> {
		const absolutePath = resolveAbsolutePath(stripLeadingAt(inputPath), this.cwd);
		const normalizedPath = path.normalize(absolutePath);
		const languageId = inferLanguageId(normalizedPath);
		if (!languageId) {
			throw new Error(`Unsupported Rust LSP file path: ${inputPath}`);
		}

		const fileStat = await stat(normalizedPath);
		const text = await readFile(normalizedPath, "utf8");
		const digest = digestText(text);
		const existing = this.documents.get(normalizedPath);
		const uri = pathToFileUri(normalizedPath);

		if (!existing) {
			const opened: TrackedDocument = {
				path: normalizedPath,
				uri,
				languageId,
				text,
				version: 1,
				lastSyncedDigest: digest,
				lastSyncedMtimeMs: fileStat.mtimeMs,
			};
			await this.transport.notify("textDocument/didOpen", {
				textDocument: {
					uri,
					languageId,
					version: opened.version,
					text,
				},
			});
			this.documents.set(normalizedPath, opened);
			return opened;
		}

		if (existing.lastSyncedDigest === digest && existing.lastSyncedMtimeMs === fileStat.mtimeMs) {
			return existing;
		}

		const nextVersion = existing.version + 1;
		await this.transport.notify("textDocument/didChange", {
			textDocument: {
				uri: existing.uri,
				version: nextVersion,
			},
			contentChanges: [
				{
					range: wholeDocumentRange(existing.text),
					text,
				},
			],
		});

		const updated: TrackedDocument = {
			...existing,
			text,
			version: nextVersion,
			lastSyncedDigest: digest,
			lastSyncedMtimeMs: fileStat.mtimeMs,
		};
		this.documents.set(normalizedPath, updated);
		return updated;
	}

	async ensureManySynced(paths: string[]): Promise<TrackedDocument[]> {
		const synced: TrackedDocument[] = [];
		for (const filePath of paths) {
			synced.push(await this.ensureSynced(filePath));
		}
		return synced;
	}

	async closeAll(): Promise<void> {
		for (const document of this.documents.values()) {
			await this.transport.notify("textDocument/didClose", {
				textDocument: { uri: document.uri },
			});
		}
		this.documents.clear();
	}

	toLspPosition(filePath: string, line: number, character: number): LspPosition {
		const absolutePath = resolveAbsolutePath(filePath, this.cwd);
		const document = this.documents.get(path.normalize(absolutePath));
		if (!document) {
			throw new Error(`Document is not tracked: ${filePath}`);
		}

		const lines = splitLines(document.text);
		const clampedLineNumber = Math.min(Math.max(1, line), Math.max(1, lines.length));
		const lineText = lines[clampedLineNumber - 1] ?? "";
		const maxCharacter = Math.max(1, Array.from(lineText).length + 1);
		const clampedCharacter = Math.min(Math.max(1, character), maxCharacter);

		return {
			line: clampedLineNumber - 1,
			character: utf16OffsetForCharacter(lineText, clampedCharacter),
		};
	}
}
