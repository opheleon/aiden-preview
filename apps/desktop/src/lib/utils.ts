import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names for shadcn/ui components. A later Tailwind utility replaces a conflicting
 * earlier one, so a caller's `w-[720px]` overrides a component's default width.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
