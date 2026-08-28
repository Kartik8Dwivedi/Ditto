import { describe, it, expect } from 'vitest';

import { formatDoctorReport, type DoctorCheck } from '../src/Scripts/doctor.js';

describe('formatDoctorReport', () => {
  it('returns allOk: true and a SUCCESS summary when all checks pass', () => {
    const checks: DoctorCheck[] = [
      {
        name: 'Environment configuration',
        ok: true,
        detail: 'valid (MONGO_URI, OPENAI_API_KEY present)',
      },
      {
        name: 'MongoDB connectivity',
        ok: true,
        detail: 'connected & ping successful',
      },
      {
        name: 'OpenAI API connectivity',
        ok: true,
        detail: 'reachable (models listed / verified)',
      },
    ];

    const { report, allOk } = formatDoctorReport(checks);

    expect(allOk).toBe(true);
    expect(report).toContain('[DOCTOR] Running preflight diagnostic...');
    expect(report).toContain('✔ Environment configuration');
    expect(report).toContain('✔ MongoDB connectivity');
    expect(report).toContain('✔ OpenAI API connectivity');
    expect(report).toContain('[SUCCESS] All checks passed! Ready to run Ditto.');
  });

  it('returns allOk: false and an ERROR summary when at least one check fails', () => {
    const checks: DoctorCheck[] = [
      {
        name: 'Environment configuration',
        ok: true,
        detail: 'valid (MONGO_URI, OPENAI_API_KEY present)',
      },
      {
        name: 'MongoDB connectivity',
        ok: false,
        detail: 'connection failed with error (ECONNREFUSED)',
      },
      {
        name: 'OpenAI API connectivity',
        ok: true,
        detail: 'reachable (models listed / verified)',
      },
    ];

    const { report, allOk } = formatDoctorReport(checks);

    expect(allOk).toBe(false);
    expect(report).toContain('✔ Environment configuration');
    expect(report).toContain('✖ MongoDB connectivity');
    expect(report).toContain('connection failed with error (ECONNREFUSED)');
    expect(report).toContain('[ERROR] 2/3 passed! Unready to run Ditto.');
  });

  it('handles an empty checks array gracefully', () => {
    const { report, allOk } = formatDoctorReport([]);

    expect(allOk).toBe(true);
    expect(report).toContain('[SUCCESS] All checks passed!');
  });
});
