'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // If no token is provided in URL
  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center text-red-600">Missing Reset Token</CardTitle>
          <CardDescription className="text-center">
            No password reset token was provided in the link.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-center">
          <p className="text-sm text-gray-600">
            Please make sure you clicked the full link sent to your email, or request a new password reset.
          </p>
          <Link
            href="/forgot-password"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover h-10 px-4 py-2 w-full"
          >
            Request New Reset Link
          </Link>
        </CardContent>
        <CardFooter className="justify-center">
          <Link href="/login" className="text-sm text-blue-600 hover:underline">
            Back to Log In
          </Link>
        </CardFooter>
      </Card>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
      const res = await fetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          password,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        // Helpful message for invalid, expired, or already-used tokens
        const msg = data?.message || 'Failed to reset password. The link may have expired or already been used.'
        setErrorMessage(msg)
        setLoading(false)
        return
      }

      setSuccess(true)
    } catch {
      setErrorMessage('Unable to connect to the authentication server. Please check your internet connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          {success ? 'Password Reset Complete' : 'Reset Your Password'}
        </CardTitle>
        <CardDescription className="text-center">
          {success
            ? 'Your password has been successfully updated.'
            : 'Enter and confirm your new password below.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="flex flex-col gap-4 text-center">
            <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md text-sm">
              Your password has been changed. You can now use your new password to sign in.
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover h-10 px-4 py-2 w-full mt-2"
            >
              Go to Log In
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500">Minimum 6 characters</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md text-center"
              >
                {errorMessage}
                {(errorMessage.toLowerCase().includes('expired') ||
                  errorMessage.toLowerCase().includes('already been used') ||
                  errorMessage.toLowerCase().includes('invalid')) && (
                  <div className="mt-2">
                    <Link
                      href="/forgot-password"
                      className="text-xs text-blue-600 font-semibold underline hover:text-blue-800"
                    >
                      Request a new password reset link
                    </Link>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" className="w-full mt-2" disabled={loading}>
              {loading ? 'Updating Password...' : 'Reset Password'}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-gray-600">
          Remember your password?{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            Log In
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <Suspense
        fallback={
          <div className="text-gray-500 text-sm">Loading reset form...</div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
