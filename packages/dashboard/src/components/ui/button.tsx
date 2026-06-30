import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost" | "destructive" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  default:
    "bg-[var(--color-primary)] text-white hover:opacity-90 shadow-[0_0_20px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]",
  outline:
    "border border-[var(--color-border)] bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-accent)] hover:border-[var(--color-border-strong)]",
  ghost:
    "bg-transparent text-[var(--color-fg-subtle)] hover:bg-[var(--color-accent)] hover:text-[var(--color-fg)]",
  destructive: "bg-[var(--color-danger)] text-white hover:opacity-90",
  subtle:
    "bg-[var(--color-accent)] text-[var(--color-fg)] hover:bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-full",
  md: "h-9 px-4 text-sm rounded-full",
  lg: "h-11 px-6 text-sm rounded-full",
  icon: "h-9 w-9 rounded-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      style={{ fontFamily: "var(--font-sans)" }}
      {...props}
    />
  ),
);
Button.displayName = "Button";
