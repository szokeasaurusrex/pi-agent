import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RustAnalyzerCommand, RustAnalyzerPreflightError, RustProjectDiscovery } from "./types";

const execFileAsync = promisify(execFile);

export function stripLeadingAt(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function resolveAbsolutePath(inputPath: string, cwd: string): string {
	const normalized = stripLeadingAt(inputPath.trim());
	return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(cwd, normalized);
}

export function pathToFileUri(filePath: string): string {
	return pathToFileURL(filePath).toString();
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export async function isDirectory(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isDirectory();
	} catch {
		return false;
	}
}

function collectAncestors(startPath: string): string[] {
	const ancestors: string[] = [];
	let current = path.resolve(startPath);
	while (true) {
		ancestors.push(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return ancestors;
}

async function nearestMarker(startDir: string, fileName: "Cargo.toml" | "rust-project.json"): Promise<string | null> {
	for (const dir of collectAncestors(startDir)) {
		const candidate = path.join(dir, fileName);
		if (await fileExists(candidate)) return candidate;
	}
	return null;
}

async function runCargoMetadata(dir: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
			cwd: dir,
			timeout: 15_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		const payload = JSON.parse(stdout) as { workspace_root?: string };
		if (payload.workspace_root && path.isAbsolute(payload.workspace_root)) {
			return path.normalize(payload.workspace_root);
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export async function discoverRustProject(startPath: string): Promise<RustProjectDiscovery | null> {
	const absolute = path.resolve(startPath);
	const baseDir = (await isDirectory(absolute)) ? absolute : path.dirname(absolute);
	const rustProjectMarker = await nearestMarker(baseDir, "rust-project.json");
	if (rustProjectMarker) {
		const rootPath = path.dirname(rustProjectMarker);
		return {
			rootPath,
			rootUri: pathToFileUri(rootPath),
			markerPath: rustProjectMarker,
			markerType: "rust-project",
		};
	}

	const cargoToml = await nearestMarker(baseDir, "Cargo.toml");
	if (!cargoToml) return null;
	const cargoDir = path.dirname(cargoToml);
	const workspaceRoot = await runCargoMetadata(cargoDir);
	const rootPath = workspaceRoot ?? cargoDir;
	return {
		rootPath,
		rootUri: pathToFileUri(rootPath),
		markerPath: cargoToml,
		markerType: "cargo",
		cargoMetadataWorkspaceRoot: workspaceRoot,
	};
}

interface VersionCheckResult {
	success: boolean;
	stdout: string;
	stderr: string;
	error?: Error;
}

async function runVersionCheck(command: string, args: string[]): Promise<VersionCheckResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, [...args, "--version"], {
			timeout: 15_000,
			maxBuffer: 256 * 1024,
		});
		return {
			success: true,
			stdout: stdout.trim(),
			stderr: stderr.trim(),
		};
	} catch (error) {
		const execError = error as Error & { stdout?: string; stderr?: string };
		return {
			success: false,
			stdout: execError.stdout?.trim() ?? "",
			stderr: execError.stderr?.trim() ?? execError.message,
			error: execError,
		};
	}
}

function formatAttempt(displayCommand: string, result: VersionCheckResult): string {
	const parts = [`- ${displayCommand}`];
	if (result.stdout) parts.push(`stdout: ${result.stdout}`);
	if (result.stderr) parts.push(`stderr: ${result.stderr}`);
	return parts.join(" | ");
}

function buildPreflightError(attempts: string[], stderr?: string): RustAnalyzerPreflightError {
	const lines = [
		"rust-analyzer preflight failed.",
		"No installation is attempted by this extension.",
		"Attempts:",
		...attempts,
	];
	return {
		message: lines.join("\n"),
		attempts,
		stderr,
	};
}

export async function detectRustAnalyzer(): Promise<{ command: RustAnalyzerCommand } | { error: RustAnalyzerPreflightError }> {
	const attempts: string[] = [];
	const direct = await runVersionCheck("rust-analyzer", []);
	attempts.push(formatAttempt("rust-analyzer --version", direct));
	if (direct.success) {
		return {
			command: {
				command: "rust-analyzer",
				args: [],
				displayCommand: "rust-analyzer",
				version: direct.stdout,
			},
		};
	}

	try {
		const { stdout, stderr } = await execFileAsync("rustup", ["which", "rust-analyzer"], {
			timeout: 15_000,
			maxBuffer: 256 * 1024,
		});
		const resolvedPath = stdout.trim();
		if (resolvedPath) {
			const viaRustup = await runVersionCheck(resolvedPath, []);
			attempts.push(formatAttempt(`${resolvedPath} --version`, viaRustup));
			if (viaRustup.success) {
				return {
					command: {
						command: resolvedPath,
						args: [],
						displayCommand: resolvedPath,
						resolvedPath,
						version: viaRustup.stdout,
					},
				};
			}
			return { error: buildPreflightError(attempts, viaRustup.stderr || stderr.trim()) };
		}
		attempts.push(`- rustup which rust-analyzer | stderr: ${stderr.trim() || "(empty)"}`);
	} catch (error) {
		const execError = error as Error & { stderr?: string };
		attempts.push(`- rustup which rust-analyzer | stderr: ${execError.stderr?.trim() || execError.message}`);
	}

	return { error: buildPreflightError(attempts, direct.stderr) };
}
