import chalk from 'chalk';
import type { ChalkInstance } from 'chalk';

/**
 * Tiny colour-coded console logger. A single shared instance is exported so the
 * whole app logs through the same object. Swap this for a structured logger
 * (pino/winston) when you need JSON logs, log levels, or transports.
 */
class Logger {
  private logWithColor(colorFn: ChalkInstance, label: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const coloredLabel = colorFn(`[${label}]`);
    console.log(`${chalk.gray(timestamp)} ${coloredLabel}`, ...args);
  }

  info(...args: unknown[]): void {
    this.logWithColor(chalk.blue, 'INFO', ...args);
  }

  error(...args: unknown[]): void {
    this.logWithColor(chalk.red, 'ERROR', ...args);
  }

  success(...args: unknown[]): void {
    this.logWithColor(chalk.green, 'SUCCESS', ...args);
  }

  warn(...args: unknown[]): void {
    this.logWithColor(chalk.yellow, 'WARN', ...args);
  }

  log(...args: unknown[]): void {
    this.logWithColor(chalk.white, 'LOG', ...args);
  }
}

export default new Logger();
