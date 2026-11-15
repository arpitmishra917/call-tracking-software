import { Injectable, Logger } from '@nestjs/common';

export interface AsteriskSystemInfo {
  version: string;
  entityId?: string;
  os?: string;
  kernel?: string;
  startupTime?: string;
  lastReloadTime?: string;
}

export interface AsteriskEndpoint {
  technology: string;
  resource: string;
  state: string;
  channelIds: string[];
}

export interface AsteriskChannel {
  id: string;
  name: string;
  state: string;
  callerNumber?: string;
  connectedNumber?: string;
  creationTime?: string;
}

export interface AsteriskStoredRecording {
  name: string;
  format: string;
  state: string;
  duration?: number;
}

export interface AsteriskLiveRecording {
  name: string;
  format: string;
  state: string;
  duration?: number;
  talkingDuration?: number;
  silenceDuration?: number;
}

export interface AsteriskPlayback {
  id: string;
  mediaUri: string;
  targetUri?: string;
  state: string;
}

export interface AriConnectivityResult {
  connected: boolean;
  latencyMs?: number;
  version?: string;
  error?: string;
}

export class AsteriskAriError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isTimeout: boolean = false,
    public readonly isAuthError: boolean = false,
  ) {
    super(message);
    this.name = 'AsteriskAriError';
  }
}

@Injectable()
export class AsteriskAriClientService {
  private readonly logger = new Logger(AsteriskAriClientService.name);
  private readonly defaultTimeoutMs = 5000;

  /**
   * Resolves the configured ARI Base URL.
   * Defaults strictly to loopback http://127.0.0.1:8088.
   */
  public getBaseUrl(): string {
    const raw = process.env.TELEPHONY_QA_ARI_URL || process.env.TELEPHONY_QA_SERVER_URL;
    if (!raw || !raw.trim()) {
      return 'http://127.0.0.1:8088';
    }
    const trimmed = raw.trim().replace(/\/+$/, '');
    return trimmed;
  }

  /**
   * Resolves ARI username from environment.
   */
  public getUsername(): string {
    return (process.env.TELEPHONY_QA_ARI_USERNAME || '').trim();
  }

  /**
   * Resolves ARI password from environment.
   */
  public getPassword(): string {
    return (process.env.TELEPHONY_QA_ARI_PASSWORD || '').trim();
  }

  /**
   * Generates standard HTTP Basic Authentication header.
   */
  private getAuthHeader(): string {
    const user = this.getUsername();
    const pass = this.getPassword();
    const token = Buffer.from(`${user}:${pass}`).toString('base64');
    return `Basic ${token}`;
  }

  /**
   * Sanitizes strings to ensure credentials, tokens, and Authorization headers
   * are never emitted in logs or error messages.
   */
  public sanitize(text: string): string {
    if (!text) return '';
    let sanitized = text;

    const pass = this.getPassword();
    if (pass && pass.length > 2) {
      sanitized = sanitized.split(pass).join('[REDACTED]');
    }

    const user = this.getUsername();
    if (user && user.length > 2) {
      sanitized = sanitized.split(user).join('[REDACTED_USER]');
    }

    // Redact Basic Authorization headers and base64 strings
    sanitized = sanitized.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED_AUTH]');
    sanitized = sanitized.replace(/(Authorization:\s*)[^\r\n]+/gi, '$1[REDACTED_AUTH]');
    sanitized = sanitized.replace(/(password=)[^&\s]+/gi, '$1[REDACTED]');

    return sanitized;
  }

  /**
   * Executes an HTTP request against the local Asterisk ARI REST API.
   * Uses native fetch and AbortController for deterministic timeout enforcement.
   */
  private async request<T>(path: string, options: { method?: string; timeoutMs?: number } = {}): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${normalizedPath}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const isAuthError = response.status === 401 || response.status === 403;
        const msg = this.sanitize(
          `ARI request to ${path} failed with HTTP ${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ''}`,
        );

        if (isAuthError) {
          this.logger.warn(`ARI authentication failed on ${path}: HTTP ${response.status}`);
          throw new AsteriskAriError(msg, response.status, false, true);
        }

        this.logger.warn(`ARI request failed on ${path}: HTTP ${response.status}`);
        throw new AsteriskAriError(msg, response.status, false, false);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      if (typeof response.json === 'function') {
        try {
          return (await response.json()) as T;
        } catch {
          return undefined as unknown as T;
        }
      }

      if (typeof response.text === 'function') {
        const text = await response.text().catch(() => '');
        if (!text || !text.trim()) {
          return undefined as unknown as T;
        }
        return JSON.parse(text) as T;
      }

      return undefined as unknown as T;
    } catch (err: any) {
      if (err instanceof AsteriskAriError) {
        throw err;
      }

      if (err.name === 'AbortError' || controller.signal.aborted) {
        const timeoutMsg = `ARI request to ${path} timed out after ${timeoutMs}ms`;
        this.logger.warn(timeoutMsg);
        throw new AsteriskAriError(timeoutMsg, undefined, true, false);
      }

      const safeMsg = this.sanitize(`ARI network error on ${path}: ${err.message || err}`);
      this.logger.warn(safeMsg);
      throw new AsteriskAriError(safeMsg, undefined, false, false);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes a binary GET request against Asterisk ARI (e.g. for audio file retrieval).
   */
  private async requestBinary(path: string, options: { method?: string; timeoutMs?: number } = {}): Promise<Buffer> {
    const baseUrl = this.getBaseUrl();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${normalizedPath}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const msg = this.sanitize(
          `ARI binary request to ${path} failed with HTTP ${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ''}`,
        );
        throw new AsteriskAriError(msg, response.status, false, response.status === 401 || response.status === 403);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      if (err instanceof AsteriskAriError) throw err;
      if (err.name === 'AbortError' || controller.signal.aborted) {
        throw new AsteriskAriError(`ARI request to ${path} timed out after ${timeoutMs}ms`, undefined, true, false);
      }
      throw new AsteriskAriError(this.sanitize(`ARI network error on ${path}: ${err.message || err}`), undefined, false, false);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Performs an end-to-end connectivity and health check against Asterisk ARI.
   * Returns latency and Asterisk version without throwing.
   */
  public async checkConnectivity(timeoutMs?: number): Promise<AriConnectivityResult> {
    const startTime = Date.now();
    try {
      const info = await this.getSystemInfo(timeoutMs);
      const latencyMs = Date.now() - startTime;
      return {
        connected: true,
        latencyMs,
        version: info.version,
      };
    } catch (err: any) {
      const safeError = this.sanitize(err.message || 'Unknown ARI connectivity failure');
      return {
        connected: false,
        error: safeError,
      };
    }
  }

  /**
   * Retrieves Asterisk core system, build, and version information.
   * Endpoint: GET /ari/asterisk/info
   */
  public async getSystemInfo(timeoutMs?: number): Promise<AsteriskSystemInfo> {
    const data = await this.request<any>('/ari/asterisk/info', { timeoutMs });
    return {
      version: data?.system?.version || 'unknown',
      entityId: data?.system?.entity_id,
      os: data?.build?.os,
      kernel: data?.build?.kernel,
      startupTime: data?.status?.startup_time,
      lastReloadTime: data?.status?.last_reload_time,
    };
  }

  /**
   * Retrieves status for all configured Asterisk endpoints.
   * Endpoint: GET /ari/endpoints
   */
  public async getEndpoints(timeoutMs?: number): Promise<AsteriskEndpoint[]> {
    const raw = await this.request<any[]>('/ari/endpoints', { timeoutMs });
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((item) => ({
      technology: item.technology || '',
      resource: item.resource || '',
      state: item.state || 'unknown',
      channelIds: Array.isArray(item.channel_ids) ? item.channel_ids : [],
    }));
  }

  /**
   * Lists all currently active Asterisk channels.
   * Endpoint: GET /ari/channels
   */
  public async listChannels(timeoutMs?: number): Promise<AsteriskChannel[]> {
    const raw = await this.request<any[]>('/ari/channels', { timeoutMs });
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((ch) => ({
      id: ch.id || '',
      name: ch.name || '',
      state: ch.state || 'unknown',
      callerNumber: ch.caller?.number,
      connectedNumber: ch.connected?.number,
      creationTime: ch.creationtime,
    }));
  }

  /**
   * Retrieves details of a specific Asterisk channel, including its state ('Up', 'Ring', etc.).
   * Endpoint: GET /ari/channels/{channelId}
   */
  public async getChannel(channelId: string, timeoutMs?: number): Promise<AsteriskChannel> {
    const path = `/ari/channels/${encodeURIComponent(channelId)}`;
    const ch = await this.request<any>(path, { timeoutMs });
    return {
      id: ch?.id || channelId,
      name: ch?.name || '',
      state: ch?.state || 'unknown',
      callerNumber: ch?.caller?.number,
      connectedNumber: ch?.connected?.number,
      creationTime: ch?.creationtime,
    };
  }

  /**
   * Reads a channel variable on a specific Asterisk channel.
   * Endpoint: GET /ari/channels/{channelId}/variable?variable={variable}
   */
  public async getChannelVariable(channelId: string, variable: string, timeoutMs?: number): Promise<string> {
    const path = `/ari/channels/${encodeURIComponent(channelId)}/variable?variable=${encodeURIComponent(variable)}`;
    const res = await this.request<any>(path, { timeoutMs });
    return res?.value || '';
  }

  /**
   * Lists all stored audio recordings on Asterisk.
   * Endpoint: GET /ari/recordings/stored
   */
  public async listStoredRecordings(timeoutMs?: number): Promise<AsteriskStoredRecording[]> {
    const raw = await this.request<any[]>('/ari/recordings/stored', { timeoutMs });
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((rec) => ({
      name: rec.name || '',
      format: rec.format || '',
      state: rec.state || 'unknown',
      duration: rec.duration,
    }));
  }

  /**
   * Retrieves metadata of an individual stored recording on Asterisk.
   * Endpoint: GET /ari/recordings/stored/{recordingName}
   */
  public async getStoredRecording(recordingName: string, timeoutMs?: number): Promise<AsteriskStoredRecording> {
    const path = `/ari/recordings/stored/${encodeURIComponent(recordingName)}`;
    const rec = await this.request<any>(path, { timeoutMs });
    return {
      name: rec?.name || recordingName,
      format: rec?.format || 'wav',
      state: rec?.state || 'unknown',
      duration: rec?.duration,
    };
  }

  /**
   * Originates an outbound channel via Asterisk ARI.
   * Endpoint: POST /ari/channels
   */
  public async originateChannel(options: {
    endpoint: string;
    app?: string;
    appArgs?: string;
    callerId?: string;
    timeoutMs?: number;
    variables?: Record<string, string>;
  }): Promise<AsteriskChannel> {
    const params = new URLSearchParams();
    params.set('endpoint', options.endpoint);
    params.set('app', options.app || 'callflow-qa');
    if (options.callerId) params.set('callerId', options.callerId);
    if (options.appArgs) params.set('appArgs', options.appArgs);

    const path = `/ari/channels?${params.toString()}`;
    const ch = await this.request<any>(path, { method: 'POST', timeoutMs: options.timeoutMs });
    return {
      id: ch?.id || '',
      name: ch?.name || '',
      state: ch?.state || 'unknown',
      callerNumber: ch?.caller?.number,
      connectedNumber: ch?.connected?.number,
      creationTime: ch?.creationtime,
    };
  }

  /**
   * Creates a Snoop channel attached to an existing channel via Asterisk audiohook.
   * Endpoint: POST /ari/channels/{channelId}/snoop
   */
  public async snoopChannel(
    channelId: string,
    options: {
      app: string;
      spy?: 'none' | 'both' | 'in' | 'out';
      whisper?: 'none' | 'both' | 'in' | 'out';
      appArgs?: string;
      snoopId?: string;
      timeoutMs?: number;
    },
  ): Promise<AsteriskChannel> {
    const params = new URLSearchParams();
    params.set('app', options.app);
    if (options.spy) params.set('spy', options.spy);
    if (options.whisper) params.set('whisper', options.whisper);
    if (options.appArgs) params.set('appArgs', options.appArgs);
    if (options.snoopId) params.set('snoopId', options.snoopId);

    const path = `/ari/channels/${encodeURIComponent(channelId)}/snoop?${params.toString()}`;
    const ch = await this.request<any>(path, { method: 'POST', timeoutMs: options.timeoutMs });
    return {
      id: ch?.id || '',
      name: ch?.name || '',
      state: ch?.state || 'unknown',
      callerNumber: ch?.caller?.number,
      connectedNumber: ch?.connected?.number,
      creationTime: ch?.creationtime,
    };
  }

  /**
   * Starts a live recording on a channel via Asterisk ARI.
   * Endpoint: POST /ari/channels/{channelId}/record
   */
  public async recordChannel(
    channelId: string,
    options: {
      name: string;
      format?: string;
      maxDurationSeconds?: number;
      maxSilenceSeconds?: number;
      beep?: boolean;
      ifExists?: 'fail' | 'overwrite' | 'append';
      timeoutMs?: number;
    },
  ): Promise<AsteriskLiveRecording> {
    const params = new URLSearchParams();
    params.set('name', options.name);
    params.set('format', options.format || 'wav');
    if (options.maxDurationSeconds !== undefined) params.set('maxDurationSeconds', String(options.maxDurationSeconds));
    if (options.maxSilenceSeconds !== undefined) params.set('maxSilenceSeconds', String(options.maxSilenceSeconds));
    if (options.beep !== undefined) params.set('beep', String(options.beep));
    if (options.ifExists) params.set('ifExists', options.ifExists);

    const path = `/ari/channels/${encodeURIComponent(channelId)}/record?${params.toString()}`;
    const rec = await this.request<any>(path, { method: 'POST', timeoutMs: options.timeoutMs });
    return {
      name: rec?.name || options.name,
      format: rec?.format || options.format || 'wav',
      state: rec?.state || 'recording',
      duration: rec?.duration,
      talkingDuration: rec?.talking_duration,
      silenceDuration: rec?.silence_duration,
    };
  }

  /**
   * Retrieves status of an active live recording on Asterisk.
   * Endpoint: GET /ari/recordings/live/{recordingName}
   */
  public async getLiveRecording(recordingName: string, timeoutMs?: number): Promise<AsteriskLiveRecording> {
    const path = `/ari/recordings/live/${encodeURIComponent(recordingName)}`;
    const rec = await this.request<any>(path, { timeoutMs });
    return {
      name: rec?.name || recordingName,
      format: rec?.format || 'wav',
      state: rec?.state || 'unknown',
      duration: rec?.duration,
      talkingDuration: rec?.talking_duration,
      silenceDuration: rec?.silence_duration,
    };
  }

  /**
   * Stops an active live recording on Asterisk.
   * Endpoint: POST /ari/recordings/live/{recordingName}/stop
   */
  public async stopRecording(recordingName: string, timeoutMs?: number): Promise<void> {
    const path = `/ari/recordings/live/${encodeURIComponent(recordingName)}/stop`;
    await this.request<void>(path, { method: 'POST', timeoutMs });
  }

  /**
   * Injects audio media playback into an active channel.
   * Endpoint: POST /ari/channels/{channelId}/play
   */
  public async playMedia(
    channelId: string,
    mediaUri: string,
    timeoutMs?: number,
  ): Promise<AsteriskPlayback> {
    const params = new URLSearchParams();
    params.set('media', mediaUri);
    const path = `/ari/channels/${encodeURIComponent(channelId)}/play?${params.toString()}`;
    const p = await this.request<any>(path, { method: 'POST', timeoutMs });
    return {
      id: p?.id || '',
      mediaUri: p?.media_uri || mediaUri,
      targetUri: p?.target_uri,
      state: p?.state || 'unknown',
    };
  }

  /**
   * Terminates an active Asterisk channel.
   * Endpoint: DELETE /ari/channels/{channelId}
   */
  public async hangupChannel(channelId: string, reason?: string, timeoutMs?: number): Promise<void> {
    const params = new URLSearchParams();
    if (reason) params.set('reason', reason);
    const qs = params.toString();
    const path = `/ari/channels/${encodeURIComponent(channelId)}${qs ? `?${qs}` : ''}`;
    await this.request<void>(path, { method: 'DELETE', timeoutMs });
  }

  /**
   * Deletes a stored recording file from Asterisk disk.
   * Endpoint: DELETE /ari/recordings/stored/{recordingName}
   */
  public async deleteStoredRecording(recordingName: string, timeoutMs?: number): Promise<void> {
    const path = `/ari/recordings/stored/${encodeURIComponent(recordingName)}`;
    await this.request<void>(path, { method: 'DELETE', timeoutMs });
  }

  /**
   * Downloads a stored recording file as a binary Buffer.
   * Endpoint: GET /ari/recordings/stored/{recordingName}/file
   */
  public async getStoredRecordingFile(recordingName: string, timeoutMs?: number): Promise<Buffer> {
    const path = `/ari/recordings/stored/${encodeURIComponent(recordingName)}/file`;
    return this.requestBinary(path, { timeoutMs });
  }
}
