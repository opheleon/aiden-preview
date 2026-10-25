// Adapted from shadcn/ui (https://ui.shadcn.com), MIT License, Copyright (c) 2023 shadcn.
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, JSX } from 'react';
import { useRef } from 'react';

import { cn } from '../../lib/utils';

/** Root of a dropdown menu. Radix supplies arrow-key focus, typeahead, Escape, and outside click. */
export function DropdownMenu(
  props: ComponentProps<typeof DropdownMenuPrimitive.Root>,
): JSX.Element {
  return <DropdownMenuPrimitive.Root {...props} />;
}

/** The button that opens the menu; Radix sets its aria-expanded and aria-haspopup. */
export function DropdownMenuTrigger(
  props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
): JSX.Element {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

/**
 * The menu panel, portalled to the document body and placed beside its trigger, flipping or
 * shifting to stay inside the window. It fades, zooms, and slides in from the trigger's side.
 * Clicks on its own trigger are left to the trigger, so reopening the menu while the last panel
 * is still fading out keeps the new menu open.
 */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  onInteractOutside,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.Content>, 'ref'>): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        {...props}
        ref={panel}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          // Radix keeps a closing panel mounted until its exit animation ends and reuses it when
          // the menu reopens, so the trigger click that reopened it would also dismiss it. The
          // trigger already toggles the menu on its own, as Radix Popover does for its trigger.
          const triggerId = panel.current?.getAttribute('aria-labelledby');
          const trigger = triggerId ? document.getElementById(triggerId) : null;
          if (event.target instanceof Node && trigger?.contains(event.target))
            event.preventDefault();
        }}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * One menu action. It highlights while hovered or focused by arrow keys; the destructive variant
 * is drawn in the danger color.
 */
export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** Use `destructive` for an action that ends or removes something. */
  variant?: 'default' | 'destructive';
}): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/** A thin line between groups of menu actions. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
