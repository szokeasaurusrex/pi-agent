import process from "node:process";
import { StdioJsonRpcClient } from "./protocol";
import type {
	LspDiagnostic,
	LspDocumentSymbol,
	LspHover,
	LspLocation,
	LspLocationLink,
	LspMarkedString,
	LspPosition,
	LspSymbolInformation,
	LspWorkspaceSymbol,
	ProgressState,
	PublishDiagnosticsParams,
	RustAnalyzerCommand,
	RustProjectDiscovery,
	SessionState,
} from "./types";

interface ClientCallbacks {
	onDiagnostics: (params: PublishDiagnosticsParams) => void;
	onLogMessage?: (message: string) => void;
	onProgress?: (progress: ProgressState) => void;
	onStateChange?: (state: SessionState, error?: string) => void;
}

interface ServerCapabilities {
	definitionProvider?: boolean | Record<string, unknown>;
	hoverProvider?: boolean | Record<string, unknown>;
	referencesProvider?: boolean | Record<string, unknown>;
	documentSymbolProvider?: boolean | Record<string, unknown>;
	workspaceSymbolProvider?: boolean | Record<string, unknown>;
}

interface InitializeResult {
	capabilities?: ServerCapabilities;
	serverInfo?: {
		name?: string;
		version?: string;
	};
}

export class RustAnalyzerClient {
	private readonly project: RustProjectDiscovery;
	private readonly command: RustAnalyzerCommand;
	private readonly callbacks: ClientCallbacks;
	private protocol?: StdioJsonRpcClient;
	private startPromise?: Promise<void>;
	private state: SessionState = "inactive";
	private lastError?: string;
	private restartFailures = 0;
	private nextStartAllowedAt = 0;
	private intentionalShutdown = false;
	private capabilities?: ServerCapabilities;
	private readonly dynamicRegistrations = new Map<string, unknown>();

	constructor(project: RustProjectDiscovery, command: RustAnalyzerCommand, callbacks: ClientCallbacks) {
		this.project = project;
		this.command = command;
		this.callbacks = callbacks;
	}

	get currentState(): SessionState {
		return this.state;
	}

	get projectRoot(): string {
		return this.project.rootPath;
	}

	get serverCapabilities(): ServerCapabilities | undefined {
		return this.capabilities;
	}

	async ensureReady(signal?: AbortSignal): Promise<void> {
		if (this.state === "ready" && this.protocol && !this.protocol.isClosed) return;
		if (this.startPromise) return await this.startPromise;
		if (Date.now() < this.nextStartAllowedAt && this.lastError) {
			throw new Error(this.lastError);
		}
		this.startPromise = this.start(signal);
		try {
			await this.startPromise;
		} finally {
			this.startPromise = undefined;
		}
	}

	async shutdown(): Promise<void> {
		this.intentionalShutdown = true;
		this.setState("inactive");
		if (this.protocol) {
			try {
				await this.protocol.request("shutdown", undefined);
			} catch {
				// Ignore shutdown errors.
			}
			try {
				await this.protocol.notify("exit");
			} catch {
				// Ignore exit errors.
			}
			await this.protocol.shutdown();
			this.protocol = undefined;
		}
	}

	async notify(method: string, params?: unknown): Promise<void> {
		await this.ensureReady();
		await this.protocol!.notify(method, params);
	}

	async workspaceSymbols(query: string, signal?: AbortSignal): Promise<(LspSymbolInformation | LspWorkspaceSymbol)[]> {
		await this.ensureReady(signal);
		return ((await this.protocol!.request("workspace/symbol", { query }, signal)) as
			| (LspSymbolInformation | LspWorkspaceSymbol)[]
			| null) ?? [];
	}

	async documentSymbols(uri: string, signal?: AbortSignal): Promise<LspDocumentSymbol[] | LspSymbolInformation[]> {
		await this.ensureReady(signal);
		return ((await this.protocol!.request("textDocument/documentSymbol", {
			textDocument: { uri },
		}, signal)) as LspDocumentSymbol[] | LspSymbolInformation[] | null) ?? [];
	}

	async hover(uri: string, position: LspPosition, signal?: AbortSignal): Promise<LspHover | null> {
		await this.ensureReady(signal);
		return ((await this.protocol!.request("textDocument/hover", {
			textDocument: { uri },
			position,
		}, signal)) as LspHover | null) ?? null;
	}

	async definition(uri: string, position: LspPosition, signal?: AbortSignal): Promise<LspLocation | LspLocation[] | LspLocationLink[] | null> {
		await this.ensureReady(signal);
		return ((await this.protocol!.request("textDocument/definition", {
			textDocument: { uri },
			position,
		}, signal)) as LspLocation | LspLocation[] | LspLocationLink[] | null) ?? null;
	}

	async references(
		uri: string,
		position: LspPosition,
		includeDeclaration: boolean,
		signal?: AbortSignal,
	): Promise<LspLocation[]> {
		await this.ensureReady(signal);
		return ((await this.protocol!.request("textDocument/references", {
			textDocument: { uri },
			position,
			context: { includeDeclaration },
		}, signal)) as LspLocation[] | null) ?? [];
	}

	private async start(signal?: AbortSignal): Promise<void> {
		this.intentionalShutdown = false;
		this.setState("starting");
		const protocol = new StdioJsonRpcClient({
			command: this.command.command,
			args: this.command.args,
			cwd: this.project.rootPath,
			onNotification: async (method, params) => {
				switch (method) {
					case "textDocument/publishDiagnostics":
						this.callbacks.onDiagnostics(params as PublishDiagnosticsParams);
						break;
					case "window/logMessage": {
						const payload = params as { message?: string } | undefined;
						if (payload?.message) this.callbacks.onLogMessage?.(payload.message);
						break;
					}
					case "telemetry/event":
					case "$/logTrace":
						break;
					case "$/progress": {
						const payload = params as { token?: string | number; value?: Record<string, unknown> } | undefined;
						if (payload?.token !== undefined && payload.value) {
							const value = payload.value;
							this.callbacks.onProgress?.({
								token: String(payload.token),
								title: typeof value.title === "string" ? value.title : undefined,
								message: typeof value.message === "string" ? value.message : undefined,
								percentage: typeof value.percentage === "number" ? value.percentage : undefined,
							});
						}
						break;
					}
					default:
						break;
				}
			},
			onRequest: async (method, params) => {
				switch (method) {
					case "workspace/configuration": {
						const items = (params as { items?: Array<{ section?: string }> } | undefined)?.items ?? [];
						return items.map((item) => (item?.section?.startsWith("rust-analyzer") ? {} : null));
					}
					case "client/registerCapability": {
						const registrations = (params as { registrations?: Array<{ id: string } & Record<string, unknown>> } | undefined)
							?.registrations ?? [];
						for (const registration of registrations) {
							this.dynamicRegistrations.set(registration.id, registration);
						}
						return null;
					}
					case "client/unregisterCapability": {
						const unregisterations = (params as { unregisterations?: Array<{ id: string }> } | undefined)?.unregisterations ?? [];
						for (const registration of unregisterations) {
							this.dynamicRegistrations.delete(registration.id);
						}
						return null;
					}
					case "window/workDoneProgress/create":
						return null;
					case "workspace/applyEdit":
						return {
							applied: false,
							failureReason: "workspace/applyEdit is unsupported in this extension",
						};
					default:
						this.callbacks.onLogMessage?.(`Unsupported rust-analyzer client request: ${method}`);
						return null;
				}
			},
			onExit: (_code, _signal, stderr) => {
				this.protocol = undefined;
				this.capabilities = undefined;
				if (this.intentionalShutdown) {
					this.setState("inactive");
					return;
				}
				this.restartFailures += 1;
				const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.restartFailures));
				this.nextStartAllowedAt = Date.now() + backoffMs;
				this.lastError = `rust-analyzer exited unexpectedly. Backoff ${backoffMs}ms.${stderr ? ` stderr: ${stderr}` : ""}`;
				this.setState("broken", this.lastError);
			},
			onStderr: (chunk) => {
				if (chunk.trim()) this.callbacks.onLogMessage?.(chunk.trim());
			},
		});

		if (signal?.aborted) throw new Error("rust-analyzer start aborted");
		this.protocol = protocol;

		try {
			const initializeResult = (await protocol.request("initialize", {
				processId: process.pid,
				rootUri: this.project.rootUri,
				workspaceFolders: [
					{
						uri: this.project.rootUri,
						name: this.project.rootPath.split(/[\\/]/).pop() || this.project.rootPath,
					},
				],
				capabilities: {
					workspace: {
						applyEdit: true,
						workspaceFolders: true,
						configuration: true,
						symbol: {},
					},
					textDocument: {
						synchronization: {
							dynamicRegistration: false,
							willSave: false,
							didSave: false,
							willSaveWaitUntil: false,
						},
						definition: {
							linkSupport: true,
						},
						hover: {
							contentFormat: ["markdown", "plaintext"],
						},
						references: {},
						documentSymbol: {
							hierarchicalDocumentSymbolSupport: true,
						},
						publishDiagnostics: {
							relatedInformation: true,
							versionSupport: true,
							codeDescriptionSupport: true,
							dataSupport: true,
						},
					},
					window: {
						workDoneProgress: true,
					},
				},
				clientInfo: {
					name: "pi lsp-rust-analyzer",
				},
			}, signal)) as InitializeResult;

			this.capabilities = initializeResult.capabilities;
			await protocol.notify("initialized", {});
			await protocol.notify("workspace/didChangeConfiguration", { settings: {} });
			this.restartFailures = 0;
			this.nextStartAllowedAt = 0;
			this.lastError = undefined;
			this.setState("ready");
		} catch (error) {
			this.protocol = undefined;
			await protocol.shutdown();
			const message = error instanceof Error ? error.message : String(error);
			this.lastError = `Failed to initialize rust-analyzer (${this.command.displayCommand}). ${message}`;
			this.setState("error", this.lastError);
			throw new Error(this.lastError);
		}
	}

	private setState(state: SessionState, error?: string): void {
		this.state = state;
		if (error) this.lastError = error;
		this.callbacks.onStateChange?.(state, error);
	}
}

export function normalizeHoverContents(contents: LspHover["contents"]): string {
	if (Array.isArray(contents)) {
		return contents.map((item) => normalizeMarkedString(item)).filter(Boolean).join("\n\n");
	}
	return normalizeMarkedString(contents);
}

function normalizeMarkedString(value: LspMarkedString | { kind: string; value: string }): string {
	if (typeof value === "string") return value;
	if ("kind" in value) return value.value;
	if (value.language) {
		return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
	}
	return value.value;
}

export function supportsDiagnostics(_diagnostics: LspDiagnostic[]): boolean {
	return true;
}
