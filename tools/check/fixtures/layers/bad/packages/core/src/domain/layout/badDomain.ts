import { randomUUID } from 'node:crypto';
import { Vector3 } from 'three';
import { z } from 'zod';

export const schema = z.string();

export function badDomainFn(): string {
  const v = new Vector3();
  const w = window.innerWidth;
  const title = document.title;
  const env = process.env.NODE_ENV;
  return `${randomUUID()}-${v.x}-${w}-${title}-${String(env)}`;
}
