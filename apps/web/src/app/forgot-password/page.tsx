'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setDevResetUrl(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.')
      return
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.')
      return
    }

    setLoading(true)

    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '')
      const res = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: trimmedEmail }),
      })

      if (!res.ok) {
        if (res.status === 429) {
          setErrorMessage('Too many password reset requests. Please wait a few minutes before trying again.')
          setLoading(false)
          return
        }

        const data = await res.json().catch(() => null)
        const message =
          data?.message ||
          'Email delivery service is currently unavailable. Please check back shortly or contact support.'
        setErrorMessage(message)
        setLoading(false)
        return
      }

      // Success: generic confirmation to prevent user enumeration
      setSubmitted(true)

      // In local development, check dev mailbox for captured reset link
      if (process.env.NODE_ENV !== 'production') {
        try {
          const devRes = await fetch(`${apiUrl}/auth/dev/last-reset-link?email=${encodeURIComponent(trimmedEmail)}`)
          if (devRes.ok) {
            const devData = await devRes.json()
            if (devData.resetUrl) {
              setDevResetUrl(devData.resetUrl)
            }
          }
        } catch {
          // Dev inspection endpoint is optional
        }
      }
    } catch {
      setErrorMessage(
        'Unable to contact the authentication server. Please check your network connection and try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Forgot Password</CardTitle>
          <CardDescription className="text-center">
            {submitted
              ? 'Check your email for reset instructions'
              : 'Enter your email address and we will send you a link to reset your password.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col gap-4 text-center">
              <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md text-sm">
                If an account exists for <strong>{email}</strong>, password-reset instructions have been sent.
                Please check your inbox and spam folder.
              </div>

              {devResetUrl && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-xs text-left">
                  <span className="font-semibold block mb-1">Local Development Mailer (In-Memory Capture):</span>
                  A reset email was captured by the in-memory development mailer (no external email sent). You can inspect and test the link directly:
                  <div className="mt-2">
                    <Link
                      href={devResetUrl}
                      className="inline-block px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 transition-colors"
                    >
                      Open Reset Password Link &rarr;
                    </Link>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-500">
                For security reasons, reset links expire in 60 minutes.
              </p>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md text-center"
                >
                  {errorMessage}
                </div>
              )}

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? 'Sending Instructions...' : 'Send Reset Link'}
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
    </div>
  )
}
