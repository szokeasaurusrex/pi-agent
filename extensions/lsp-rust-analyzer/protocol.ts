import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
	JsonRpcErrorMessage,
	JsonRpcMessage,
	JsonRpcNotificationMessage,
	JsonRpcRequestMessage,
	JsonRpcSuccessMessage,
} from "./types";

interface ProtocolOptions {
	command: string;
	args?: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	onNotification?: (method: string, params: unknown) => void | Promise<void>;
	onRequest?: (method: string, params: unknown) => unknown | Promise<unknown>;
	onExit?: (code: number | null, signal: NodeJS.Signals | null, stderr: string) => void;
	onStderr?: (chunk: string) => void;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	method: string;
	signal?: AbortSignal;
	onAbort?: () => void;
}

const JSON_RPC_VERSION = "2.0";
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "utf8");
const STDERR_LIMIT = 32_768;

function createAbortError(method: string): Error {
	const error = new Error(`LSP request aborted: ${method}`);
	error.name = "AbortError";
	return error;
}

function findHeaderEnd(buffer: Buffer): number {
	return buffer.indexOf(HEADER_SEPARATOR);
}

function formatContentLength(length: number): string {
	return `Content-Length: ${length}\r\n\r\n`;
}

export class StdioJsonRpcClient {
	private readonly process: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly onNotification?: ProtocolOptions["onNotification"];
	private readonly onRequest?: ProtocolOptions["onRequest"];
	private readonly onExit?: ProtocolOptions["onExit"];
	private readonly onStderr?: ProtocolOptions["onStderr"];
	private nextId = 1;
	private buffer = Buffer.alloc(0);
	private closed = false;
	private stderrBuffer = "";

	constructor(options: ProtocolOptions) {
		this.onNotification = options.onNotification;
		this.onRequest = options.onRequest;
		this.onExit = options.onExit;
		this.onStderr = options.onStderr;
		this.process = spawn(options.command, options.args ?? [], {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.stdout.on("data", (chunk: Buffer) => {
			this.buffer = Buffer.concat([this.buffer, chunk]);
			this.drainBuffer();
		});

		this.process.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-STDERR_LIMIT);
			this.onStderr?.(text);
		});

		this.process.on("error", (error) => {
			this.failAllPending(error);
		});

		this.process.on("exit", (code, signal) => {
			this.closed = true;
			const error = new Error(
				`LSP process exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}`,
			);
			this.failAllPending(error);
			this.onExit?.(code, signal, this.stderrBuffer.trim());
		});
	}

	get isClosed(): boolean {
		return this.closed;
	}

	get stderr(): string {
		return this.stderrBuffer.trim();
	}

	async request<T = unknown>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
		if (this.closed) {
			throw new Error(`Cannot send LSP request after shutdown: ${method}`);
		}

		const id = this.nextId++;
		const message: JsonRpcRequestMessage = {
			jsonrpc: JSON_RPC_VERSION,
			id,
			method,
			params,
		};

		return await new Promise<T>((resolve, reject) => {
			const pending: PendingRequest = {
				method,
				resolve: (value) => resolve(value as T),
				reject,
				signal,
			};

			if (signal) {
				if (signal.aborted) {
					reject(createAbortError(method));
					return;
				}
				pending.onAbort = () => {
					this.pending.delete(id);
					void this.notify("$/cancelRequest", { id });
					reject(createAbortError(method));
				};
				signal.addEventListener("abort", pending.onAbort, { once: true });
			}

			this.pending.set(id, pending);
			try {
				this.send(message);
			} catch (error) {
				this.pending.delete(id);
				if (pending.onAbort && signal) signal.removeEventListener("abort", pending.onAbort);
				reject(error);
			}
		});
	}

	async notify(method: string, params?: unknown): Promise<void> {
		if (this.closed) return;
		const message: JsonRpcNotificationMessage = {
			jsonrpc: JSON_RPC_VERSION,
			method,
			params,
		};
		this.send(message);
	}

	async shutdown(killSignal: NodeJS.Signals = "SIGTERM"): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.process.stdin.end();
		if (!this.process.killed) {
			this.process.kill(killSignal);
		}
	}

	private send(message: JsonRpcMessage): void {
		const payload = Buffer.from(JSON.stringify(message), "utf8");
		const header = Buffer.from(formatContentLength(payload.byteLength), "utf8");
		this.process.stdin.write(Buffer.concat([header, payload]));
	}

	private drainBuffer(): void {
		while (true) {
			const headerEnd = findHeaderEnd(this.buffer);
			if (headerEnd === -1) return;

			const headerBlock = this.buffer.slice(0, headerEnd).toString("utf8");
			const contentLengthMatch = headerBlock.match(/Content-Length:\s*(\d+)/i);
			if (!contentLengthMatch) {
				throw new Error(`Invalid JSON-RPC header without Content-Length: ${headerBlock}`);
			}

			const contentLength = Number.parseInt(contentLengthMatch[1]!, 10);
			const messageStart = headerEnd + HEADER_SEPARATOR.length;
			const messageEnd = messageStart + contentLength;
			if (this.buffer.byteLength < messageEnd) return;

			const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
			this.buffer = this.buffer.slice(messageEnd);

			const message = JSON.parse(body) as JsonRpcMessage;
			void this.handleMessage(message);
		}
	}

	private async handleMessage(message: JsonRpcMessage): Promise<void> {
		if ("method" in message && "id" in message) {
			await this.handleRequest(message);
			return;
		}

		if ("method" in message) {
			await this.onNotification?.(message.method, message.params);
			return;
		}

		if (!("id" in message)) return;
		const pending = this.pending.get(Number(message.id));
		if (!pending) return;
		this.pending.delete(Number(message.id));
		if (pending.onAbort && pending.signal) {
			pending.signal.removeEventListener("abort", pending.onAbort);
		}

		if ("error" in message) {
			const errorMessage = `${pending.method}: ${message.error.message}`;
			const error = new Error(errorMessage);
			(error as Error & { code?: number; data?: unknown }).code = message.error.code;
			(error as Error & { code?: number; data?: unknown }).data = message.error.data;
			pending.reject(error);
			return;
		}

		pending.resolve((message as JsonRpcSuccessMessage).result);
	}

	private async handleRequest(message: JsonRpcRequestMessage): Promise<void> {
		if (!this.onRequest) {
			this.send({
				jsonrpc: JSON_RPC_VERSION,
				id: message.id,
				error: {
					code: -32601,
					message: `Unsupported client request: ${message.method}`,
				},
			});
			return;
		}

		try {
			const result = await this.onRequest(message.method, message.params);
			this.send({
				jsonrpc: JSON_RPC_VERSION,
				id: message.id,
				result,
			});
		} catch (error) {
			this.send({
				jsonrpc: JSON_RPC_VERSION,
				id: message.id,
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	private failAllPending(error: unknown): void {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			if (pending.onAbort && pending.signal) {
				pending.signal.removeEventListener("abort", pending.onAbort);
			}
			pending.reject(error);
		}
	}
}
