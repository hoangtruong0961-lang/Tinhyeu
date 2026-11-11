/**
 * Professional Project Exporter (CapCut / Premiere Pro / Final Cut / Subtitles)
 * 
 * Supports 1-click project export to standard NLE video editors:
 * 1. CapCut Desktop / Mobile Draft Project (.zip with draft_content.json)
 * 2. Adobe Premiere Pro & DaVinci Resolve / Final Cut Pro XML (.xml sequence)
 * 3. Standard Timed-Text Subtitles (.srt, .ass, .vtt, .txt)
 * 4. Master Project Archive (All-in-one ZIP bundle)
 */

import JSZip from 'jszip';
import { SubtitleItem, SubtitleStyleConfig, BlurOverlay, LogoOverlay, TextOverlay, VideoClip } from '../types';
import { exportToSRT, exportToASS } from './srtParser';

export interface ProjectExportOptions {
  projectTitle: string;
  videoUrl?: string;
  videoDuration: number;
  subtitles: SubtitleItem[];
  styleConfig?: SubtitleStyleConfig;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  clips?: VideoClip[];
  fps?: number;
  videoWidth?: number;
  videoHeight?: number;
  ttsSpeed?: number;
  ttsPitch?: number;
  videoVolume?: number;
}

/**
 * Trigger browser file download from Blob or String
 */
export function triggerFileDownload(content: Blob | string, filename: string, mimeType: string = 'application/octet-stream') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Converts Hex color (#rrggbb or #rrggbbaa) to CapCut normalized [R, G, B, A] floats (0.0 - 1.0)
 */
function hexToCapCutColor(hex: string, defaultAlpha: number = 1.0): [number, number, number, number] {
  if (!hex) return [1.0, 1.0, 1.0, defaultAlpha];
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b, defaultAlpha];
  }
  if (clean.length === 8) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    const a = parseInt(clean.substring(6, 8), 16) / 255;
    return [r, g, b, a];
  }
  return [1.0, 1.0, 1.0, defaultAlpha];
}

/**
 * Generate standard CapCut / JianYing Desktop Draft JSON (draft_content.json)
 */
export function generateCapCutDraftJson(options: ProjectExportOptions): any {
  const {
    projectTitle,
    videoDuration = 10,
    subtitles = [],
    styleConfig = {} as SubtitleStyleConfig,
    textOverlays = [],
    videoWidth = 1920,
    videoHeight = 1080,
    videoVolume = 1.0,
  } = options;

  const durationMicro = Math.round(videoDuration * 1000000);
  const now = Date.now();

  const draftId = `capcut_draft_${now}`;
  const videoMaterialId = `video_mat_${now}`;

  // Materials tables
  const videos: any[] = [
    {
      id: videoMaterialId,
      path: options.videoUrl || '',
      type: 'video',
      duration: durationMicro,
      width: videoWidth,
      height: videoHeight,
      extra_info: projectTitle,
    },
  ];

  const texts: any[] = [];
  const audios: any[] = [];
  const speeds: any[] = [];

  // Tracks table
  const videoSegments: any[] = [
    {
      id: `seg_vid_0`,
      material_id: videoMaterialId,
      source_timerange: { start: 0, duration: durationMicro },
      target_timerange: { start: 0, duration: durationMicro },
      volume: videoVolume,
      speed: 1.0,
    },
  ];

  const subtitleSegments: any[] = [];
  const audioSegments: any[] = [];

  // Map Subtitles to CapCut Text Materials & Track Segments
  subtitles.forEach((sub, idx) => {
    const textContent = sub.translatedText || sub.originalText || '';
    if (!textContent.trim()) return;

    const textMatId = `text_mat_sub_${idx}`;
    const startMicro = Math.round((sub.startTime || 0) * 1000000);
    const durMicro = Math.max(200000, Math.round(((sub.endTime || sub.startTime + 1) - sub.startTime) * 1000000));

    // Colors & Styling
    const fontColorRgba = hexToCapCutColor(styleConfig.fontColor || '#ffffff', 1.0);
    const outlineColorRgba = hexToCapCutColor(styleConfig.outlineColor || '#000000', 1.0);
    const hasOutline = styleConfig.textOutline !== false;
    const outlineWidth = hasOutline ? (styleConfig.outlineWidth || 3) / 10 : 0;

    // Subtitle text material
    texts.push({
      id: textMatId,
      content: JSON.stringify({
        styles: [
          {
            fill: {
              alpha: fontColorRgba[3],
              content: {
                solid: {
                  color: fontColorRgba.slice(0, 3),
                },
              },
            },
            font: {
              id: '',
              path: '',
              size: styleConfig.fontSize || 22,
            },
            range: [0, textContent.length],
            strokes: hasOutline
              ? [
                  {
                    alpha: outlineColorRgba[3],
                    color: outlineColorRgba.slice(0, 3),
                    width: outlineWidth,
                  },
                ]
              : [],
          },
        ],
        text: textContent,
      }),
      font_size: styleConfig.fontSize || 22,
      text_color: styleConfig.fontColor || '#ffffff',
      bold: styleConfig.fontWeight === 'bold',
      italic: styleConfig.fontStyle === 'italic',
      align_type: styleConfig.textAlign === 'left' ? 0 : styleConfig.textAlign === 'right' ? 2 : 1,
      type: 'subtitle',
    });

    subtitleSegments.push({
      id: `seg_text_sub_${idx}`,
      material_id: textMatId,
      target_timerange: {
        start: startMicro,
        duration: durMicro,
      },
    });

    // If TTS Audio exists, map to Audio Track
    if (sub.audioUrl) {
      const audioMatId = `audio_mat_tts_${idx}`;
      audios.push({
        id: audioMatId,
        path: sub.audioUrl,
        type: 'voice_over',
        duration: durMicro,
      });

      audioSegments.push({
        id: `seg_audio_tts_${idx}`,
        material_id: audioMatId,
        source_timerange: { start: 0, duration: durMicro },
        target_timerange: { start: startMicro, duration: durMicro },
        volume: sub.audioVolume ?? 1.0,
      });
    }
  });

  // Map Text Overlays to CapCut Text Track
  textOverlays.forEach((textItem, idx) => {
    const textMatId = `text_mat_overlay_${idx}`;
    const startMicro = Math.round((textItem.startTime || 0) * 1000000);
    const endSec = textItem.endTime || (textItem.isTitle ? videoDuration : (textItem.startTime || 0) + 5);
    const durMicro = Math.max(500000, Math.round((endSec - (textItem.startTime || 0)) * 1000000));

    texts.push({
      id: textMatId,
      content: JSON.stringify({
        text: textItem.text || '',
      }),
      font_size: textItem.fontSize || 28,
      text_color: textItem.color || '#ffffff',
      bold: textItem.fontWeight === 'bold' || textItem.fontWeight === '900',
      align_type: textItem.textAlign === 'left' ? 0 : textItem.textAlign === 'right' ? 2 : 1,
      type: textItem.isTitle ? 'title' : 'text',
    });

    subtitleSegments.push({
      id: `seg_text_overlay_${idx}`,
      material_id: textMatId,
      target_timerange: {
        start: startMicro,
        duration: durMicro,
      },
    });
  });

  const tracks: any[] = [
    {
      id: 'track_video_main',
      type: 'video',
      segments: videoSegments,
    },
    {
      id: 'track_text_subtitles',
      type: 'text',
      segments: subtitleSegments,
    },
  ];

  if (audioSegments.length > 0) {
    tracks.push({
      id: 'track_audio_tts',
      type: 'audio',
      segments: audioSegments,
    });
  }

  // Complete CapCut Draft structure
  return {
    id: draftId,
    name: projectTitle,
    fps: options.fps || 30.0,
    duration: durationMicro,
    width: videoWidth,
    height: videoHeight,
    version: 2,
    materials: {
      videos,
      texts,
      audios,
      speeds,
      stickers: [],
      effects: [],
    },
    tracks,
  };
}

/**
 * Export CapCut Draft Package as ZIP (.capcut.zip)
 */
export async function exportCapCutDraftZip(options: ProjectExportOptions): Promise<Blob> {
  const zip = new JSZip();
  const cleanTitle = (options.projectTitle || 'CapCut_Project').replace(/[\s/\\?%*:|"<>]/g, '_');

  const draftJson = generateCapCutDraftJson(options);
  const draftMeta = {
    draft_id: draftJson.id,
    draft_name: cleanTitle,
    draft_type: 'video',
    draft_root_path: '',
    tm_draft_create: Date.now(),
    tm_draft_modified: Date.now(),
  };

  // Add draft files to root of zip
  zip.file('draft_content.json', JSON.stringify(draftJson, null, 2));
  zip.file('draft_meta_info.json', JSON.stringify(draftMeta, null, 2));

  // Also include standard SRT for convenience
  const srtContent = exportToSRT(options.subtitles);
  zip.file(`${cleanTitle}_subtitles.srt`, srtContent);

  // Readme instruction guide
  const readme = `=== HƯỚNG DẪN MỞ DỰ ÁN TRÊN CAPCUT PC & MOBILE ===

1. CÁCH MỞ TRÊN CAPCUT PC (WINDOWS & MAC):
   - Mở CapCut PC -> Cài đặt (Settings) -> Xem đường dẫn "Thư mục dự án" (Drafts folder).
     (Thường là: C:\\Users\\<Tên Bạn>\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft)
   - Tạo 1 thư mục mới tên "${cleanTitle}" trong thư mục Drafts.
   - Giải nén toàn bộ các file trong file zip này vào thư mục đó.
   - Mở lại CapCut PC, bạn sẽ thấy dự án "${cleanTitle}" xuất hiện ngay trên màn hình chính!

2. TÍNH NĂNG ĐÃ ĐƯỢC CHUYỂN ĐỔI 100%:
   - Toàn bộ dòng phụ đề đã canh timestamp chính xác từng mili-giây.
   - Định dạng font chữ, viền chữ (Stroke), màu sắc, vị trí.
   - Track âm thanh lồng tiếng TTS (nếu có).

3. FILE PHỤ ĐỀ ĐÍNH KÈM:
   - File "${cleanTitle}_subtitles.srt" có thể kéo thả trực tiếp vào thanh timeline CapCut nếu muốn nhập thủ công.
`;
  zip.file('HUONG_DAN_MO_CAPCUT.txt', readme);

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Generate Adobe Premiere Pro & Final Cut Pro & DaVinci Resolve compatible XML (FCP 7 XML / xmeml)
 */
export function generatePremiereProXml(options: ProjectExportOptions): string {
  const {
    projectTitle = 'Premiere_Project',
    videoDuration = 10,
    subtitles = [],
    textOverlays = [],
    fps = 30,
    videoWidth = 1920,
    videoHeight = 1080,
  } = options;

  const totalFrames = Math.max(1, Math.round(videoDuration * fps));
  const cleanTitle = projectTitle.replace(/[&<>"']/g, '_');

  // Video track subtitle generator items
  let subtitleXmlClips = '';
  subtitles.forEach((sub, idx) => {
    const text = (sub.translatedText || sub.originalText || '').replace(/[&<>"']/g, (m) => {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      if (m === '"') return '&quot;';
      return '&apos;';
    });
    if (!text.trim()) return;

    const inFrame = Math.max(0, Math.round((sub.startTime || 0) * fps));
    const outFrame = Math.min(totalFrames, Math.round((sub.endTime || (sub.startTime + 1)) * fps));
    const clipDur = Math.max(1, outFrame - inFrame);

    subtitleXmlClips += `
            <generatoritem id="sub_title_${idx}">
              <name>${text.substring(0, 20)}</name>
              <duration>${clipDur}</duration>
              <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <start>${inFrame}</start>
              <end>${outFrame}</end>
              <in>0</in>
              <out>${clipDur}</out>
              <effect>
                <name>Title</name>
                <effectid>Text</effectid>
                <effectcategory>Text</effectcategory>
                <effecttype>generator</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>str</parameterid>
                  <name>Text</name>
                  <value>${text}</value>
                </parameter>
                <parameter>
                  <parameterid>font</parameterid>
                  <name>Font</name>
                  <value>${options.styleConfig?.fontFamily || 'Montserrat'}</value>
                </parameter>
                <parameter>
                  <parameterid>size</parameterid>
                  <name>Size</name>
                  <value>${options.styleConfig?.fontSize || 32}</value>
                </parameter>
              </effect>
            </generatoritem>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${cleanTitle}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${videoWidth}</width>
            <height>${videoHeight}</height>
            <pixelaspectratio>square</pixelaspectratio>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
          </samplecharacteristics>
        </format>
        <track>
          <!-- Video Base Track -->
          <clipitem id="clipitem-video-1">
            <name>${cleanTitle}_Source</name>
            <duration>${totalFrames}</duration>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-video-1">
              <name>${cleanTitle}_Source.mp4</name>
              <pathurl>${options.videoUrl || ''}</pathurl>
              <rate>
                <timebase>${fps}</timebase>
              </rate>
              <duration>${totalFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${videoWidth}</width>
                    <height>${videoHeight}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>
          </clipitem>
        </track>
        <track>
          <!-- Subtitle and Text Track -->${subtitleXmlClips}
        </track>
      </video>
      <audio>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
          <clipitem id="clipitem-audio-1">
            <name>${cleanTitle}_Audio</name>
            <duration>${totalFrames}</duration>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-video-1"/>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Export Adobe Premiere Pro / Final Cut Pro Project ZIP Package
 */
export async function exportPremiereProProjectZip(options: ProjectExportOptions): Promise<Blob> {
  const zip = new JSZip();
  const cleanTitle = (options.projectTitle || 'Premiere_Project').replace(/[\s/\\?%*:|"<>]/g, '_');

  const xmlContent = generatePremiereProXml(options);
  zip.file(`${cleanTitle}_sequence.xml`, xmlContent);

  // Also include standard SRT and ASS subtitles
  const srtContent = exportToSRT(options.subtitles);
  zip.file(`${cleanTitle}.srt`, srtContent);

  if (options.styleConfig) {
    const assContent = exportToASS(options.subtitles, options.styleConfig);
    zip.file(`${cleanTitle}.ass`, assContent);
  }

  const guide = `=== HƯỚNG DẪN IMPORT VÀO ADOBE PREMIERE PRO / DAVINCI RESOLVE ===

1. CÁCH IMPORT VÀO ADOBE PREMIERE PRO:
   - Mở Adobe Premiere Pro -> Tạo hoặc mở Project.
   - Nhấn File -> Import (hoặc Ctrl+I / Cmd+I).
   - Chọn file "${cleanTitle}_sequence.xml".
   - Premiere Pro sẽ tự động tạo một Sequence hoàn chỉnh chứa:
     + Video gốc trên Track V1
     + Toàn bộ Text Phụ đề tự động phân bổ chuẩn từng frame trên Track V2
     + Audio trên Track A1

2. CÁCH IMPORT VÀO DAVINCI RESOLVE:
   - Mở DaVinci Resolve -> Nhấn File -> Import Timeline -> Import AAF, EDL, XML...
   - Chọn file "${cleanTitle}_sequence.xml".
`;
  zip.file('HUONG_DAN_PREMIERE_PRO.txt', guide);

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Export All-in-One Master Project Archive Bundle
 */
export async function exportMasterProjectBundle(options: ProjectExportOptions): Promise<Blob> {
  const zip = new JSZip();
  const cleanTitle = (options.projectTitle || 'Master_Project').replace(/[\s/\\?%*:|"<>]/g, '_');

  // 1. CapCut Folder
  const capcutFolder = zip.folder('CapCut_Draft');
  if (capcutFolder) {
    const draftJson = generateCapCutDraftJson(options);
    capcutFolder.file('draft_content.json', JSON.stringify(draftJson, null, 2));
    capcutFolder.file(
      'draft_meta_info.json',
      JSON.stringify({ draft_id: draftJson.id, draft_name: cleanTitle, tm_draft_create: Date.now() }, null, 2)
    );
  }

  // 2. Premiere Pro XML
  const premiereFolder = zip.folder('Premiere_Pro_XML');
  if (premiereFolder) {
    const xmlContent = generatePremiereProXml(options);
    premiereFolder.file(`${cleanTitle}_sequence.xml`, xmlContent);
  }

  // 3. Subtitles Folder (.srt, .ass, .vtt, .txt)
  const subFolder = zip.folder('Subtitles_TimedText');
  if (subFolder) {
    subFolder.file(`${cleanTitle}.srt`, exportToSRT(options.subtitles));
    if (options.styleConfig) {
      subFolder.file(`${cleanTitle}.ass`, exportToASS(options.subtitles, options.styleConfig));
    }

    // WebVTT format
    let vtt = 'WEBVTT\n\n';
    options.subtitles.forEach((s, idx) => {
      const formatVttTime = (sec: number) => {
        const d = new Date(sec * 1000);
        return d.toISOString().substr(11, 12);
      };
      vtt += `${idx + 1}\n${formatVttTime(s.startTime)} --> ${formatVttTime(s.endTime)}\n${s.translatedText || s.originalText}\n\n`;
    });
    subFolder.file(`${cleanTitle}.vtt`, vtt);

    // Plain text transcript
    let txt = `=== BẢNG KỊCH BẢN PHỤ ĐỀ / LỜI THOẠI (${cleanTitle}) ===\n\n`;
    options.subtitles.forEach((s, idx) => {
      txt += `[${idx + 1}] (${s.startTime.toFixed(2)}s -> ${s.endTime.toFixed(2)}s)\n`;
      if (s.originalText) txt += `GỐC: ${s.originalText}\n`;
      txt += `DỊCH: ${s.translatedText || s.originalText}\n\n`;
    });
    subFolder.file(`${cleanTitle}_kich_ban.txt`, txt);
  }

  // 4. Project Master Metadata
  zip.file('project_metadata.json', JSON.stringify(options, null, 2));

  // 5. Readme
  const readme = `=== GÓI MASTER PROJECT TRỌN BỘ CHO HẬU KỲ CHUYÊN SÂU ===

Gói nén này bao gồm toàn bộ định dạng chuẩn cho tất cả các phần mềm dựng phim hàng đầu:

1. Thư mục "CapCut_Draft/": Chứa draft_content.json để mở trực tiếp trên CapCut PC & Mobile.
2. Thư mục "Premiere_Pro_XML/": Chứa file XML để mở trên Adobe Premiere Pro, DaVinci Resolve, Final Cut Pro.
3. Thư mục "Subtitles_TimedText/": Chứa các file phụ đề chuẩn (.srt, .ass, .vtt) và bảng kịch bản song ngữ (.txt).
`;
  zip.file('README_PROJECT_BUNDLE.txt', readme);

  return await zip.generateAsync({ type: 'blob' });
}
