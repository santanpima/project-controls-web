export interface TabItem {
  key: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

// 4.2.2.1.3 — a sub-view switcher within a single page, distinct from the
// SidePanel's module-level navigation. Genuinely simple by design: this
// component only tracks which tab is active and calls back on change; the
// caller owns what actually renders for each tab.
export function Tabs({ tabs, activeKey, onChange }: TabsProps): JSX.Element {
  return (
    <div role="tablist" className="flex gap-1 border-b border-neutral-200">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px " +
              (isActive
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-neutral-500 hover:text-neutral-700")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
