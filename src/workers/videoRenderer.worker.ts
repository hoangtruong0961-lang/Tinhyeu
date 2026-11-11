import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  VideoCodec,
  AudioCodec,
} from 'mediabunny';
import { SubtitleItem, SubtitleStyleConfig } from '../types';
import { wrapSubtitleText } from '../utils/srtParser';

let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let output: Output | null = null;
let target: BufferTarget | null = null;
let videoSource: EncodedVideoPacketSource | null = null;
let audioSource: EncodedAudioPacketSource | null = null;
let videoEncoder: VideoEncoder | null = null;
let videoEncoderError: any = null;
let audioEncoder: AudioEncoder | null = null;
let fontsLoaded = false;
let pendingAddPromises: Promise<void>[] = [];
let lastEncodedTimestampUs: number | null = null;
let framerate = 30;
let frameDurationUs = 33333;
let alignedWidth = 1280;
let alignedHeight = 720;

// Preload custom fonts into the worker's FontFaceSet to prevent falling back to standard thin fonts
async function loadCustomFonts() {
  if (fontsLoaded) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    try {
      const fonts = [
        { family: 'Plus Jakarta Sans', url: 'https://fonts.gstatic.com/s/plusjakartasans/v8/L0x9DFM0_VJNtXg7FIdC7K3uyX4nyqHNNiV9694t1A3G8g.woff2' },
        { family: 'Roboto', url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2' },
        { family: 'Playfair Display', url: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD7K327Spv37f968DGpY1rad7gMW30ey87iU.woff2' },
        { family: 'Montserrat', url: 'https://fonts.gstatic.com/s/montserrat/v25/JTUSjIg1_i6t8kCHKm459W1hyyTh89ZNpQ.woff2' }
      ];
      for (const f of fonts) {
        try {
          const fontFace = new FontFace(f.family, `url(${f.url})`, { weight: 'bold' });
          await fontFace.load();
          (self as any).fonts.add(fontFace);
        } catch (e) {
          // Ignore individual load failures
        }
      }
      fontsLoaded = true;
    } catch (err) {
      console.warn('[Worker] Failed to load custom web fonts:', err);
    }
  }
}

const loadedCustomFontNames = new Set<string>();

async function loadUploadedFonts(customUploadedFonts?: { family: string; dataUrl: string }[]) {
  if (!customUploadedFonts || customUploadedFonts.length === 0) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    for (const font of customUploadedFonts) {
      if (loadedCustomFontNames.has(font.family)) continue;
      try {
        const fontFace = new FontFace(font.family, `url(${font.dataUrl})`);
        const loaded = await fontFace.load();
        (self as any).fonts.add(loaded);
        loadedCustomFontNames.add(font.family);
      } catch (e) {
        console.warn('[Worker] Failed to load custom uploaded font:', font.family, e);
      }
    }
  }
}

function getBgColorWithOpacity(hexColor: string, opacity: number = 65): string {
  if (!hexColor) return `rgba(0, 0, 0, ${opacity / 100})`;
  if (hexColor.startsWith('rgba')) return hexColor;
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const num = parseInt(hex, 16);
  if (isNaN(num)) return `rgba(0, 0, 0, ${opacity / 100})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
}

function wrapCanvasText(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const metrics = context.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function drawSubtitleOverlay(
  context: OffscreenCanvasRenderingContext2D,
  imageBitmap: ImageBitmap | VideoFrame,
  vWidth: number,
  vHeight: number,
  curTime: number,
  subtitles: SubtitleItem[],
  styleConfig: SubtitleStyleConfig
) {
  // 1. Draw base video frame
  context.drawImage(imageBitmap, 0, 0, vWidth, vHeight);

  // 2. Mask original subtitles if requested
  if (styleConfig.maskOriginalSubtitles) {
    context.fillStyle = styleConfig.maskColor || 'rgba(0, 0, 0, 0.75)';
    const maskY =
      vHeight * (1 - (styleConfig.bottomOffsetPercentage || 12) / 100) -
      vHeight * 0.08;
    const maskH = vHeight * 0.14;
    context.fillRect(0, Math.max(0, maskY), vWidth, maskH);
  }

  // 3. Find active subtitle item
  const activeSub = subtitles.find(
    (s) => curTime >= s.startTime && curTime <= s.endTime
  );

  if (!activeSub) return;

  let rawText = activeSub.translatedText || activeSub.originalText || '';

  // Apply text transformation (casing)
  if (styleConfig.textTransform === 'uppercase') {
    rawText = rawText.toUpperCase();
  } else if (styleConfig.textTransform === 'lowercase') {
    rawText = rawText.toLowerCase();
  } else if (styleConfig.textTransform === 'capitalize') {
    rawText = rawText.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Align style configurations & fallback defaults with VideoPlayer.tsx perfectly
  const defaultFontSize = styleConfig.fontSize || 22;
  const defaultPadding = styleConfig.padding || 6;
  const defaultBorderRadius = styleConfig.borderRadius ?? 8;
  const bgOpacity = styleConfig.bgOpacity ?? 65;

  // Calculate font size relative to standard 720p height
  const scaleFactor = vHeight / 720;
  const baseFontSize = defaultFontSize * scaleFactor;
  // Proportional minimum font size (10px on 360p corresponds to 20px on 720p)
  const minFontSize = Math.max(12, Math.round(20 * scaleFactor));
  const fontSize = Math.max(minFontSize, Math.round(baseFontSize));

  const fontFamily = styleConfig.fontFamily || 'system-ui, sans-serif';
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';

  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const lineHeight = fontSize * 1.35;
  const padding = defaultPadding * scaleFactor;

  const isVertical = styleConfig.orientation === 'vertical';
  // Align subtitle positioning with VideoPlayer preview 100%
  const displayBox = activeSub.boundingBox || (styleConfig as any).roi || { x: 10, y: 76, width: 80, height: 20 };
  
  const parentX = (displayBox.x / 100) * vWidth;
  const parentY = (displayBox.y / 100) * vHeight;
  const parentWidth = (displayBox.width / 100) * vWidth;
  const parentHeight = (displayBox.height / 100) * vHeight;

  // Word wrap based on orientation
  const maxSafeWidth = vWidth * 0.94;
  const wrapWidth = isVertical
    ? Math.max(40, parentWidth - padding * 2.5)
    : Math.max(100, Math.max(parentWidth, maxSafeWidth) - padding * 2.5);
  const maxH = styleConfig.maxCharsHorizontal || 65;
  const maxV = styleConfig.maxCharsVertical || 36;
  const orientation = styleConfig.orientation || 'horizontal';
  const charWrapped = wrapSubtitleText(rawText || '', orientation, maxH, maxV);
  const charLines = charWrapped.split('\n');
  const lines: string[] = [];
  for (const cLine of charLines) {
    if (isVertical) {
      lines.push(...(cLine.split(/\s+/).filter(Boolean)));
    } else {
      lines.push(...wrapCanvasText(context, cLine, wrapWidth));
    }
  }
  if (!lines || lines.length === 0) return;

  // Calculate actual content dimensions
  let maxLineWidth = 0;
  lines.forEach((line) => {
    const w = context.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  });

  const totalTextHeight = lines.length * lineHeight;
  const boxWidth = Math.min(vWidth - padding * 2, maxLineWidth + padding * 2.5);
  const boxHeight = Math.max(parentHeight, totalTextHeight + padding * 1.5);

  // Exact center of the bounding box
  const centerX = parentX + parentWidth / 2;
  const boxX = Math.max(padding, Math.min(vWidth - boxWidth - padding, centerX - boxWidth / 2));
  const boxY = parentY - (lines.length - 1) * lineHeight;

  // Draw Subtitle Background Box with proper alpha/opacity parsing
  if (styleConfig.hasBackground !== false && styleConfig.backgroundColor) {
    context.fillStyle = getBgColorWithOpacity(styleConfig.backgroundColor, bgOpacity);
    const radius = defaultBorderRadius * scaleFactor;

    context.beginPath();
    if (typeof (context as any).roundRect === 'function') {
      (context as any).roundRect(boxX, boxY, boxWidth, boxHeight, radius);
    } else {
      context.rect(boxX, boxY, boxWidth, boxHeight);
    }
    context.fill();
  }

  // Draw Text Lines inside box
  let drawX = boxX + boxWidth / 2;
  const align = styleConfig.textAlign || 'center';
  if (align === 'left') drawX = boxX + padding;
  else if (align === 'right') drawX = boxX + boxWidth - padding;

  const startY = boxY + padding + fontSize * 0.52;

  lines.forEach((line, idx) => {
    const lineY = startY + idx * lineHeight;

    // 1. Text Shadow / Glow
    if (styleConfig.textShadowColor) {
      context.save();
      context.shadowColor = styleConfig.textShadowColor;
      context.shadowBlur = (styleConfig.textShadowBlur ?? 8) * scaleFactor;
      context.shadowOffsetX = (styleConfig.textShadowOffsetX ?? 0) * scaleFactor;
      context.shadowOffsetY = (styleConfig.textShadowOffsetY ?? 2) * scaleFactor;
      context.fillStyle = styleConfig.fontColor || '#ffffff';
      context.fillText(line, drawX, lineY);
      context.restore();
    } else if (styleConfig.textOutline !== false) {
      context.save();
      context.shadowColor = 'rgba(0,0,0,0.85)';
      context.shadowBlur = 6 * scaleFactor;
      context.shadowOffsetY = 3 * scaleFactor;
      context.fillStyle = styleConfig.fontColor || '#ffffff';
      context.fillText(line, drawX, lineY);
      context.restore();
    }

    // Primary Text Outline (Stroke)
    if (styleConfig.textOutline !== false && (styleConfig.outlineWidth ?? 3) > 0) {
      context.strokeStyle = styleConfig.outlineColor || '#000000';
      const outlineWidth = styleConfig.outlineWidth ?? 3;
      context.lineWidth = Math.max(0.5, outlineWidth * 2 * scaleFactor);
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeText(line, drawX, lineY);
    }

    // 4. Main Text Fill
    context.fillStyle = styleConfig.fontColor || '#ffffff';
    context.fillText(line, drawX, lineY);
  });
}

let isInitialized = false;
let isInitializing = false;
let isProcessingQueue = false;
const messageQueue: MessageEvent[] = [];

async function flushMessageQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const nextMsg = messageQueue.shift()!;
    try {
      await processMessage(nextMsg);
    } catch (err: any) {
      console.error('[VideoRendererWorker] Error processing message in queue:', err);
    }
  }
  isProcessingQueue = false;
}

async function processMessage(e: MessageEvent) {
  const { type } = e.data;

  if (type === 'INIT') {
    const {
      vWidth,
      vHeight,
      videoCodec,
      muxerVideoCodec,
      audioConfig,
    } = e.data;

    framerate = e.data.framerate || 30;
    frameDurationUs = 1_000_000 / framerate;

    try {
      pendingAddPromises = [];
      lastEncodedTimestampUs = null; // Reset for new video render

      // Ensure width & height are even integers (divisible by 2) required by H.264/WebCodecs
      alignedWidth = Math.max(2, Math.floor(vWidth / 2) * 2);
      alignedHeight = Math.max(2, Math.floor(vHeight / 2) * 2);

      offscreenCanvas = new OffscreenCanvas(alignedWidth, alignedHeight);
      ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        throw new Error('OffscreenCanvas 2D context creation failed');
      }

      target = new BufferTarget();

      const videoCodecName: VideoCodec = (muxerVideoCodec === 'avc' || muxerVideoCodec === 'hevc' || muxerVideoCodec === 'vp9' || muxerVideoCodec === 'av1' || muxerVideoCodec === 'vp8')
        ? muxerVideoCodec
        : 'avc';

      videoSource = new EncodedVideoPacketSource(videoCodecName);

      const hasAudio = !!audioConfig;
      if (hasAudio) {
        const audioCodecName: AudioCodec = (audioConfig.audioMuxerCodec === 'aac' || audioConfig.audioMuxerCodec === 'opus' || audioConfig.audioMuxerCodec === 'mp3')
          ? audioConfig.audioMuxerCodec
          : 'aac';
        audioSource = new EncodedAudioPacketSource(audioCodecName);
      }

      output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
      });

      output.addVideoTrack(videoSource);
      if (hasAudio && audioSource) {
        output.addAudioTrack(audioSource);
      }

      await output.start();

      const preferSoftware = e.data.preferSoftware === true;

      videoEncoderError = null;
      videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          if (videoSource) {
            try {
              const packet = EncodedPacket.fromEncodedChunk(chunk);
              const p = videoSource.add(packet, meta).catch((err) => {
                console.warn('[VideoRendererWorker] videoSource.add warning:', err);
              });
              pendingAddPromises.push(p);
            } catch (err) {
              console.warn('[VideoRendererWorker] EncodedPacket creation warning:', err);
            }
          }
        },
        error: (err: any) => {
          const errMsg = `VideoEncoder error (${err?.name || 'Error'}): ${err?.message || String(err)}`;
          console.error('[VideoRendererWorker] ' + errMsg, err);
          videoEncoderError = err;
          self.postMessage({ type: 'ERROR', error: errMsg });
        },
      });

      let encConfig: VideoEncoderConfig = {
        codec: videoCodec,
        width: alignedWidth,
        height: alignedHeight,
        displayWidth: alignedWidth,
        displayHeight: alignedHeight,
        bitrate: e.data.bitrate || 5_000_000,
        framerate: Math.max(1, framerate),
        hardwareAcceleration: preferSoftware ? 'prefer-software' : 'no-preference',
      };

      if (videoCodec.startsWith('avc1') || videoCodec.startsWith('avc')) {
        (encConfig as any).avc = { format: 'avc' };
      }

      if (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function') {
        try {
          let res = await VideoEncoder.isConfigSupported(encConfig);
          console.log(`[VideoRendererWorker Probing] Mode: ${encConfig.hardwareAcceleration} | Codec: ${videoCodec} | Supported: ${res.supported}`);
          if (!res.supported) {
            // Try resolution-appropriate profile levels for software/hardware fallback
            const isHighRes = Math.max(alignedWidth, alignedHeight) >= 1080;
            const fallbackCodecs = isHighRes
              ? ['avc1.4d002a', 'avc1.42002a', 'avc1.64002a', 'vp09.00.10.08']
              : ['avc1.4d001f', 'avc1.42001f', 'avc1.42002a', 'vp09.00.10.08'];

            for (const fbCodec of fallbackCodecs) {
              const testConfig: VideoEncoderConfig = {
                codec: fbCodec,
                width: alignedWidth,
                height: alignedHeight,
                displayWidth: alignedWidth,
                displayHeight: alignedHeight,
                bitrate: Math.min(e.data.bitrate || 4_000_000, 8_000_000),
                framerate: Math.max(1, framerate),
                hardwareAcceleration: 'prefer-software',
              };
              if (fbCodec.startsWith('avc1') || fbCodec.startsWith('avc')) {
                (testConfig as any).avc = { format: 'avc' };
              }
              const testRes = await VideoEncoder.isConfigSupported(testConfig);
              if (testRes.supported) {
                encConfig = { ...testConfig, ...(testRes.config || {}) };
                console.log(`[VideoRendererWorker Probing Fallback] Selected fallback codec: ${fbCodec}`);
                break;
              }
            }
          } else if (res.config) {
            encConfig = { ...encConfig, ...res.config };
          }
        } catch (probeErr) {
          console.warn('[VideoRendererWorker Probing Error]:', probeErr);
        }
      }

      try {
        videoEncoder.configure(encConfig);
      } catch (cfgErr) {
        console.warn('[VideoRendererWorker] VideoEncoder.configure failed with primary config, retrying with fallback:', cfgErr);
        const isHighRes = Math.max(alignedWidth, alignedHeight) >= 1080;
        const fallbackConfig: VideoEncoderConfig = {
          codec: isHighRes ? 'avc1.4d002a' : 'avc1.4d001f',
          width: alignedWidth,
          height: alignedHeight,
          displayWidth: alignedWidth,
          displayHeight: alignedHeight,
          bitrate: Math.min(e.data.bitrate || 4_000_000, 6_000_000),
          framerate: Math.max(1, framerate),
          hardwareAcceleration: 'prefer-software',
        };
        (fallbackConfig as any).avc = { format: 'avc' };
        videoEncoder.configure(fallbackConfig);
      }

      if (videoEncoder.state !== 'configured') {
        throw new Error(`VideoEncoder is not in 'configured' state (current state: ${videoEncoder.state})`);
      }

      if (hasAudio) {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => {
            if (audioSource) {
              try {
                const packet = EncodedPacket.fromEncodedChunk(chunk);
                const p = audioSource.add(packet, meta).catch((err) => {
                  console.warn('[VideoRendererWorker] audioSource.add warning:', err);
                });
                pendingAddPromises.push(p);
              } catch (err) {
                console.warn('[VideoRendererWorker] EncodedPacket creation warning:', err);
              }
            }
          },
          error: (err: any) => {
            const errMsg = `AudioEncoder error (${err?.name || 'Error'}): ${err?.message || String(err)}`;
            console.error('[VideoRendererWorker] ' + errMsg, err);
            videoEncoderError = err;
            self.postMessage({ type: 'ERROR', error: errMsg });
          },
        });

        audioEncoder.configure({
          codec: audioConfig.audioCodecStr,
          numberOfChannels: audioConfig.channels,
          sampleRate: audioConfig.sampleRate,
          bitrate: 128_000,
          ...(audioConfig.audioMuxerCodec === 'aac' ? { aac: { format: 'aac' } } : {}),
        });
      }

      isInitialized = true;
      isInitializing = false;
      self.postMessage({ type: 'INIT_SUCCESS' });
    } catch (err: any) {
      isInitializing = false;
      isInitialized = false;
      self.postMessage({ type: 'ERROR', error: err?.message || 'Init worker failed' });
    }
  } else if (type === 'ENCODE_AUDIO_DATA') {
    const { sampleRate, channels, numberOfFrames, timestampUs, data } = e.data;
    if (audioEncoder && audioEncoder.state === 'configured') {
      try {
        const audioData = new AudioData({
          format: 'f32',
          sampleRate,
          numberOfFrames,
          numberOfChannels: channels,
          timestamp: timestampUs,
          data,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      } catch (audioErr) {
        console.warn('[VideoRendererWorker] Audio frame encode warning:', audioErr);
      }
    }
  } else if (type === 'RENDER_FRAME') {
    const {
      imageBitmap,
      timestampUs,
      isKeyFrame,
      currentTime,
      vWidth,
      vHeight,
      subtitles,
      styleConfig,
      frameIdx,
      totalFrames,
    } = e.data;

    try {
      // Async preload fonts
      await loadCustomFonts();
      if (styleConfig && styleConfig.customUploadedFonts) {
        await loadUploadedFonts(styleConfig.customUploadedFonts);
      }

      if (!ctx || !offscreenCanvas || !videoEncoder || videoEncoder.state !== 'configured') {
        throw new Error(`Worker context or VideoEncoder not configured (state: ${videoEncoder?.state || 'null'})`);
      }

      // Render frame + subtitle overlay off the main thread
      drawSubtitleOverlay(ctx, imageBitmap, vWidth, vHeight, currentTime, subtitles, styleConfig);
      imageBitmap.close(); // Immediate memory cleanup

      // Use perfectly uniform CFR timestamps to prevent any stuttering, jitter, or timing drift
      const adjustedTimestampUs = Math.round(frameIdx * frameDurationUs);
      lastEncodedTimestampUs = adjustedTimestampUs;

      // Create VideoFrame from OffscreenCanvas
      const frame = new VideoFrame(offscreenCanvas, {
        timestamp: adjustedTimestampUs,
        duration: Math.round(frameDurationUs),
        displayWidth: alignedWidth,
        displayHeight: alignedHeight,
      });
      videoEncoder.encode(frame, { keyFrame: isKeyFrame });
      frame.close();

      const percentage = Math.min(99, Math.round(((frameIdx + 1) / totalFrames) * 100));
      self.postMessage({
        type: 'PROGRESS',
        percentage,
        currentTime,
        status: `[Worker + OffscreenCanvas] Đang mã hóa MP4... (${percentage}%)`,
      });
    } catch (err: any) {
      if (imageBitmap && typeof imageBitmap.close === 'function') {
        imageBitmap.close();
      }
      self.postMessage({ type: 'ERROR', error: err?.message || 'Render frame failed' });
    }
  } else if (type === 'ENCODE_FRAME') {
    const {
      renderedBitmap,
      timestampUs,
      isKeyFrame,
      currentTime,
      frameIdx,
      totalFrames,
    } = e.data;

    try {
      if (!videoEncoder || videoEncoder.state !== 'configured') {
        throw new Error(`Worker videoEncoder not configured (state: ${videoEncoder?.state || 'null'})`);
      }

      if (videoEncoderError) {
        throw videoEncoderError;
      }

      // Check encoder queue backpressure: if hardware encoder queue is backed up (> 20), wait for it to drain
      if (videoEncoder.encodeQueueSize > 20) {
        await new Promise<void>((resolve) => {
          let checkAttempts = 0;
          const check = () => {
            checkAttempts++;
            if (!videoEncoder || videoEncoder.encodeQueueSize <= 8 || videoEncoderError || checkAttempts > 750) {
              resolve();
            } else {
              setTimeout(check, 4);
            }
          };
          check();
        });
      }

      // Use strictly monotonic CFR timestamps to prevent any stuttering, jitter, or timing collision
      const calculatedCfrTs = Math.round(frameIdx * frameDurationUs);
      let adjustedTimestampUs = calculatedCfrTs;
      if (lastEncodedTimestampUs !== null && adjustedTimestampUs <= lastEncodedTimestampUs) {
        adjustedTimestampUs = lastEncodedTimestampUs + Math.max(1, Math.round(frameDurationUs));
      }
      lastEncodedTimestampUs = adjustedTimestampUs;

      const keyframeInterval = Math.max(1, Math.round(framerate * 2));
      const shouldBeKeyFrame = isKeyFrame || frameIdx === 0 || frameIdx % keyframeInterval === 0;

      // Create VideoFrame directly from pre-rendered ImageBitmap
      const frame = new VideoFrame(renderedBitmap, {
        timestamp: adjustedTimestampUs,
        duration: Math.max(1, Math.round(frameDurationUs)),
        displayWidth: alignedWidth,
        displayHeight: alignedHeight,
      });
      videoEncoder.encode(frame, { keyFrame: shouldBeKeyFrame });
      frame.close();
      renderedBitmap.close(); // Immediate memory cleanup of pre-rendered frame

      const percentage = Math.min(99, Math.round(((frameIdx + 1) / totalFrames) * 100));
      self.postMessage({
        type: 'PROGRESS',
        percentage,
        currentTime,
        status: `[GPU + Multi-Threaded CPU] Đang xuất video... (${percentage}%)`,
      });
    } catch (err: any) {
      if (renderedBitmap && typeof renderedBitmap.close === 'function') {
        renderedBitmap.close();
      }
      self.postMessage({ type: 'ERROR', error: err?.message || 'Encode pre-rendered frame failed' });
    }
  } else if (type === 'FINALIZE') {
    try {
      if (videoEncoderError) {
        throw videoEncoderError;
      }
      if (audioEncoder && audioEncoder.state === 'configured') {
        await audioEncoder.flush();
      }
      if (videoEncoder && videoEncoder.state === 'configured') {
        await videoEncoder.flush();
      }
      await Promise.all(pendingAddPromises);
      if (videoSource) {
        videoSource.close();
      }
      if (audioSource) {
        audioSource.close();
      }
      if (output) {
        await output.finalize();
        if (target && target.buffer) {
          const blob = new Blob([target.buffer], { type: 'video/mp4' });
          (postMessage as any)({ type: 'COMPLETE', blob });
          return;
        }
      }
      throw new Error('Mediabunny output buffer unavailable');
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err?.message || 'Finalize worker failed' });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  messageQueue.push(e);
  flushMessageQueue();
};
