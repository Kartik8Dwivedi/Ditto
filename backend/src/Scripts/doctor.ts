import AppConfig from '../Config/AppConfig.js';
import { connectToDB, disconnectFromDB } from '../Config/db.js';
import OpenAIService from '../Services/openai.service.js';
import logger from '../Config/logger.js';

/**
 * `npm run doctor`
 *
 * Preflight connectivity and configuration diagnostic.
 */

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export const formatDoctorReport = (checks: DoctorCheck[]): { report: string; allOk: boolean } => {
  const allOk = checks.every((check) => check.ok);
  let report = `[DOCTOR] Running preflight diagnostic...\n`;
  for (const check of checks) {
    const format = `\n ${check.ok ? '✔' : '✖'} ${check.name.padEnd(28, ' ')}: ${check.detail}`;
    report += format;
  }
  if (allOk) {
    report += `\n\n[SUCCESS] All checks passed! Ready to run Ditto.`;
  } else {
    const passed = checks.filter((check) => check.ok).length;
    report += `\n\n[ERROR] ${passed}/${checks.length} passed! Unready to run Ditto.`;
  }

  return { report, allOk };
};

const runChecks = async (): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];

  // Env check - report what is actually configured
  const configured = [];
  if (AppConfig.MONGO_ENABLED) configured.push('MONGO_URI');
  if (AppConfig.OPENAI_ENABLED) configured.push('OPENAI_API_KEY');
  
  checks.push({
    name: 'Environment configuration',
    ok: true,
    detail: configured.length > 0 
      ? `valid (${configured.join(', ')} present)` 
      : 'valid (no optional vars set - server and pipeline will not start)',
  });

  // MongoDB check
  if (AppConfig.MONGO_ENABLED) {
    try {
      await connectToDB();
      checks.push({
        name: 'MongoDB connectivity',
        ok: true,
        detail: 'connected & ping successful',
      });
    } catch (err) {
      checks.push({
        name: 'MongoDB connectivity',
        ok: false,
        detail: `connection failed (${err instanceof Error ? err.message : err})`,
      });
    } finally {
      await disconnectFromDB().catch(() => {});
    }
  }

  // OpenAI check
  if (AppConfig.OPENAI_ENABLED) {
    try {
      const openai = new OpenAIService();
      await openai.ping();
      checks.push({
        name: 'OpenAI API connectivity',
        ok: true,
        detail: `reachable (models listed / verified)`,
      });
    } catch (err) {
      checks.push({
        name: 'OpenAI API connectivity',
        ok: false,
        detail: `ping failed (${err instanceof Error ? err.message : err})`,
      });
    }
  }

  return checks;
};

const main = async (): Promise<void> => {
  const checks = await runChecks();
  const { report, allOk } = formatDoctorReport(checks);

  console.log(report);

  if (!allOk) {
    process.exit(1);
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
