import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const signup = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback`,
      },
    })

    if (error) {
      return redirect('/signup?message=Could not create user')
    }

    return redirect('/login?message=Check email to continue sign in process')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Sign Up</h1>
        <form className="flex flex-col gap-4 w-64">
          <input className="border p-2" name="email" placeholder="Email" required />
          <input className="border p-2" type="password" name="password" placeholder="Password" required />
          <button className="bg-green-500 text-white p-2 rounded" formAction={signup}>Sign Up</button>
        </form>
        <p className="mt-4">
          Already have an account? <Link href="/login" className="text-blue-500">Log In</Link>
        </p>
      </main>
    </div>
  )
}
