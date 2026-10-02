import type { GameMessage } from "../types/game";
import { clientLogger } from "./logger";
import { handleSessionExpired } from "./auth";

export type MessageHandler = (data: unknown) => void;

interface PendingSocketTrace {
  action: string;
  sentAtPerf: number;
  sentAtEpoch: number;
  bufferedBefore: number;
  bufferedAfter: number;
}

function getCloseReason(code: number): string {
  switch (code) {
    case 4001:
      return "Authentication failed (bad or expired token)";
    case 4003:
      return "You are not a player in this room";
    case 4004:
      return "Room not found";
    case 1000:
      return "Normal closure";
    case 1001:
      return "Server going away";
    case 1006:
      return "Connection lost (abnormal closure)";
    case 1011:
      return "Server error";
    default:
      return `Connection closed with code ${code}`;
  }
}

export class GameSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectDelay = 2000;
  private currentToken: string | null = null;
  private currentRoomId: string | null = null;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private traceSendBufferDrain(
    ws: WebSocket,
    action: string,
    sentAtPerf: number,
    bufferedAfterSend: number,
  ): void {
    let slowEmitted = false;
    const check = () => {
      const elapsedMs = Math.round(performance.now() - sentAtPerf);

      const bufferedAmount = ws.bufferedAmount;

      if (bufferedAmount === 0) {
        clientLogger.info("WS_SEND_BUFFER_DRAIN", {
          action,
          drainMs: elapsedMs,
          bufferedAfterSend,
          readyState: ws.readyState,
        });

        return;
      }

      if (elapsedMs >= 5000) {
        clientLogger.warn("WS_SEND_BUFFER_STUCK", {
          action,
          elapsedMs,
          bufferedAmount,
          bufferedAfterSend,
          readyState: ws.readyState,
        });

        return;
      }

      if (elapsedMs >= 500 && !slowEmitted) {
        slowEmitted = true;
        clientLogger.warn("WS_SEND_BUFFER_SLOW", {
          action,
          elapsedMs,
          bufferedAmount,
          bufferedAfterSend,
          readyState: ws.readyState,
        });
      }

      setTimeout(check, 10);
    };

    setTimeout(check, 0);
  }

  constructor(url: string = "") {
    this.url = url || "/backgammon";
  }

  private pendingSocketTraces: PendingSocketTrace[] = [];

  connect(roomId: string, token?: string): Promise<void> {
    this.cancelReconnect();
    if (this.currentRoomId !== roomId) this.reconnectAttempts = 0;
    this.currentRoomId = roomId;
    this.currentToken = token || null;
    this.intentionalClose = false;

    // Kill old connection to prevent orphaned sockets from triggering reconnect
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = token
          ? `${this.url}/ws/game/${roomId}/?token=${token}`
          : `${this.url}/ws/game/${roomId}/`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          if (this.ws?.readyState !== WebSocket.OPEN) return;
          clientLogger.info("WebSocket connected", { roomId });
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          const rawReceivedAtPerf = performance.now();
          const rawReceivedAtEpoch = Date.now();

          try {
            const parseStarted = performance.now();

            const message: GameMessage = JSON.parse(event.data);

            const parseMs = Math.round(performance.now() - parseStarted);

            const record = message as unknown as Record<string, unknown>;

            const action =
              typeof record.action === "string" ? record.action : undefined;

            const payload =
              record.payload !== null && typeof record.payload === "object"
                ? (record.payload as Record<string, unknown>)
                : undefined;

            const version =
              typeof payload?.version === "number"
                ? payload.version
                : undefined;

            let rawRoundTripMs: number | null = null;
            let bufferedAfterSend: number | null = null;
            let sentAtEpoch: number | null = null;

            /*
             * For state_update replies, correlate the server broadcast with the
             * oldest local command of the same action.
             *
             * This is diagnostic instrumentation only.
             */
            if (message.type === "state_update" && action) {
              const traceIndex = this.pendingSocketTraces.findIndex(
                (trace) => trace.action === action,
              );

              if (traceIndex !== -1) {
                const trace = this.pendingSocketTraces.splice(traceIndex, 1)[0];

                rawRoundTripMs = Math.round(
                  rawReceivedAtPerf - trace.sentAtPerf,
                );

                bufferedAfterSend = trace.bufferedAfter;
                sentAtEpoch = trace.sentAtEpoch;
              }
            }

            clientLogger.info("WS_RAW_MESSAGE_TIMING", {
              messageType: message.type,
              action,
              version,
              parseMs,
              rawRoundTripMs,
              bufferedAfterSend,
              sentAtEpoch,
              rawReceivedAtEpoch,
              bytes:
                typeof event.data === "string" ? event.data.length : undefined,
            });

            const dispatchStarted = performance.now();

            this.emit(message.type, message);

            const dispatchMs = Math.round(performance.now() - dispatchStarted);

            if (dispatchMs >= 50) {
              clientLogger.warn("WS_HANDLER_SLOW", {
                messageType: message.type,
                action,
                version,
                dispatchMs,
              });
            }
          } catch (error) {
            console.error("Failed to parse message:", error);

            clientLogger.error("Failed to parse WS message", {
              raw: event.data,
              error: String(error),
              rawReceivedAtEpoch,
            });
          }
        };

        this.ws.onerror = () => {
          clientLogger.error("WebSocket connection failed", { roomId });
        };

        this.ws.onclose = (event: CloseEvent) => {
          if (this.intentionalClose || event.code === 1000) {
            if (!this.intentionalClose) {
              clientLogger.info("WebSocket disconnected", { roomId });
            }
            return;
          }
          const reason = event.reason || getCloseReason(event.code);
          clientLogger.error("WebSocket closed", {
            roomId,
            code: event.code,
            reason,
            wasClean: event.wasClean,
          });
          reject(new Error(reason));
          if (event.code === 4001) {
            // Expired/invalid token — no point reconnecting; force a fresh login.
            handleSessionExpired();
            return;
          }
          if (event.code !== 4003 && event.code !== 4004)
            this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (!this.currentRoomId || this.intentionalClose) return;
    this.cancelReconnect();
    {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(
        () => {
          this.reconnectTimer = null;
          if (this.intentionalClose || !this.currentRoomId) return;
          clientLogger.info("Attempting to reconnect", {
            attempt: this.reconnectAttempts,
          });
          this.connect(
            this.currentRoomId,
            this.currentToken || undefined,
          ).catch((error) => {
            clientLogger.error("Reconnect attempt failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        },
        Math.min(
          this.reconnectDelay * 2 ** Math.min(this.reconnectAttempts - 1, 4),
          30000,
        ),
      );
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  send(type: string, payload: unknown): boolean {
    const ws = this.ws;

    if (ws?.readyState !== WebSocket.OPEN) {
      clientLogger.warn(
        "WebSocket send skipped because socket is not connected",
        { type },
      );

      return false;
    }

    const action =
      type === "state_update" &&
      payload !== null &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).action === "string"
        ? String((payload as Record<string, unknown>).action)
        : "";

    const serialized = JSON.stringify({
      type,
      payload,
    });

    const sentAtPerf = performance.now();
    const sentAtEpoch = Date.now();
    const bufferedBefore = ws.bufferedAmount;

    ws.send(serialized);

    const bufferedAfter = ws.bufferedAmount;

    if (action) {
      this.traceSendBufferDrain(ws, action, sentAtPerf, bufferedAfter);
    }

    if (type === "state_update" && action) {
      this.pendingSocketTraces.push({
        action,
        sentAtPerf,
        sentAtEpoch,
        bufferedBefore,
        bufferedAfter,
      });

      // Diagnostic only. Prevent an abandoned/rejected command from leaving
      // unbounded trace history.
      if (this.pendingSocketTraces.length > 20) {
        this.pendingSocketTraces.shift();
      }
    }

    clientLogger.info("WS_SEND_TIMING", {
      type,
      action: action || undefined,
      bytes: serialized.length,
      bufferedBefore,
      bufferedAfter,
    });

    /*
     * A zero-delay timer tells us whether something immediately after ws.send()
     * blocks the browser main thread.
     *
     * For example:
     * ws.send()
     * → React setState
     * → expensive render/layout/animation
     * → browser cannot process incoming WebSocket frame for 2000ms
     */
    const eventLoopProbeStarted = performance.now();

    setTimeout(() => {
      const eventLoopDelayMs = Math.round(
        performance.now() - eventLoopProbeStarted,
      );

      if (eventLoopDelayMs >= 50) {
        clientLogger.warn("CLIENT_MAIN_THREAD_DELAY_AFTER_SEND", {
          type,
          action: action || undefined,
          eventLoopDelayMs,
          bufferedAmount: this.ws?.bufferedAmount ?? null,
        });
      }
    }, 0);

    return true;
  }
  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, payload: unknown): void {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    this.currentRoomId = null;
    this.currentToken = null;
    this.reconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

let socketService: GameSocketService | null = null;

export function getSocketService(url?: string): GameSocketService {
  if (!socketService) {
    socketService = new GameSocketService(url);
  }
  return socketService;
}

export function resetSocketService(): void {
  socketService?.disconnect();
  socketService = null;
}
