import type { GameMessage } from "../types/game";

export type MessageHandler = (data: unknown) => void;

export class GameSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private currentToken: string | null = null;
  private currentRoomId: string | null = null;

  constructor(url: string = '') {
    this.url = url;
  }

  connect(roomId: string, token?: string): Promise<void> {
    this.currentRoomId = roomId;
    this.currentToken = token || null;

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
          console.log("Connected to game server");
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: GameMessage = JSON.parse(event.data);
            this.emit(message.type, message.payload);
          } catch (error) {
            console.error("Failed to parse message:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("Disconnected from server");
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (!this.currentRoomId) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(
          `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
        );
        this.connect(this.currentRoomId!, this.currentToken || undefined).catch(console.error);
      }, this.reconnectDelay);
    }
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.error("WebSocket is not connected");
    }
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
