import * as React from "react";
import { Card, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  isLoading = false,
  destructive = true,
}: ConfirmDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isLoading, onOpenChange]);

  if (!open) return null;

  const isPlainText = typeof description === "string" || typeof description === "number";

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <CardHeader>
          <CardTitle id={titleId}>{title}</CardTitle>
          <CardDescription
            as={isPlainText ? "p" : "div"}
            id={descriptionId}
            className="text-sm text-muted-foreground mt-2"
          >
            {description}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button 
            variant={destructive ? "destructive" : "primary"}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
