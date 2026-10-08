const TONES: Record<string, string> = {
  pending_approval: 'border-[#f2c79a] bg-[#fff5ec] text-[#9a4c08]',
  approved: 'border-[#a8d7bd] bg-[#effaf3] text-[#147a47]',
  rejected: 'border-[#f0b5b0] bg-[#fff1f0] text-[#b42318]',
  submitted: 'border-[#a8d7bd] bg-[#effaf3] text-[#147a47]',
  auto_submitted: 'border-[#b4c7ef] bg-[#eef4ff] text-[#294a87]',
  in_progress: 'border-[#f2c79a] bg-[#fff5ec] text-[#9a4c08]',
  not_started: 'border-[#dfe5f0] bg-[#edf0f6] text-muted',
};

const NEUTRAL_TONE = 'border-[#dfe5f0] bg-[#edf0f6] text-muted';

export const STATUS_PILL = 'inline-block rounded-full border px-2.5 py-0.5 text-[0.82rem] font-bold';

export function statusTone(status: string): string {
  return TONES[status] ?? NEUTRAL_TONE;
}
