import * as React from "react";
import { cn } from "@/lib/utils";
import "./table.css";

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** En pantallas estrechas las filas se apilan como tarjetas (las celdas usan `label`). */
  stack?: boolean;
}

export const Table = ({ className, stack = false, ...props }: TableProps) => (
  <div className="ui-table-wrap">
    <table
      className={cn("ui-table w-full text-sm", stack && "ui-table--stack", className)}
      {...props}
    />
  </div>
);

export const Thead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn("border-b border-[var(--color-border)] text-[var(--color-fg-muted)]", className)}
    {...props}
  />
);

export const Tbody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn("divide-y divide-[var(--color-border)]", className)} {...props} />
);

export const Tr = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("hover:bg-[var(--color-accent)]/40 transition-colors", className)} {...props} />
);

export const Th = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("text-left text-xs font-medium uppercase tracking-wider px-4 py-3", className)}
    {...props}
  />
);

interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Etiqueta de la columna, mostrada delante del valor cuando la tabla se apila en móvil. */
  label?: string;
}

export const Td = ({ className, label, ...props }: TdProps) => (
  <td className={cn("px-4 py-3", className)} data-label={label} {...props} />
);
