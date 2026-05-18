import { IRStub } from "./_IRStub";

export default function DocumentsReportsTab() {
  return (
    <IRStub
      title="Documents & Reports"
      milestone="M31"
      description="Generate QBR / MBR / Utilization reports (HTML preview + PPT + PDF) for any account; upload solutioning proposals; browse the Available Materials library by topic."
      bullets={[
        "Quarterly Business Review (QBR) — engagement scope, usage analysis, category trends, Abi usage, MoM trends, what's new, action items",
        "Monthly Business Review (MBR) — shorter snapshot with key highlights and action items",
        "Utilization Report — adoption overview + module-wise usage + top users & categories",
        "Solutioning & Proposal uploads (.pptx / .pdf / .docx / .xlsx)",
        "Available Materials library — grouped by topic, browse / download / share via email",
      ]}
    />
  );
}
