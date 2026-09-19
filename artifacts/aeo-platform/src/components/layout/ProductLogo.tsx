import { Sparkles } from "lucide-react";

export function ProductLogo({ size = 17 }: { size?: number }) {
  return (
    <div
      className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
      data-testid="product-logo"
    >
      <span
        className="flex items-center justify-center rounded-md bg-foreground text-background"
        style={{ width: size + 8, height: size + 8 }}
        aria-hidden="true"
      >
        <Sparkles style={{ width: size, height: size }} strokeWidth={1.8} />
      </span>
      <span className="text-sm">AEO Intelligence</span>
    </div>
  );
}