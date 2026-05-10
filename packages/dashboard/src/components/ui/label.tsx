import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, children, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- generic wrapper; the htmlFor binding is the consumer's responsibility
    <label
      ref={ref}
      className={cn("text-xs font-medium text-[var(--color-fg-muted)] uppercase tracking-wider", className)}
      {...props}
    >
      {children}
    </label>
  ),
);
Label.displayName = "Label";
