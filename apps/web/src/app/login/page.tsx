import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const login = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.log('--- DIAGNOSTIC LOGIN ERROR ---');
      console.log('error.message:', error.message);
      console.log('error.status:', error.status);
      console.log('error.code:', error.code);
      console.log('data.session exists:', !!data?.session);
      console.log('data.user exists:', !!data?.user);
      console.log('------------------------------');
      return redirect('/login?message=Could not authenticate user')
    }

    return redirect('/protected')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Login</h1>
        <form className="flex flex-col gap-4 w-64">
          <input className="border p-2" name="email" placeholder="Email" required />
          <input className="border p-2" type="password" name="password" placeholder="Password" required />
          <button className="bg-blue-500 text-white p-2 rounded" formAction={login}>Log In</button>
        </form>
        <p className="mt-4">
          Don&apos;t have an account? <Link href="/signup" className="text-blue-500">Sign Up</Link>
        </p>
      </main>
    </div>
  )
}
