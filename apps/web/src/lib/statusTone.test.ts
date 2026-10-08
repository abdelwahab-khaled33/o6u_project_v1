import { describe, expect, it } from 'vitest';
import { STATUS_PILL, statusTone } from './statusTone';

describe('statusTone', () => {
  it('tones every known exam/attempt status', () => {
    expect(statusTone('pending_approval')).toContain('fff5ec');
    expect(statusTone('approved')).toContain('effaf3');
    expect(statusTone('rejected')).toContain('fff1f0');
    expect(statusTone('submitted')).toContain('effaf3');
    expect(statusTone('auto_submitted')).toContain('eef4ff');
    expect(statusTone('in_progress')).toContain('fff5ec');
    expect(statusTone('not_started')).toContain('edf0f6');
  });

  it('falls back to neutral for an unknown status', () => {
    expect(statusTone('archived')).toContain('edf0f6');
  });

  it('exposes a shared pill base', () => {
    expect(STATUS_PILL).toContain('rounded-full');
  });
});
