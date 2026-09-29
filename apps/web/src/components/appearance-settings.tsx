"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch by only rendering after mounting
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    // Render a placeholder or nothing during SSR
    return (
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how CallFlow looks on your device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 opacity-50">
            <Button variant="outline" disabled>Light</Button>
            <Button variant="outline" disabled>Dark</Button>
            <Button variant="outline" disabled>System</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how CallFlow looks on your device. Your preference is saved automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          <Button
            variant={theme === "light" ? "primary" : "outline"}
            onClick={() => setTheme("light")}
            aria-label="Set Light Theme"
          >
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "primary" : "outline"}
            onClick={() => setTheme("dark")}
            aria-label="Set Dark Theme"
          >
            Dark
          </Button>
          <Button
            variant={theme === "system" ? "primary" : "outline"}
            onClick={() => setTheme("system")}
            aria-label="Use System Theme"
          >
            System
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
