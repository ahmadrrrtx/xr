import { Check, Lock, Server } from 'lucide-react';

import { Reveal, StepHeader } from './parts';

const PROMISES = [
  {
    icon: Server,
    title: 'Local-first',
    desc: 'Your data stays on this machine by default. The cloud is opt-in.',
  },
  {
    icon: Lock,
    title: 'Private by default',
    desc: 'Nothing leaves this device without your explicit permission.',
  },
  {
    icon: Check,
    title: 'You are the operator',
    desc: 'XR proposes, you approve. Every consequential action asks first.',
  },
];

/** Step 2 — the XR promise. Checkbox gates Continue (not skippable). */
export function StepPromise({
  understood,
  setUnderstood,
}: {
  understood: boolean;
  setUnderstood: (v: boolean) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Three promises, before we begin."
        sub="XR is built so you stay in control. These aren't settings — they're the architecture."
      />
      <div className="space-y-3">
        {PROMISES.map((p, i) => (
          <Reveal key={p.title} delay={0.06 * i}>
            <div className="border-border-subtle bg-bg-raised/40 flex items-start gap-3.5 rounded-xl border p-4">
              <p.icon
                aria-hidden="true"
                className="text-accent mt-0.5 size-5 shrink-0"
                strokeWidth={1.5}
              />
              <div>
                <h3 className="text-text-primary text-[14.5px] font-medium">{p.title}</h3>
                <p className="text-text-tertiary mt-0.5 text-[13px] leading-relaxed">{p.desc}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.25}>
        <label className="mt-6 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="border-border-default accent-accent size-4"
          />
          <span className="text-text-secondary text-[13.5px] font-medium">
            I understand — I'm in control.
          </span>
        </label>
      </Reveal>
    </div>
  );
}
