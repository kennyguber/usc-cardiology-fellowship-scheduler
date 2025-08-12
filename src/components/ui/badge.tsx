import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // Pastel rotation variants using design tokens
        "rot-lac-cath":
          "border-transparent bg-[hsl(var(--rot-lac-cath))] text-[hsl(var(--rot-lac-cath-foreground))] hover:bg-[hsl(var(--rot-lac-cath))]/90",
        "rot-ccu":
          "border-transparent bg-[hsl(var(--rot-ccu))] text-[hsl(var(--rot-ccu-foreground))] hover:bg-[hsl(var(--rot-ccu))]/90",
        "rot-lac-consult":
          "border-transparent bg-[hsl(var(--rot-lac-consult))] text-[hsl(var(--rot-lac-consult-foreground))] hover:bg-[hsl(var(--rot-lac-consult))]/90",
        "rot-hf":
          "border-transparent bg-[hsl(var(--rot-hf))] text-[hsl(var(--rot-hf-foreground))] hover:bg-[hsl(var(--rot-hf))]/90",
        "rot-keck-consult":
          "border-transparent bg-[hsl(var(--rot-keck-consult))] text-[hsl(var(--rot-keck-consult-foreground))] hover:bg-[hsl(var(--rot-keck-consult))]/90",
        "rot-echo1":
          "border-transparent bg-[hsl(var(--rot-echo1))] text-[hsl(var(--rot-echo1-foreground))] hover:bg-[hsl(var(--rot-echo1))]/90",
        "rot-echo2":
          "border-transparent bg-[hsl(var(--rot-echo2))] text-[hsl(var(--rot-echo2-foreground))] hover:bg-[hsl(var(--rot-echo2))]/90",
        "rot-ep":
          "border-transparent bg-[hsl(var(--rot-ep))] text-[hsl(var(--rot-ep-foreground))] hover:bg-[hsl(var(--rot-ep))]/90",
        "rot-nuclear":
          "border-transparent bg-[hsl(var(--rot-nuclear))] text-[hsl(var(--rot-nuclear-foreground))] hover:bg-[hsl(var(--rot-nuclear))]/90",
        "rot-noninvasive":
          "border-transparent bg-[hsl(var(--rot-noninvasive))] text-[hsl(var(--rot-noninvasive-foreground))] hover:bg-[hsl(var(--rot-noninvasive))]/90",
        "rot-elective":
          "border-transparent bg-[hsl(var(--rot-elective))] text-[hsl(var(--rot-elective-foreground))] hover:bg-[hsl(var(--rot-elective))]/90",
        // Fellow color variants
        f1: "border-transparent bg-[hsl(var(--fellow-1))] text-[hsl(var(--fellow-1-foreground))] hover:bg-[hsl(var(--fellow-1))]/90",
        f2: "border-transparent bg-[hsl(var(--fellow-2))] text-[hsl(var(--fellow-2-foreground))] hover:bg-[hsl(var(--fellow-2))]/90",
        f3: "border-transparent bg-[hsl(var(--fellow-3))] text-[hsl(var(--fellow-3-foreground))] hover:bg-[hsl(var(--fellow-3))]/90",
        f4: "border-transparent bg-[hsl(var(--fellow-4))] text-[hsl(var(--fellow-4-foreground))] hover:bg-[hsl(var(--fellow-4))]/90",
        f5: "border-transparent bg-[hsl(var(--fellow-5))] text-[hsl(var(--fellow-5-foreground))] hover:bg-[hsl(var(--fellow-5))]/90",
        f6: "border-transparent bg-[hsl(var(--fellow-6))] text-[hsl(var(--fellow-6-foreground))] hover:bg-[hsl(var(--fellow-6))]/90",
        f7: "border-transparent bg-[hsl(var(--fellow-7))] text-[hsl(var(--fellow-7-foreground))] hover:bg-[hsl(var(--fellow-7))]/90",
        f8: "border-transparent bg-[hsl(var(--fellow-8))] text-[hsl(var(--fellow-8-foreground))] hover:bg-[hsl(var(--fellow-8))]/90",
        f9: "border-transparent bg-[hsl(var(--fellow-9))] text-[hsl(var(--fellow-9-foreground))] hover:bg-[hsl(var(--fellow-9))]/90",
        f10: "border-transparent bg-[hsl(var(--fellow-10))] text-[hsl(var(--fellow-10-foreground))] hover:bg-[hsl(var(--fellow-10))]/90",
        f11: "border-transparent bg-[hsl(var(--fellow-11))] text-[hsl(var(--fellow-11-foreground))] hover:bg-[hsl(var(--fellow-11))]/90",
        f12: "border-transparent bg-[hsl(var(--fellow-12))] text-[hsl(var(--fellow-12-foreground))] hover:bg-[hsl(var(--fellow-12))]/90",
        f13: "border-transparent bg-[hsl(var(--fellow-13))] text-[hsl(var(--fellow-13-foreground))] hover:bg-[hsl(var(--fellow-13))]/90",
        f14: "border-transparent bg-[hsl(var(--fellow-14))] text-[hsl(var(--fellow-14-foreground))] hover:bg-[hsl(var(--fellow-14))]/90",
        f15: "border-transparent bg-[hsl(var(--fellow-15))] text-[hsl(var(--fellow-15-foreground))] hover:bg-[hsl(var(--fellow-15))]/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
