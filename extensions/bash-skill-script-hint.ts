import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const HINT = "Hint: Perhaps you meant to use the exec_skill_script tool?";

type TextPart = { type: string; text?: string };

function textParts(content: unknown): TextPart[] {
  return Array.isArray(content) ? (content as TextPart[]) : [];
}

function shouldHint(text: string): boolean {
  return (
    !text.includes(HINT) &&
    /(?:^|\n)\/bin\/bash: scripts\/[^\r\n:]+: No such file or directory(?:\n|$)/.test(text)
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash" || !event.isError) return;

    const content = textParts(event.content);
    const index = content.findIndex((part) => part.type === "text" && typeof part.text === "string");
    if (index === -1) return;

    const current = content[index]!.text!;
    if (!shouldHint(current)) return;

    const next = [...content];
    next[index] = {
      ...next[index],
      text: `${current}\n\n${HINT}`,
    };

    return { content: next };
  });
}
