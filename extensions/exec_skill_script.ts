import { access, mkdtemp, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getAgentDir,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface ExecSkillScriptInput {
	skill: string;
	command: string;
	timeoutMs?: number;
}

const ExecSkillScriptParams = Type.Object({
	skill: Type.String({ description: "Skill name, e.g. 'sub-agents'" }),
	command: Type.String({
		description:
			"Script invocation relative to the skill directory, including arguments, e.g. 'scripts/run-subagent.sh --help'",
	}),
	timeoutMs: Type.Optional(
		Type.Number({ description: "Timeout in milliseconds. Optional.", minimum: 1, maximum: 3_600_000 }),
	),
});

interface SkillResolution {
	skillName: string;
	skillDir: string;
	skillFile: string;
}

function stripLeadingAt(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function collectAncestorDirs(start: string): string[] {
	const dirs: string[] = [];
	let current = path.resolve(start);

	while (true) {
		dirs.push(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return dirs;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function resolveSkill(ctxCwd: string, skillName: string): Promise<SkillResolution | null> {
	const normalized = stripLeadingAt(skillName.trim());
	if (!normalized) return null;

	const candidates: string[] = [];
	for (const dir of collectAncestorDirs(ctxCwd)) {
		candidates.push(path.join(dir, ".pi", "skills", normalized, "SKILL.md"));
		candidates.push(path.join(dir, ".agents", "skills", normalized, "SKILL.md"));
	}

	candidates.push(path.join(getAgentDir(), "skills", normalized, "SKILL.md"));
	candidates.push(path.join(path.join(process.env.HOME || "~", ".agents", "skills", normalized, "SKILL.md")));

	for (const skillFile of candidates) {
		if (await fileExists(skillFile)) {
			return {
				skillName: normalized,
				skillFile,
				skillDir: path.dirname(skillFile),
			};
		}
	}

	return null;
}

function parseCommand(command: string): string[] {
	const input = command.trim();
	if (!input) throw new Error("command must not be empty");

	const tokens: string[] = [];
	let current = "";
	let quote: "single" | "double" | null = null;
	let escaped = false;

	for (const char of input) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (quote === "single") {
			if (char === "'") quote = null;
			else current += char;
			continue;
		}

		if (quote === "double") {
			if (char === '"') {
				quote = null;
			} else if (char === "\\") {
				escaped = true;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "\\") {
			escaped = true;
			continue;
		}

		if (char === "'") {
			quote = "single";
			continue;
		}

		if (char === '"') {
			quote = "double";
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaped) throw new Error("command ends with an unfinished escape");
	if (quote) throw new Error("command has an unterminated quote");
	if (current) tokens.push(current);
	if (tokens.length === 0) throw new Error("command must include a script path");

	return tokens;
}

async function storeFullOutput(output: string): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "pi-exec-skill-script-"));
	const filePath = path.join(dir, "output.txt");
	await writeFile(filePath, output, "utf-8");
	return filePath;
}

export default function execSkillScriptExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "exec_skill_script",
		label: "Exec Skill Script",
		description: `Execute a skill script by resolving the script path relative to the skill's SKILL.md directory. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
		promptSnippet: "Execute a skill script by skill name and a relative script command.",
		promptGuidelines: [
			"Use this tool when you need to run a script referenced by a skill using a path relative to that skill's SKILL.md directory.",
			"Pass the skill name and a single script command string, for example skill='sub-agents' and command='scripts/run-subagent.sh --help'.",
		],
		parameters: ExecSkillScriptParams as unknown as Parameters<typeof pi.registerTool>[0]["parameters"],

		async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
			const params = rawParams as ExecSkillScriptInput;
			const skill = await resolveSkill(ctx.cwd, params.skill);
			if (!skill) {
				throw new Error(`Unknown skill: ${params.skill}`);
			}

			const argv = parseCommand(params.command);
			const scriptToken = stripLeadingAt(argv[0]);
			const scriptPath = path.isAbsolute(scriptToken) ? scriptToken : path.resolve(skill.skillDir, scriptToken);

			await access(scriptPath, constants.F_OK);
			await access(scriptPath, constants.X_OK);

			const args = argv.slice(1);
			const result = await pi.exec(scriptPath, args, {
				signal,
				timeout: params.timeoutMs,
			});

			const fullOutput = [result.stdout || "", result.stderr ? `STDERR:\n${result.stderr}` : ""]
				.filter(Boolean)
				.join(result.stdout && result.stderr ? "\n\n" : "");

			const truncation = truncateTail(fullOutput, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let text = truncation.content;
			let fullOutputPath: string | undefined;
			if (truncation.truncated) {
				fullOutputPath = await storeFullOutput(fullOutput);
				text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
			}

			if (result.code !== 0) {
				throw new Error(text);
			}

			return {
				content: [{ type: "text", text }],
				details: {
					skill: skill.skillName,
					skillFile: skill.skillFile,
					skillDir: skill.skillDir,
					scriptPath,
					args,
					exitCode: result.code,
					stdoutBytes: Buffer.byteLength(result.stdout || "", "utf-8"),
					stderrBytes: Buffer.byteLength(result.stderr || "", "utf-8"),
					truncated: truncation.truncated,
					fullOutputPath,
				},
			};
		},
	});
}
