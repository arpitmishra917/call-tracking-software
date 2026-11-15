import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export interface AriEvent {
  type: string;
  application: string;
  timestamp: string;
  [key: string]: any;
}

export interface StasisStartEvent extends AriEvent {
  type: 'StasisStart';
  channel: {
    id: string;
    name: string;
    state: string;
    caller?: { number?: string; name?: string };
    connected?: { number?: string; name?: string };
  };
  args: string[];
}

export interface ChannelStateChangeEvent extends AriEvent {
  type: 'ChannelStateChange';
  channel: {
    id: string;
    name: string;
    state: string;
  };
}

export interface ChannelDestroyedEvent extends AriEvent {
  type: 'ChannelDestroyed';
  channel: {
    id: string;
    name: string;
    state: string;
  };
  cause: number;
  cause_txt: string;
}

export interface RecordingStartedEvent extends AriEvent {
  type: 'RecordingStarted';
  recording: {
    name: string;
    format: string;
    state: string;
    target_uri: string;
  };
}

export interface RecordingFinishedEvent extends AriEvent {
  type: 'RecordingFinished';
  recording: {
    name: string;
    format: string;
    state: string;
    target_uri: string;
    duration?: number;
  };
}

export interface PlaybackFinishedEvent extends AriEvent {
  type: 'PlaybackFinished';
  playback: {
    id: string;
    media_uri: string;
    target_uri: string;
    state: string;
  };
}

export class AriWebSocketError extends Error {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'AriWebSocketError';
  }
}

interface PendingWaiter<T = any> {
  id: string;
  eventType: string;
  predicate: (event: T) => boolean;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class AriWebSocketClientService implements OnModuleDestroy {
  private readonly logger = new Logger(AriWebSocketClientService.name);
  private ws: any = null;
  private connected = false;
  private connectingPromise: Promise<void> | null = null;
  private readonly waiters: PendingWaiter[] = [];
  private readonly eventListeners = new Map<string, Set<(event: AriEvent) => void>>();
  private readonly processedEventSignatures = new Set<string>();
  private signaturePruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically prune event signatures older than 60s
    this.signaturePruneTimer = setInterval(() => {
      if (this.processedEventSignatures.size > 1000) {
        this.processedEventSignatures.clear();
      }
    }, 60000);
  }

  public onModuleDestroy(): void {
    if (this.signaturePruneTimer) {
      clearInterval(this.signaturePruneTimer);
      this.signaturePruneTimer = null;
    }
    this.disconnect().catch(() => {});
  }

  /**
   * Resolves the WebSocket URL for ARI events.
   */
  public getWebSocketUrl(appName = 'callflow-qa'): string {
    const rawUrl = process.env.TELEPHONY_QA_ARI_URL || process.env.TELEPHONY_QA_SERVER_URL || 'http://127.0.0.1:8088';
    const baseUrl = rawUrl.trim().replace(/\/+$/, '');
    const wsBase = baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');

    const username = (process.env.TELEPHONY_QA_ARI_USERNAME || 'callflow_qa').trim();
    const password = (process.env.TELEPHONY_QA_ARI_PASSWORD || '').trim();

    const encodedApp = encodeURIComponent(appName);
    const encodedUser = encodeURIComponent(username);
    const encodedPass = encodeURIComponent(password);

    return `${wsBase}/ari/events?app=${encodedApp}&api_key=${encodedUser}:${encodedPass}`;
  }

  /**
   * Sanitizes strings to prevent ARI passwords or tokens from leaking in logs.
   */
  public sanitize(text: string): string {
    if (!text) return '';
    let sanitized = text;

    const pass = (process.env.TELEPHONY_QA_ARI_PASSWORD || '').trim();
    if (pass && pass.length > 2) {
      sanitized = sanitized.split(pass).join('[REDACTED]');
      const encodedPass = encodeURIComponent(pass);
      sanitized = sanitized.split(encodedPass).join('[REDACTED]');
    }

    const user = (process.env.TELEPHONY_QA_ARI_USERNAME || '').trim();
    if (user && user.length > 2) {
      sanitized = sanitized.split(user).join('[REDACTED_USER]');
    }

    return sanitized;
  }

  /**
   * Returns whether the WebSocket is currently open and healthy.
   */
  public isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === 1; // 1 = OPEN
  }

  /**
   * Connects to the Asterisk ARI WebSocket endpoint using native Node.js WebSocket.
   */
  public async connect(appName = 'callflow-qa', timeoutMs = 5000): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = new Promise<void>((resolve, reject) => {
      const url = this.getWebSocketUrl(appName);
      const safeUrl = this.sanitize(url);
      this.logger.log(`Connecting to ARI WebSocket endpoint: ${safeUrl}`);

      let connectionTimer: NodeJS.Timeout | null = setTimeout(() => {
        connectionTimer = null;
        this.cleanupSocket();
        const err = new AriWebSocketError(`ARI WebSocket connection timed out after ${timeoutMs}ms`);
        this.logger.error(err.message);
        reject(err);
      }, timeoutMs);

      try {
        // Use native globalThis.WebSocket in Node 24+
        const WebSocketClass = (globalThis as any).WebSocket;
        if (!WebSocketClass) {
          throw new AriWebSocketError('globalThis.WebSocket is not available in current runtime');
        }

        const ws = new WebSocketClass(url);
        this.ws = ws;

        ws.onopen = () => {
          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
          }
          this.connected = true;
          this.connectingPromise = null;
          this.logger.log(`ARI WebSocket connection established for app "${appName}"`);
          resolve();
        };

        ws.onmessage = (event: any) => {
          this.handleRawMessage(event.data);
        };

        ws.onerror = (err: any) => {
          const msg = this.sanitize(`ARI WebSocket error: ${err?.message || 'unknown error'}`);
          this.logger.warn(msg);
          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
            this.cleanupSocket();
            this.connectingPromise = null;
            reject(new AriWebSocketError(msg, err));
          }
        };

        ws.onclose = (event: any) => {
          const wasConnected = this.connected;
          this.cleanupSocket();
          this.connectingPromise = null;

          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
            reject(new AriWebSocketError(`ARI WebSocket closed before opening (code ${event?.code || 1006})`));
          } else if (wasConnected) {
            this.logger.warn(`ARI WebSocket closed unexpectedly (code ${event?.code || 1006}, reason: ${event?.reason || 'none'})`);
            // Fail closed: abort any pending waiters
            this.rejectAllWaiters(new AriWebSocketError('ARI WebSocket stream disconnected during active wait'));
          }
        };
      } catch (err: any) {
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
        this.cleanupSocket();
        this.connectingPromise = null;
        reject(new AriWebSocketError(this.sanitize(err.message || 'Failed to instantiate WebSocket'), err));
      }
    });

    return this.connectingPromise;
  }

  /**
   * Gracefully closes the active WebSocket connection.
   */
  public async disconnect(): Promise<void> {
    this.cleanupSocket();
    this.rejectAllWaiters(new AriWebSocketError('ARI WebSocket disconnected by client'));
  }

  private cleanupSocket(): void {
    this.connected = false;
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (typeof this.ws.close === 'function') {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }

  public cancelPendingWaiters(error?: Error): void {
    const err = error || new AriWebSocketError('Waiters cancelled by client');
    this.rejectAllWaiters(err);
  }

  public clearAllEventListeners(): void {
    this.eventListeners.clear();
  }

  private rejectAllWaiters(error: Error): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  /**
   * Registers a Promise-based event waiter BEFORE issuing REST actions.
   * Fails closed if event is not delivered within timeoutMs.
   */
  public waitForEvent<T extends AriEvent = AriEvent>(
    eventType: string,
    predicate: (event: T) => boolean,
    timeoutMs = 15000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiterId = Math.random().toString(36).substring(2, 9);
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.id === waiterId);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(new AriWebSocketError(`Timed out waiting for ARI event "${eventType}" after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push({
        id: waiterId,
        eventType,
        predicate: predicate as any,
        resolve: resolve as any,
        reject,
        timer,
      });
    });
  }

  /**
   * Registers a listener for an ARI event type.
   */
  public on(eventType: string, handler: (event: AriEvent) => void): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    const set = this.eventListeners.get(eventType)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Ingests a raw WebSocket text message and dispatches parsed event.
   */
  public handleRawMessage(rawData: any): void {
    if (!rawData) return;
    let event: AriEvent;

    try {
      const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      event = JSON.parse(text);
    } catch (parseErr: any) {
      this.logger.warn(`Failed to parse ARI WebSocket frame as JSON: ${parseErr.message}`);
      return;
    }

    if (!event || typeof event.type !== 'string') {
      return;
    }

    // Duplicate event protection: build signature
    const sig = `${event.type}:${event.timestamp}:${event.channel?.id || event.recording?.name || event.playback?.id || ''}`;
    if (sig.length > 5 && this.processedEventSignatures.has(sig)) {
      this.logger.debug(`Ignoring duplicate ARI event signature: ${sig}`);
      return;
    }
    this.processedEventSignatures.add(sig);

    this.logger.debug(`ARI Event received: ${event.type}`);

    // 1. Check pending waiters (LIFO check to prioritize specific active waits)
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter.eventType === event.type || waiter.eventType === '*') {
        try {
          if (waiter.predicate(event as any)) {
            clearTimeout(waiter.timer);
            this.waiters.splice(i, 1);
            waiter.resolve(event);
          }
        } catch (predErr: any) {
          this.logger.warn(`Predicate threw during ARI event evaluation: ${predErr.message}`);
        }
      }
    }

    // 2. Dispatch to permanent event listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err: any) {
          this.logger.error(`Error in ARI event listener for ${event.type}: ${err.message}`, err.stack);
        }
      }
    }
  }
}
