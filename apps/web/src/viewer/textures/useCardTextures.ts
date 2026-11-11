import type { TemplateLook } from '@gallery/core/templates';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Texture } from 'three';
import { type CardText, makeCardTexture } from './textCard.ts';

/**
 * 글 카드·소리 명판 텍스처(PLAN §5.7): 그리는 관에 걸린 것만 만들고, 관을 떼면 놓는다(상주 관리와 같은 뜻 — GPU를 작게).
 * 만든 것은 `renderer.initTexture`로 바로 올린다(첫 프레임에 올리느라 멈칫하지 않게).
 */
export interface CardTarget {
  readonly id: string;
  /** 그림 면 가로 ÷ 세로 */
  readonly aspect: number;
}

export const useCardTextures = (
  cards: ReadonlyMap<string, CardText> | null,
  targets: readonly CardTarget[],
  colors: TemplateLook['card'],
): ReadonlyMap<string, Texture> => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const made = useRef(new Map<string, Texture>());
  /** 만든 카드의 글 서명(글을 고치면 다시 그림) */
  const sigs = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  /** 지금 원하는 카드(받는 중에 관이 바뀌어도 끝난 뒤 이것으로 판단) */
  const wanted = useRef(new Set<string>());
  const mounted = useRef(true);
  const [shown, setShown] = useState<ReadonlyMap<string, Texture>>(new Map());
  const key = targets.map(t => t.id).join('|');
  // 같은 작품이어도 글이 바뀌면 다시 돈다(`cards`가 새 Map이면 이미 다시 돔 — 서명으로 바뀐 것만 다시 그림)

  useEffect(() => {
    if (!cards) return;
    const want = new Set(targets.map(t => t.id).filter(id => cards.has(id)));
    wanted.current = want;
    // 떼어 낸 관의 카드는 놓는다(그 액자는 이미 사라졌다)
    let changed = false;
    const sigOf = (t: CardTarget): string => `${JSON.stringify(cards.get(t.id))}|${t.aspect.toFixed(4)}`;
    const sigNow = new Map(targets.filter(t => want.has(t.id)).map(t => [t.id, sigOf(t)]));
    for (const [id, tex] of made.current)
      if (!want.has(id) || sigs.current.get(id) !== sigNow.get(id)) {
        tex.dispose();
        made.current.delete(id);
        sigs.current.delete(id);
        changed = true;
      }
    if (changed) setShown(new Map(made.current));
    for (const t of targets) {
      const text = cards.get(t.id);
      if (!text || made.current.has(t.id) || pending.current.has(t.id)) continue;
      pending.current.add(t.id);
      const sig = sigOf(t);
      void makeCardTexture(text, t.aspect, colors).then(tex => {
        pending.current.delete(t.id);
        // 떠났거나 · 더 원하지 않거나 · 이미 같은 카드가 있으면(StrictMode가 두 번 부름) 버린다
        if (!mounted.current || !wanted.current.has(t.id) || made.current.has(t.id)) {
          tex.dispose();
          return;
        }
        gl.initTexture(tex);
        made.current.set(t.id, tex);
        sigs.current.set(t.id, sig);
        setShown(new Map(made.current));
        invalidate();
      });
    }
    // 목록 내용(`key`)이 같으면 다시 하지 않는다(`targets`는 key로 대신)
  }, [cards, key, colors, gl, invalidate]);

  // 장면을 떠나면 모두 놓는다(StrictMode가 다시 붙이면 다시 만든다)
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const tex of made.current.values()) tex.dispose();
      made.current.clear();
      sigs.current.clear();
      pending.current.clear();
    };
  }, []);
  return shown;
};
