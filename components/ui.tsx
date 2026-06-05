import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-matrix-border bg-matrix-panel/72 px-4 py-3 shadow-glow md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-2xl font-semibold tracking-normal text-matrix-fg sm:text-3xl">{title}</h2>
        <p className="mt-1 max-w-4xl text-sm text-matrix-muted">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-md border border-matrix-border bg-matrix-panel/88 p-4 shadow-glow", className)}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ children, variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" && "bg-matrix-gold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white",
        variant === "secondary" && "border border-matrix-border bg-matrix-panel2/80 text-matrix-fg hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40",
        variant === "danger" && "bg-red-500/12 text-red-700 ring-1 ring-red-500/25 hover:bg-red-500/18 dark:text-red-200",
        variant === "ghost" && "text-matrix-muted hover:bg-matrix-goldSoft/30 hover:text-matrix-fg",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: "success" | "info" | "warning" | "danger" | "muted" | "purple" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
        tone === "success" && "bg-green-500/12 text-green-700 ring-green-500/25 dark:text-green-300",
        tone === "info" && "bg-matrix-goldSoft/55 text-matrix-goldDark ring-matrix-gold/25 dark:text-matrix-goldDark",
        tone === "warning" && "bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300",
        tone === "danger" && "bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300",
        tone === "purple" && "bg-matrix-gold/12 text-matrix-goldDark ring-matrix-gold/25",
        tone === "muted" && "bg-matrix-muted/10 text-matrix-muted ring-matrix-border"
      )}
    >
      {children}
    </span>
  );
}

export function KpiCard({ label, value, hint, tone = "info" }: { label: string; value: string; hint: string; tone?: "success" | "info" | "warning" | "danger" | "purple" }) {
  const toneClass = {
    success: "text-green-600 dark:text-green-300",
    info: "text-matrix-goldDark",
    warning: "text-orange-600 dark:text-orange-300",
    danger: "text-red-600 dark:text-red-300",
    purple: "text-matrix-goldDark"
  }[tone];

  return (
    <Card className="min-h-24 p-3">
      <p className="text-xs font-medium text-matrix-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold tracking-normal", toneClass)}>{value}</p>
      <p className="mt-1 text-xs text-matrix-muted">{hint}</p>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-44 place-items-center rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center">
      <div className="mx-auto max-w-md">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-matrix-goldSoft/60 text-matrix-goldDark">
          <Inbox className="h-5 w-5" />
        </div>
        <h3 className="mt-3 font-semibold text-matrix-fg">{title}</h3>
        {description ? <p className="mt-2 text-sm text-matrix-muted">{description}</p> : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, emptyMessage = "Nenhum registro encontrado." }: { columns: string[]; rows: ReactNode[][]; emptyMessage?: string }) {
  return (
    <div className="matrix-scroll overflow-x-auto rounded-md border border-matrix-border bg-matrix-panel">
      <table className="min-w-full divide-y divide-matrix-border text-left text-sm">
        <thead className="bg-matrix-panel2 text-xs uppercase text-matrix-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-matrix-border bg-matrix-panel/70">
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-matrix-goldSoft/18">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-nowrap px-3 py-2.5 text-matrix-fg">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-8 text-center text-sm text-matrix-muted" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-matrix-border px-3 py-2 text-xs text-matrix-muted">
        <span>Pagina 1 de 1</span>
        <span>{rows.length} itens</span>
      </div>
    </div>
  );
}
