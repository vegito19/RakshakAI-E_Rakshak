export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogPayload {
  message: string;
  timestamp: string;
  level: LogLevel;
  context?: string;
  metadata?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
  };
}

class Logger {
  private currentLevel: LogLevel = LogLevel.INFO;

  constructor() {
    // Dynamically set log level from environment variables if present
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && Object.values(LogLevel).includes(envLevel as LogLevel)) {
      this.currentLevel = envLevel as LogLevel;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const priority = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
    };
    return priority[level] >= priority[this.currentLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: string, metadata?: Record<string, any>, error?: Error): string {
    const payload: LogPayload = {
      message,
      timestamp: new Date().toISOString(),
      level,
      context,
      metadata,
    };

    if (error) {
      payload.error = {
        message: error.message,
        stack: error.stack,
      };
    }

    return JSON.stringify(payload);
  }

  public debug(message: string, context?: string, metadata?: Record<string, any>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, context, metadata));
    }
  }

  public info(message: string, context?: string, metadata?: Record<string, any>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage(LogLevel.INFO, message, context, metadata));
    }
  }

  public warn(message: string, context?: string, metadata?: Record<string, any>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context, metadata));
    }
  }

  public error(message: string, error?: Error, context?: string, metadata?: Record<string, any>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context, metadata, error));
    }
  }
}

export const logger = new Logger();
