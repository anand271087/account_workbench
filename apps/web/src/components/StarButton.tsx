/** Pin/unpin star toggle. Filled gold when pinned, outline when not. */

import { cn } from "@/lib/utils";

export function StarButton({
  pinned,
  onToggle,
  size = "sm",
  className,
}: {
  pinned: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "md" ? "w-5 h-5" : "w-4 h-4";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
      aria-label={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 hover:bg-amber-50 transition-colors",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill={pinned ? "#f59e0b" : "none"}
        stroke={pinned ? "#f59e0b" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(dim, !pinned && "text-text-muted hover:text-amber-500")}
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
