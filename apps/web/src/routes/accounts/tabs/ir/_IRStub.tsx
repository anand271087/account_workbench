// Shared stub renderer for Intelligence & Reports sub-sections still to ship.

import { useAccountFromLayout } from "../../AccountProfileLayout";

export function IRStub({
  title,
  milestone,
  description,
  bullets,
}: {
  title: string;
  milestone: string;
  description: string;
  bullets: string[];
}) {
  const account = useAccountFromLayout();
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[15px] font-bold text-text-primary">{title}</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-beroe-teal/15 text-beroe-teal">
          {milestone}
        </span>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed mb-3">
        {description}
      </p>
      <ul className="text-[12px] text-text-secondary space-y-1 list-disc list-inside">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <div className="mt-4 pt-3 border-t border-beroe-card-border/60 text-[10px] text-text-muted">
        Account:{" "}
        <span className="font-semibold text-text-secondary">{account.name}</span>{" "}
        · scaffold landed in M29
      </div>
    </div>
  );
}
