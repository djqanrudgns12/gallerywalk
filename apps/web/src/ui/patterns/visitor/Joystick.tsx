import { copy } from '@gallery/core/copy';
import { type JSX, useRef, useState } from 'react';
import { stickFromOffset } from '../../../viewer/walk/input.ts';
import s from './Joystick.module.css';

export interface StickValue {
  forward: number;
  strafe: number;
  run: boolean;
}

export interface JoystickProps {
  onChange: (value: StickValue) => void;
  radius?: number | undefined;
  className?: string | undefined;
}

const ZERO_STICK: StickValue = { forward: 0, strafe: 0, run: false };

export const Joystick = ({ onChange, radius, className }: JoystickProps): JSX.Element => {
  const [knob, setKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);

  const release = (): void => {
    if (!origin.current) return;
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(ZERO_STICK);
  };

  return (
    <div
      className={className ? `${s.joystick} ${className}` : s.joystick}
      role="application"
      aria-label={copy.viewer.joystick}
      data-testid="joystick"
      onPointerDown={e => {
        e.stopPropagation();
        const pid = e.pointerId ?? 0;
        origin.current = { x: e.clientX, y: e.clientY, id: pid };
        e.currentTarget.setPointerCapture?.(pid);
        const v = stickFromOffset(0, 0, radius);
        setKnob(v.knob);
        onChange({ forward: v.forward, strafe: v.strafe, run: v.run });
      }}
      onPointerMove={e => {
        const o = origin.current;
        const pid = e.pointerId ?? 0;
        if (!o || o.id !== pid) return;
        e.stopPropagation();
        const v = stickFromOffset(e.clientX - o.x, e.clientY - o.y, radius);
        setKnob(v.knob);
        onChange({ forward: v.forward, strafe: v.strafe, run: v.run });
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={s.ring} aria-hidden="true" />
      <span className={s.tickN} aria-hidden="true" />
      <span className={s.tickS} aria-hidden="true" />
      <span className={s.tickW} aria-hidden="true" />
      <span className={s.tickE} aria-hidden="true" />
      <span
        className={s.knob}
        data-testid="joystick-knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      >
        <span className={s.knobDot} aria-hidden="true" />
      </span>
    </div>
  );
};
