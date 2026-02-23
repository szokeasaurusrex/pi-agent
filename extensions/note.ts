import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const sendNote = (text: string, ctx: ExtensionContext) => {
		const message = {
			customType: "note",
			content: `User note: ${text}`,
			display: true,
		};

		if (ctx.isIdle()) {
			pi.sendMessage(message);
		} else {
			// Avoid interrupting an in-progress run; inject on next turn instead.
			pi.sendMessage(message, { deliverAs: "nextTurn" });
			ctx.ui.notify("Note queued for next turn", "info");
		}
	};


	pi.registerCommand("note", {
		description: "Add a user note to context without triggering a response",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /note <text>", "warning");
				return;
			}
			sendNote(text, ctx);
		},
	});

	pi.on("input", async (event, ctx) => {
		const prefix = "User note:";
		if (!event.text.startsWith(prefix)) {
			return { action: "continue" };
		}

		const text = event.text.slice(prefix.length).trim();
		if (!text) {
			ctx.ui.notify("Note is empty", "warning");
			return { action: "handled" };
		}

		sendNote(text, ctx);
		return { action: "handled" };
	});

}
