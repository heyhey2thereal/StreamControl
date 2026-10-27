import { EventEmitter } from 'node:events';
import type { LogEntry, LogLevel } from '../shared/types';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  maxEntries?: number;
  minLevel?: LogLevel;
  /** Recopie aussi les entrees sur la console. Inutile dans un EXE. */
  mirrorToConsole?: boolean;
}

/** Longueur maximale d'un message conserve. Au dela, il est tronque. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Journal en memoire, diffuse au rendu via l'evenement "log:entry".
 * Les entrees les plus anciennes sont evincees au dela de maxEntries.
 */
export class Logger extends EventEmitter {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private maxEntries: number;
  private minLevel: LogLevel;
  private mirror: boolean;

  constructor(options: LoggerOptions = {}) {
    super();
    this.maxEntries = options.maxEntries ?? 500;
    this.minLevel = options.minLevel ?? 'debug';
    this.mirror = options.mirrorToConsole ?? false;
    // Un logger peut depasser la limite par defaut d'EventEmitter.
    this.setMaxListeners(50);
  }

  setMaxEntries(value: number): void {
    this.maxEntries = Math.max(100, Math.floor(value));
    this.trim();
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  log(level: LogLevel, source: string, message: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      source,
      level,
      // Un message anormalement long (sortie d'un outil externe) ne doit pas
      // gonfler la memoire : on le tronque.
      message: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...` : message,
    };

    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.minLevel]) {
      this.entries.push(entry);
      this.trim();
      this.emit('entry', entry);
      if (this.mirror) this.mirrorToConsole(entry);
    }

    return entry;
  }

  debug(source: string, message: string): LogEntry {
    return this.log('debug', source, message);
  }

  info(source: string, message: string): LogEntry {
    return this.log('info', source, message);
  }

  warn(source: string, message: string): LogEntry {
    return this.log('warn', source, message);
  }

  error(source: string, message: string): LogEntry {
    return this.log('error', source, message);
  }

  /** Normalise une erreur inconnue en texte lisible. */
  errorFrom(source: string, error: unknown, context?: string): LogEntry {
    const message = error instanceof Error ? error.message : String(error);
    return this.error(source, context ? `${context} : ${message}` : message);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.emit('cleared');
  }

  private trim(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  private mirrorToConsole(entry: LogEntry): void {
    const line = `[${entry.source}] ${entry.message}`;
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  }
}
