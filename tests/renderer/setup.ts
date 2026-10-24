import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks native dialog behavior. Real modal/focus behavior is covered by Electron journeys.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};

// jsdom also lacks ResizeObserver, which Radix menus use to size themselves beside their trigger.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
// Radix Select also checks pointer capture and scrolls the active option into view.
for (const [name, stub] of [
  ['hasPointerCapture', () => false],
  ['releasePointerCapture', () => undefined],
  ['scrollIntoView', () => undefined],
] as const) {
  if (!(name in Element.prototype))
    Object.defineProperty(Element.prototype, name, { value: stub, configurable: true });
}
// Without PointerEvent, user-event's pointerdown carries no button, and Radix triggers ignore it.
if (!('PointerEvent' in globalThis)) {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  Object.assign(globalThis, { PointerEvent: PointerEventStub });
}
// Floating UI asks whether each ancestor is in the top layer. jsdom has none, and its selector
// engine evaluates :modal by recursing through matches(), which makes every menu open take seconds.
const nativeMatches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')!.value as (
  this: Element,
  selector: string,
) => boolean;
Element.prototype.matches = function (this: Element, selector: string): boolean {
  if (selector === ':modal' || selector === ':popover-open') return false;
  return nativeMatches.call(this, selector);
};
