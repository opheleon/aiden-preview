import type { Product } from './index.js';

/**
 * Use the scoped title, or a bounded scope excerpt for projects saved before titles existed. With
 * `full`, a long first sentence is kept whole for places that wrap, such as the project heading.
 * Links are left out, so a goal that is only a Notion link reads "New project" until the title.
 */
export function scopeName(
  context: string,
  product?: Pick<Product, 'title' | 'overview'>,
  full = false,
): string {
  if (product?.title) return product.title;
  // A pasted link is not a name; until the scope has a title, a link-only goal is a new project.
  const text = (product?.overview || context)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A removed link can leave "in this spec:" behind; a name never ends in a colon or comma.
  const sentence = (text.split(/[.!?](?:\s|$)/)[0] || text).replace(/[\s,;:]+$/, '');
  // Long legacy overviews often continue from the outcome into implementation or constraints.
  const outcome = sentence.split(/\s+(?:by \w+ing|without|while|so that)\b/i)[0]!;
  if (outcome.length >= 20 && outcome.length <= 72) return outcome;
  if (!sentence) return 'New project';
  if (sentence.length <= 72 || full) return sentence;
  // Cut at a word and drop trailing punctuation; the sidebar fades long names at its edge.
  return sentence
    .slice(0, 71)
    .replace(/\s+\S*$/, '')
    .replace(/[\s,;:]+$/, '');
}
