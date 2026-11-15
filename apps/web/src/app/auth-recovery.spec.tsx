import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './login/page';
import ForgotPasswordPage from './forgot-password/page';
import ResetPasswordPage from './reset-password/page';

// Mock navigation
const mockSearchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (param: string) => mockSearchParams.get(param) || null,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  redirect: vi.fn(),
}));

// Mock Supabase
vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: vi.fn(),
    },
  }),
}));

describe('Auth Password Recovery Flow (Frontend UI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.clear();
    // Default fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Sign In Page', () => {
    it('1. Forgot Password link is visible on Sign In page and links to /forgot-password', async () => {
      const pageJsx = await LoginPage({ searchParams: Promise.resolve({}) });
      render(pageJsx);

      const forgotLink = screen.getByText('Forgot password?');
      expect(forgotLink).toBeDefined();
      expect(forgotLink.getAttribute('href')).toBe('/forgot-password');
      expect(forgotLink.className).toContain('text-blue-600');
    });
  });

  describe('Forgot Password Page', () => {
    it('2. Renders email input, submit button, and back to login link', () => {
      render(<ForgotPasswordPage />);

      expect(screen.getByRole('heading', { name: 'Forgot Password' })).toBeDefined();
      expect(screen.getByLabelText(/Email/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeDefined();
      const loginLink = screen.getByRole('link', { name: /Log In/i });
      expect(loginLink.getAttribute('href')).toBe('/login');
    });

    it('3. Validates email format before submission', async () => {
      const { container } = render(<ForgotPasswordPage />);

      const emailInput = screen.getByLabelText('Email');
      const form = container.querySelector('form')!;

      // Bad email
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid email address.')).toBeDefined();
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('4. Submits request and renders generic success state without revealing registration status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Instructions sent' }),
      });

      render(<ForgotPasswordPage />);

      const emailInput = screen.getByLabelText(/Email/i);
      const submitBtn = screen.getByRole('button', { name: 'Send Reset Link' });

      fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/If an account exists for/i),
        ).toBeDefined();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/forgot-password'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com' }),
        }),
      );
    });

    it('5. Handles server/network failure gracefully with error alert', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      render(<ForgotPasswordPage />);

      const emailInput = screen.getByLabelText(/Email/i);
      const submitBtn = screen.getByRole('button', { name: 'Send Reset Link' });

      fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/Unable to contact the authentication server/i),
        ).toBeDefined();
      });
    });
  });

  describe('Reset Password Page', () => {
    it('6. Displays missing token error message when URL has no token', () => {
      mockSearchParams.delete('token');
      render(<ResetPasswordPage />);

      expect(screen.getByText('Missing Reset Token')).toBeDefined();
      expect(
        screen.getByRole('link', { name: 'Request New Reset Link' }),
      ).toBeDefined();
    });

    it('7. Displays password fields and toggles visibility when token is present', () => {
      mockSearchParams.set('token', 'valid-reset-token-123');
      render(<ResetPasswordPage />);

      const passwordInput = screen.getByLabelText('New Password') as HTMLInputElement;
      const confirmInput = screen.getByLabelText('Confirm Password') as HTMLInputElement;

      expect(passwordInput.type).toBe('password');
      expect(confirmInput.type).toBe('password');

      // Click show password button
      const showPasswordBtn = screen.getByLabelText('Show password');
      fireEvent.click(showPasswordBtn);
      expect(passwordInput.type).toBe('text');
    });

    it('8. Validates password length and matching confirmation before submitting', async () => {
      mockSearchParams.set('token', 'valid-reset-token-123');
      const { container } = render(<ResetPasswordPage />);

      const passwordInput = screen.getByLabelText('New Password');
      const confirmInput = screen.getByLabelText('Confirm Password');
      const form = container.querySelector('form')!;

      // Mismatch
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password456' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match.')).toBeDefined();
      });

      // Too short (< 6 chars)
      fireEvent.change(passwordInput, { target: { value: '123' } });
      fireEvent.change(confirmInput, { target: { value: '123' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(
          screen.getByText('Password must be at least 6 characters long.'),
        ).toBeDefined();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('9. Handles invalid/expired token response from server with useful message and recovery link', async () => {
      mockSearchParams.set('token', 'expired-token');
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'This password reset token has expired' }),
      });

      const { container } = render(<ResetPasswordPage />);

      const passwordInput = screen.getByLabelText('New Password');
      const confirmInput = screen.getByLabelText('Confirm Password');
      const form = container.querySelector('form')!;

      fireEvent.change(passwordInput, { target: { value: 'newpassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'newpassword123' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(
          screen.getByText('This password reset token has expired'),
        ).toBeDefined();
        expect(
          screen.getByRole('link', { name: 'Request a new password reset link' }),
        ).toBeDefined();
      });
    });

    it('10. Shows success state and link back to Sign In after successful password reset', async () => {
      mockSearchParams.set('token', 'valid-token');
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Password has been reset' }),
      });

      const { container } = render(<ResetPasswordPage />);

      const passwordInput = screen.getByLabelText('New Password');
      const confirmInput = screen.getByLabelText('Confirm Password');
      const form = container.querySelector('form')!;

      fireEvent.change(passwordInput, { target: { value: 'brandNewPassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'brandNewPassword123' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Password Reset Complete')).toBeDefined();
        const loginBtn = screen.getByRole('link', { name: 'Go to Log In' });
        expect(loginBtn.getAttribute('href')).toBe('/login');
      });
    });
  });
});
