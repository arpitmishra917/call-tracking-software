import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('renders plain-text descriptions using semantic paragraph element without warnings', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Revoke Key"
        description="Are you sure you want to revoke this API key? This action is permanent."
        confirmText="Revoke"
        cancelText="Keep Key"
        onConfirm={handleConfirm}
      />
    );

    expect(screen.getByText('Revoke Key')).toBeDefined();
    const descriptionEl = screen.getByText('Are you sure you want to revoke this API key? This action is permanent.');
    expect(descriptionEl).toBeDefined();
    expect(descriptionEl.tagName.toLowerCase()).toBe('p');
    expect(descriptionEl.className).toContain('text-sm text-muted-foreground mt-2');

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByText('Revoke Key').getAttribute('id'));
    expect(dialog.getAttribute('aria-describedby')).toBe(descriptionEl.getAttribute('id'));

    // Assert no React DOM nesting warnings
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('renders ReactNode descriptions containing block elements as a div without invalid HTML nesting warnings', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    const complexDescription = (
      <div className="space-y-3 pt-2" data-testid="complex-desc-container">
        <p className="text-sm text-foreground">
          Are you sure you want to accept this dispute? A financial adjustment will automatically be recorded.
        </p>
        <div className="space-y-1">
          <label htmlFor="res-notes" className="text-xs font-medium">Resolution Notes</label>
          <input
            id="res-notes"
            placeholder="Internal notes"
            className="h-8 text-xs"
          />
        </div>
      </div>
    );

    const { container } = render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Accept Dispute"
        description={complexDescription}
        confirmText="Accept Dispute"
        cancelText="Cancel"
        onConfirm={handleConfirm}
        destructive={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Accept Dispute' })).toBeDefined();
    const blockContainer = screen.getByTestId('complex-desc-container');
    expect(blockContainer).toBeDefined();

    // The wrapper of the description must be a <div>, not a <p>, to avoid invalid paragraph nesting
    const descriptionWrapper = blockContainer.parentElement;
    expect(descriptionWrapper?.tagName.toLowerCase()).toBe('div');
    expect(descriptionWrapper?.className).toContain('text-sm text-muted-foreground mt-2');

    // Ensure no <p> tag is an ancestor of the <div> or nested <p>
    const pElements = container.querySelectorAll('p');
    pElements.forEach((p) => {
      expect(p.querySelector('p')).toBeNull();
      expect(p.querySelector('div')).toBeNull();
    });

    // Verify non-destructive modal role
    expect(screen.getByRole('dialog')).toBeDefined();

    // Assert strictly no React DOM nesting warnings or hydration errors
    const allErrors = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join(' ');
    const allWarns = consoleWarnSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join(' ');
    expect(allErrors).not.toMatch(/validateDOMNesting/i);
    expect(allErrors).not.toMatch(/cannot appear as a descendant of/i);
    expect(allErrors).not.toMatch(/cannot be a descendant of/i);
    expect(allWarns).not.toMatch(/validateDOMNesting/i);
    expect(allWarns).not.toMatch(/cannot appear as a descendant of/i);
    expect(allWarns).not.toMatch(/cannot be a descendant of/i);
  });

  it('handles confirm and cancel button clicks correctly', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Confirm Action"
        description="Action confirmation message"
        confirmText="Proceed"
        cancelText="Dismiss"
        onConfirm={handleConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard escape behavior to cancel the dialog', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Confirm Action"
        description="Testing escape key"
        onConfirm={handleConfirm}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables cancel and confirm buttons and prevents escape closing when isLoading is true', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Processing Action"
        description="Please wait while processing..."
        onConfirm={handleConfirm}
        isLoading={true}
      />
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton.hasAttribute('disabled')).toBe(true);

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleOpenChange).not.toHaveBeenCalled();
  });

  it('renders nothing when open is false', () => {
    const handleOpenChange = vi.fn();
    const handleConfirm = vi.fn();

    const { container } = render(
      <ConfirmDialog
        open={false}
        onOpenChange={handleOpenChange}
        title="Hidden Dialog"
        description="Should not be visible"
        onConfirm={handleConfirm}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Hidden Dialog')).toBeNull();
  });
});
