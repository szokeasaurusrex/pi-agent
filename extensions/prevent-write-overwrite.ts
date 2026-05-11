import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";

const OVERWRITE_BLOCK_REASON =
	"The write tool cannot overwrite files; use edit instead. " +
	"Only if extensive changes are required, you may safe_delete the file, then write it";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

export default function preventWriteOverwrite(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (!isToolCallEventType("write", event)) return;
		if (typeof event.input.path !== "string") return;

		const absolutePath = resolve(ctx.cwd, event.input.path);

		try {
			lstatSync(absolutePath);
			return { block: true, reason: OVERWRITE_BLOCK_REASON };
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") return;

			const message = error instanceof Error ? error.message : String(error);
			return {
				block: true,
				reason: `${OVERWRITE_BLOCK_REASON}\n\nBlocked because Pi could not safely check whether the target path exists: ${message}`,
			};
		}
	});
}
