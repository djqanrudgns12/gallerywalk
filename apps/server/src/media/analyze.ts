import sharp from 'sharp';
import { config } from '@gallery/core/config';
import { estimateLinePitch } from '@gallery/core/pages';
import type { ImageAnalysisWire } from '@gallery/core/types';

export interface ImagePixels {
  readonly data: Buffer;
  readonly w: number;
  readonly h: number;
}

/** JSON으로 저장한다(`@gallery/core/types`의 `ImageAnalysisWire`). `profileBinPx`와 `linePitchPx`는 회전한 원본 좌표다. */
export type ImageAnalysis = ImageAnalysisWire;

/** 투명 화소가 임의의 RGB값으로 밝기·줄 활동량을 바꾸지 않도록 흰 바탕에서 잰다. */
function luma(data: Buffer, index: number): number {
  const alpha = data[index + 3]! / 255;
  return (
    (0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!) * alpha +
    255 * (1 - alpha)
  );
}

export async function analyzeImage(input: ImagePixels, includeProfile = false): Promise<ImageAnalysis> {
  const scale = Math.min(1, config().LINE_PITCH_MAX_SHORT_PX / Math.min(input.w, input.h));
  const w = Math.max(1, Math.round(input.w * scale));
  const h = Math.max(1, Math.round(input.h * scale));
  const data =
    scale === 1
      ? input.data
      : await sharp(input.data, {
          raw: { width: input.w, height: input.h, channels: 4 },
        })
          .resize(w, h, { fit: 'fill' })
          .raw()
          .toBuffer();
  const horizontal = w > h;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const edgeW = Math.max(1, Math.ceil(w * config().ANALYSIS_EDGE_RATIO));
  const edgeH = Math.max(1, Math.ceil(h * config().ANALYSIS_EDGE_RATIO));
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < edgeW || x >= w - edgeW || y < edgeH || y >= h - edgeH) {
        edgeSum += luma(data, (y * w + x) * 4);
        edgeCount++;
      }
    }
  }

  const inset = Math.ceil(short * config().ANALYSIS_BORDER_RATIO);
  const activity = new Float64Array(long);
  const at = (axis: number, cross: number): number =>
    luma(data, (horizontal ? cross * w + axis : axis * w + cross) * 4);
  for (let axis = 1; axis < long; axis++) {
    let sum = 0;
    for (let cross = inset; cross < short - inset; cross++) {
      const value = at(axis, cross);
      sum += Math.abs(value - at(axis - 1, cross)) + Math.abs(value - at(axis, cross - 1));
    }
    activity[axis] = sum;
  }
  const { pitch, confidence } = estimateLinePitch(activity);
  const sourceLong = Math.max(input.w, input.h);
  // 긴 그림의 끝을 버리지 않는다. 보통 8px, 칸 수 상한을 넘으면 8px의 정수배다.
  const profileBinPx =
    config().PROFILE_BIN_PX *
    Math.max(1, Math.ceil(sourceLong / (config().PROFILE_MAX_BINS * config().PROFILE_BIN_PX)));
  let lineProfile: string | null = null;
  if (includeProfile || pitch !== null) {
    const bins = new Float64Array(Math.ceil(sourceLong / profileBinPx));
    const counts = new Uint32Array(bins.length);
    const axisScale = long / sourceLong;
    for (let i = 0; i < activity.length; i++) {
      const bin = Math.min(bins.length - 1, Math.floor(i / axisScale / profileBinPx));
      bins[bin] = bins[bin]! + activity[i]!;
      counts[bin] = counts[bin]! + 1;
    }
    let maximum = 0;
    for (let i = 0; i < bins.length; i++) {
      bins[i] = bins[i]! / Math.max(1, counts[i]!);
      maximum = Math.max(maximum, bins[i]!);
    }
    lineProfile = Buffer.from(
      bins.map(value => (maximum > 0 ? Math.round((value / maximum) * 255) : 0)),
    ).toString('base64');
  }
  return {
    edgeLuma: edgeSum / edgeCount / 255,
    linePitchPx: pitch === null ? null : (pitch * sourceLong) / long,
    linePitchConfidence: confidence,
    lineProfile,
    profileBinPx,
  };
}
