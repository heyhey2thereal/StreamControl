import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { Logger } from './logger';

/** Codes d'operation du protocole obs-websocket v5. */
const OP = {
  HELLO: 0,
  IDENTIFY: 1,
  IDENTIFIED: 2,
  REIDENTIFY: 3,
  EVENT: 5,
  REQUEST: 6,
  REQUEST_RESPONSE: 7,
} as const;

/** Codes de fermeture normalises par obs-websocket. */
const CLOSE_AUTH_FAILED = 4009;

export interface ObsConnectionOptions {
  host: string;
  port: number;
  password: string;
}

export interface ObsHelloInfo {
  obsWebSocketVersion: string;
  rpcVersion: number;
  authenticationRequired: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  requestType: string;
}

export type ObsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'auth-failed';

/**
 * Client minimal du protocole obs-websocket v5.
 * Implemente Hello/Identify/Identified, les requetes et les evenements.
 */
export class ObsClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private state: ObsConnectionState = 'disconnected';
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private hello: ObsHelloInfo | null = null;

  constructor(private readonly logger: Logger) {
    super();
    this.logger.setMaxListeners(50);
  }

  getState(): ObsConnectionState {
    return this.state;
  }

  getHello(): ObsHelloInfo | null {
    return this.hello;
  }

  /** Calcule la reponse d'authentification exigee par obs-websocket v5. */
  static buildAuthString(password: string, salt: string, challenge: string): string {
    const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
    return crypto.createHash('sha256').update(secret + challenge).digest('base64');
  }

  connect(options: ObsConnectionOptions, timeoutMs = 6000): Promise<ObsHelloInfo> {
    this.disconnect();
    this.setState('connecting');

    const url = `ws://${options.host}:${options.port}`;
    this.logger.info('obs', `Connexion a OBS sur ${url}...`);

    return new Promise<ObsHelloInfo>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;

      try {
        socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
      } catch (error) {
        this.setState('disconnected');
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.socket = socket;

      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.logger.error('obs', `Delai de connexion depasse (${timeoutMs} ms).`);
        socket.terminate();
        this.setState('disconnected');
        reject(new Error('Delai de connexion a OBS depasse. Verifiez que le serveur WebSocket est active.'));
      }, timeoutMs);

      const succeed = (info: ObsHelloInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        resolve(info);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        reject(error);
      };

      socket.on('message', (raw: WebSocket.RawData) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch (error) {
          this.logger.warn('obs', `Message illisible recu d'OBS : ${String(error)}`);
          return;
        }
        const op = message.op as number;

        if (op === OP.HELLO) {
          const data = (message.d as Record<string, unknown>) ?? {};
          const auth = data.authentication as { challenge: string; salt: string } | undefined;
          this.hello = {
            obsWebSocketVersion: String(data.obsWebSocketVersion ?? 'inconnue'),
            rpcVersion: Number(data.rpcVersion ?? 1),
            authenticationRequired: Boolean(auth),
          };

          const identify: Record<string, unknown> = {
            rpcVersion: this.hello.rpcVersion,
            eventSubscriptions: 0x7ff,
          };

          if (auth) {
            if (!options.password) {
              const error = new Error(
                'OBS exige un mot de passe WebSocket, mais aucun n\'est configure dans StreamControl.',
              );
              this.logger.error('obs', error.message);
              socket.close();
              this.setState('auth-failed');
              fail(error);
              return;
            }
            identify.authentication = ObsClient.buildAuthString(options.password, auth.salt, auth.challenge);
          }

          socket.send(JSON.stringify({ op: OP.IDENTIFY, d: identify }));
          return;
        }

        if (op === OP.IDENTIFIED) {
          this.setState('connected');
          this.logger.info('obs', `Connecte a OBS (obs-websocket ${this.hello?.obsWebSocketVersion}).`);
          succeed(this.hello ?? { obsWebSocketVersion: 'inconnue', rpcVersion: 1, authenticationRequired: false });
          return;
        }

        if (op === OP.EVENT) {
          const eventType = String((message.d as Record<string, unknown>)?.eventType ?? 'unknown');
          this.emit('event', eventType, (message.d as Record<string, unknown>)?.eventData ?? {});
          return;
        }

        if (op === OP.REQUEST_RESPONSE) {
          this.handleResponse(message);
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        clearTimeout(failTimer);
        this.socket = null;
        this.rejectAllPending(new Error(`Connexion OBS fermee (code ${code}).`));

        if (code === CLOSE_AUTH_FAILED) {
          this.setState('auth-failed');
          const error = new Error('Mot de passe WebSocket refuse par OBS. Verifiez-le dans Outils > WebSocket.');
          this.logger.error('obs', error.message);
          fail(error);
          return;
        }

        const wasConnected = this.state === 'connected';
        this.setState('disconnected');
        this.logger.info('obs', `Connexion fermee (code ${code}${reason?.length ? `, ${reason.toString()}` : ''}).`);
        if (!settled) {
          fail(new Error(`Connexion OBS fermee avant identification (code ${code}).`));
        } else if (wasConnected) {
          this.emit('disconnected', { code, reason: reason?.toString() ?? '' });
        }
      });

      socket.on('error', (error: Error) => {
        this.logger.errorFrom('obs', error, 'Erreur WebSocket OBS');
        this.setState('disconnected');

        // Une connexion refusee sur le port d'OBS a une cause tres precise :
        // le serveur WebSocket n'est pas active. Le message brut
        // (« ECONNREFUSED ») ne dit rien a l'utilisateur.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED') {
          fail(
            new Error(
              `OBS ne repond pas sur le port ${options.port}. Le serveur WebSocket est ` +
                "probablement desactive : dans OBS, ouvrez Outils > WebSocket Server Settings, " +
                'cochez « Enable WebSocket server », puis Connecter a nouveau. ' +
                '(Si OBS est ferme, lancez-le d\'abord.)',
            ),
          );
          return;
        }

        fail(error);
      });
    });
  }

  private handleResponse(message: Record<string, unknown>): void {
    const data = (message.d as Record<string, unknown>) ?? {};
    const requestId = String(data.requestId ?? '');
    const pending = this.pending.get(requestId);

    if (!pending) {
      this.logger.debug('obs', `Reponse sans requete correspondante (${requestId}).`);
      return;
    }

    this.pending.delete(requestId);
    clearTimeout(pending.timer);

    const status = (data.requestStatus as Record<string, unknown>) ?? {};
    const ok = status.result === true;

    if (!ok) {
      const code = status.code ?? 'inconnu';
      const comment = String(status.comment ?? '');
      pending.reject(
        new Error(`OBS a refuse ${pending.requestType} (code ${code})${comment ? ` : ${comment}` : ''}`),
      );
      return;
    }

    pending.resolve(data.responseData ?? {});
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setState(state: ObsConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }

  /** Envoie une requete et attend la reponse correspondante. */
  request<T = Record<string, unknown>>(
    requestType: string,
    requestData: Record<string, unknown> = {},
    timeoutMs = 5000,
  ): Promise<T> {
    if (!this.socket || this.state !== 'connected') {
      return Promise.reject(new Error('Non connecte a OBS.'));
    }

    const requestId = `sc-${++this.requestCounter}`;
    const payload = { op: OP.REQUEST, d: { requestType, requestId, requestData } };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS n'a pas repondu a ${requestType} dans le delai imparti.`));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        requestType,
      });

      try {
        this.socket?.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.rejectAllPending(new Error('Deconnexion demandee.'));
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.removeAllListeners('close');
      socket.close(1000, 'StreamControl disconnect');
    }
    this.setState('disconnected');
  }
}
