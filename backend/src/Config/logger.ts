import chalk from 'chalk';
import type { ChalkInstance } from 'chalk';

/**
 * Tiny colour-coded console logger. A single shared instance is exported so the
 * whole app logs through the same object. Swap this for a structured logger
 * (pino/winston) when you need JSON logs, log levels, or transports.
 */
class Logger {
  private silent = false;

  setSilent(silent: boolean): void {
    this.silent = silent;
  }
  
  private logWithColor(
    stream: 'stdout' | 'stderr',
    colorFn: ChalkInstance,
    label: string,
    ...args: unknown[]
  ): void {
    if (this.silent) return;
    const timestamp = new Date().toISOString();
    const coloredLabel = colorFn(`[${label}]`);
    const formatted = `${chalk.gray(timestamp)} ${coloredLabel}`;

    if (stream === 'stderr') {
      console.error(formatted, ...args);
    } else {
      console.log(formatted, ...args);
    }
  }

  info(...args: unknown[]): void {
    this.logWithColor('stdout', chalk.blue, 'INFO', ...args);
  }

  error(...args: unknown[]): void {
    this.logWithColor('stderr', chalk.red, 'ERROR', ...args);
  }

  success(...args: unknown[]): void {
    this.logWithColor('stdout', chalk.green, 'SUCCESS', ...args);
  }

  warn(...args: unknown[]): void {
    this.logWithColor('stderr', chalk.yellow, 'WARN', ...args);
  }

  log(...args: unknown[]): void {
    this.logWithColor('stdout' ,chalk.white, 'LOG', ...args);
  }
}

export default new Logger();
