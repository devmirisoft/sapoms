import { SegmentedTabs } from "@/components/SegmentedTabs";

export type ViewMode = "list" | "cards";

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedTabs
      label="Result view"
      value={mode}
      onChange={(next) => onChange(next as ViewMode)}
      items={[
        {
          value: "list",
          label: "List",
          icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
          ),
        },
        {
          value: "cards",
          label: "Cards",
          icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          ),
        },
      ]}
    />
  );
}
