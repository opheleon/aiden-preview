import type { Product } from './index.js';

/** Use the scoped title, or a bounded scope excerpt for projects saved before titles existed. */
export function scopeName(context: string, product?: Pick<Product, 'title' | 'overview'>): string {
  if (product?.title) return product.title;
  const text = (product?.overview || context).replace(/\s+/g, ' ').trim();
  const sentence = text.split(/[.!?](?:\s|$)/)[0] || text;
  // Long legacy overviews often continue from the outcome into implementation or constraints.
  const outcome = sentence.split(/\s+(?:by \w+ing|without|while|so that)\b/i)[0]!;
  if (outcome.length >= 20 && outcome.length <= 72) return outcome;
  if (!sentence) return 'New project';
  if (sentence.length <= 72) return sentence;
  const excerpt = sentence.slice(0, 71).replace(/\s+\S*$/, '');
  return `${excerpt}…`;
}
