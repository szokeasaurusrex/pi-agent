import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface QuestionnaireQuestion {
	id: string;
	prompt: string;
	options: string[];
}

interface QuestionnaireAnswer {
	id: string;
	value: string;
	source: "option" | "custom";
}

interface QuestionnaireDetails {
	cancelled: boolean;
	interrupted: boolean;
	answers: QuestionnaireAnswer[];
	unanswered: string[];
	error?: string;
}

interface QuestionnaireUIResult {
	interrupted: boolean;
	answersById: Map<string, QuestionnaireAnswer>;
}

const QuestionnaireParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "Stable key for answer mapping" }),
			prompt: Type.String({ description: "Question shown to the user" }),
			options: Type.Array(Type.String({ description: "Option text" }), {
				description: "Multiple-choice options",
			}),
		}),
		{ description: "Questions to ask in one questionnaire flow" },
	),
});

function normalizeQuestions(input: QuestionnaireQuestion[]): { questions?: QuestionnaireQuestion[]; error?: string } {
	if (input.length === 0) {
		return { error: "Error: questions must contain at least one question." };
	}

	const seen = new Set<string>();
	for (let i = 0; i < input.length; i++) {
		const q = input[i];
		const idx = i + 1;
		if (!q.id?.trim()) {
			return { error: `Error: questions[${i}].id is required.` };
		}
		const normalizedId = q.id.trim();
		if (seen.has(normalizedId)) {
			return { error: `Error: duplicate question id '${normalizedId}' at index ${idx}.` };
		}
		seen.add(normalizedId);
		if (!q.prompt?.trim()) {
			return { error: `Error: questions[${i}].prompt is required.` };
		}
		if (!Array.isArray(q.options) || q.options.length === 0) {
			return { error: `Error: questions[${i}].options must contain at least one option.` };
		}
		for (let j = 0; j < q.options.length; j++) {
			if (!q.options[j]?.trim()) {
				return { error: `Error: questions[${i}].options[${j}] must be a non-empty string.` };
			}
		}
	}

	return {
		questions: input.map((q) => ({
			id: q.id.trim(),
			prompt: q.prompt.trim(),
			options: q.options.map((o) => o.trim()),
		})),
	};
}

function escapeValue(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function toResult(questions: QuestionnaireQuestion[], answersById: Map<string, QuestionnaireAnswer>, interrupted: boolean): {
	content: { type: "text"; text: string }[];
	details: QuestionnaireDetails;
} {
	const answers: QuestionnaireAnswer[] = [];
	for (const q of questions) {
		const a = answersById.get(q.id);
		if (a) answers.push(a);
	}
	const unanswered = questions.filter((q) => !answersById.has(q.id)).map((q) => q.id);
	const lines: string[] = [];
	if (interrupted) {
		lines.push("INTERRUPTED");
	}
	for (const answer of answers) {
		lines.push(`Q(${answer.id})=${escapeValue(answer.value)}`);
	}
	if (!interrupted && lines.length === 0) {
		lines.push("NO_ANSWERS");
	}

	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: {
			cancelled: interrupted,
			interrupted,
			answers,
			unanswered,
		},
	};
}

function errorResult(message: string): { content: { type: "text"; text: string }[]; details: QuestionnaireDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: {
			cancelled: true,
			interrupted: false,
			answers: [],
			unanswered: [],
			error: message,
		},
	};
}

export default function questionnaireUI(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask one or more multiple-choice questions. Includes a final 'Type something.' option for custom answers.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: questionnaire requires an interactive UI session.");
			}

			const normalized = normalizeQuestions(params.questions as QuestionnaireQuestion[]);
			if (!normalized.questions) {
				return errorResult(normalized.error ?? "Error: invalid questionnaire payload.");
			}
			const questions = normalized.questions;

			const uiResult = await ctx.ui.custom<QuestionnaireUIResult>((tui, theme, _kb, done) => {
				const selectedByQuestion = new Map<string, number>();
				const answersById = new Map<string, QuestionnaireAnswer>();
				let activeQuestionIndex = 0;
				let editorMode = false;
				let editorQuestionId: string | null = null;
				let cachedLines: string[] | undefined;

				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (s) => theme.fg("accent", s),
						selectedText: (s) => theme.fg("accent", s),
						description: (s) => theme.fg("muted", s),
						scrollInfo: (s) => theme.fg("dim", s),
						noMatch: (s) => theme.fg("warning", s),
					},
				};
				const editor = new Editor(tui, editorTheme);

				const refresh = () => {
					cachedLines = undefined;
					tui.requestRender();
				};

				const finish = (interrupted: boolean) => {
					done({ interrupted, answersById });
				};

				const submitIndex = questions.length;

				const getOptions = (questionIndex: number): string[] => {
					const base = questions[questionIndex]?.options ?? [];
					return [...base, "Type something."];
				};

				const getCurrentSelection = (): number => {
					if (activeQuestionIndex >= submitIndex) return 0;
					const q = questions[activeQuestionIndex];
					const options = getOptions(activeQuestionIndex);
					const existing = selectedByQuestion.get(q.id);
					return Math.min(existing ?? 0, Math.max(0, options.length - 1));
				};

				const setCurrentSelection = (value: number) => {
					if (activeQuestionIndex >= submitIndex) return;
					const q = questions[activeQuestionIndex];
					const options = getOptions(activeQuestionIndex);
					const next = Math.max(0, Math.min(value, options.length - 1));
					selectedByQuestion.set(q.id, next);
				};

				const moveQuestion = (delta: number) => {
					const maxIndex = submitIndex;
					activeQuestionIndex = (activeQuestionIndex + delta + maxIndex + 1) % (maxIndex + 1);
				};

				const answerCurrentFromOption = (selection: number) => {
					const q = questions[activeQuestionIndex];
					const options = getOptions(activeQuestionIndex);
					const customIndex = options.length - 1;
					if (selection === customIndex) {
						editorMode = true;
						editorQuestionId = q.id;
						editor.setText("");
						return;
					}

					answersById.set(q.id, {
						id: q.id,
						value: options[selection],
						source: "option",
					});

					if (activeQuestionIndex < submitIndex - 1) {
						activeQuestionIndex += 1;
					} else {
						activeQuestionIndex = submitIndex;
					}
				};

				editor.onSubmit = (value) => {
					if (!editorQuestionId) return;
					answersById.set(editorQuestionId, {
						id: editorQuestionId,
						value: value.trim(),
						source: "custom",
					});
					editorMode = false;
					editorQuestionId = null;
					editor.setText("");
					if (activeQuestionIndex < submitIndex - 1) {
						activeQuestionIndex += 1;
					} else {
						activeQuestionIndex = submitIndex;
					}
					refresh();
				};

				const handleInput = (data: string) => {
					if (matchesKey(data, Key.escape)) {
						finish(true);
						return;
					}

					if (editorMode) {
						editor.handleInput(data);
						refresh();
						return;
					}

					if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
						moveQuestion(1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
						moveQuestion(-1);
						refresh();
						return;
					}

					if (activeQuestionIndex === submitIndex) {
						if (matchesKey(data, Key.enter)) {
							finish(false);
						}
						return;
					}

					if (matchesKey(data, Key.up)) {
						setCurrentSelection(getCurrentSelection() - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						setCurrentSelection(getCurrentSelection() + 1);
						refresh();
						return;
					}

					if (matchesKey(data, Key.enter)) {
						answerCurrentFromOption(getCurrentSelection());
						refresh();
					}
				};

				const render = (width: number): string[] => {
					if (cachedLines) return cachedLines;
					const lines: string[] = [];
					const add = (line: string) => lines.push(truncateToWidth(line, width));

					add(theme.fg("accent", "─".repeat(width)));

					const tabParts: string[] = [];
					for (let i = 0; i < questions.length; i++) {
						const q = questions[i];
						const answered = answersById.has(q.id);
						const active = i === activeQuestionIndex;
						const label = `${answered ? "■" : "□"} ${q.id}`;
						const styled = active
							? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
							: theme.fg(answered ? "success" : "muted", ` ${label} `);
						tabParts.push(styled);
					}
					const submitActive = activeQuestionIndex === submitIndex;
					const submitStyled = submitActive
						? theme.bg("selectedBg", theme.fg("text", " Submit "))
						: theme.fg("accent", " Submit ");
					tabParts.push(submitStyled);
					add(` ${tabParts.join(" ")}`);
					lines.push("");

					if (activeQuestionIndex === submitIndex) {
						add(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						for (const q of questions) {
							const answer = answersById.get(q.id);
							if (!answer) continue;
							add(` ${theme.fg("muted", `${q.id}: `)}${theme.fg("text", answer.value)}`);
						}
						lines.push("");
						add(theme.fg("dim", " Enter submit • Tab/Shift+Tab or ←→ navigate • Esc interrupt"));
						add(theme.fg("accent", "─".repeat(width)));
						cachedLines = lines;
						return lines;
					}

					const question = questions[activeQuestionIndex];
					const options = getOptions(activeQuestionIndex);
					const selection = getCurrentSelection();
					add(theme.fg("text", ` ${question.prompt}`));
					lines.push("");
					for (let i = 0; i < options.length; i++) {
						const selected = i === selection;
						const prefix = selected ? theme.fg("accent", "> ") : "  ";
						const text = `${i + 1}. ${options[i]}`;
						add(prefix + (selected ? theme.fg("accent", text) : theme.fg("text", text)));
					}

					const existingAnswer = answersById.get(question.id);
					if (existingAnswer) {
						lines.push("");
						add(theme.fg("muted", ` Current answer: ${existingAnswer.value} (${existingAnswer.source})`));
					}

					if (editorMode) {
						lines.push("");
						add(theme.fg("muted", " Type your answer:"));
						for (const editorLine of editor.render(Math.max(10, width - 2))) {
							add(` ${editorLine}`);
						}
					}

					lines.push("");
					add(theme.fg("dim", " ↑↓ option • Enter select/submit • Tab/Shift+Tab or ←→ question • Esc interrupt"));
					add(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					return lines;
				};

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			const result = toResult(questions, uiResult.answersById, uiResult.interrupted);
			if (uiResult.interrupted) {
				void ctx.abort();
			}
			return result;
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			return new Text(
				theme.fg("toolTitle", theme.bold("questionnaire ")) +
					theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", details.error), 0, 0);
			}

			const answered = details.answers.length;
			const total = answered + details.unanswered.length;
			const status = details.interrupted ? theme.fg("warning", "INTERRUPTED") : theme.fg("success", "COMPLETED");
			return new Text(`${status} ${theme.fg("muted", `${answered}/${total} answered`)}`, 0, 0);
		},
	});
}
