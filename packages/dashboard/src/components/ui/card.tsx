import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[20px] border bg-[var(--color-bg-card)] card-soft",
        className,
      )}
      style={{ borderColor: "var(--color-border)" }}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("p-5", className)}
      style={{ borderBottom: "1px solid var(--color-border)" }}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn("text-base font-semibold", className)}
    style={{ fontFamily: "var(--font-display)", color: "var(--color-fg)" }}
    {...props}
  >
    {children}
  </h3>
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p
    className={cn("text-sm mt-1", className)}
    style={{ color: "var(--color-fg-subtle)", fontFamily: "var(--font-sans)" }}
    {...props}
  />
);

export const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5", className)} {...props} />
  ),
);
CardBody.displayName = "CardBody";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("p-5", className)}
      style={{ borderTop: "1px solid var(--color-border)" }}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";
