import * as React from "react"
import { cn } from "@/utils/cn"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "error" | "info" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2",
        {
          "bg-primary text-primary-foreground": variant === "default",
          "bg-success-muted text-success-muted-foreground": variant === "success",
          "bg-warning-muted text-warning-muted-foreground": variant === "warning",
          "bg-error-muted text-error-muted-foreground": variant === "error",
          "bg-info-muted text-info-muted-foreground": variant === "info",
          "border border-border text-foreground": variant === "outline",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
