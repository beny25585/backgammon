import type { GameMessage } from "../types/game";

export type MessageHandler = (data: unknown) => void;

export class GameSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  constructor(url: string = "ws://localhost:8080") {
    this.url = url;
  }

  connect(roomId: string, token?: string): Promise<void> {
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
          this.attemptReconnect(roomId);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(roomId: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(
          `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
        );
        this.connect(roomId).catch(console.error);
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
