declare module 'mp4box' {
  export interface MP4Track {
    id: number;
    created: Date;
    modified: Date;
    movie_timescale: number;
    layer: number;
    alternate_group: number;
    volume: number;
    track_width: number;
    track_height: number;
    timescale: number;
    duration: number;
    codec: string;
    language: string;
    nb_samples: number;
    video: {
      width: number;
      height: number;
    };
    audio?: any;
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    created: Date;
    modified: Date;
    tracks: MP4Track[];
    videoTracks: MP4Track[];
    audioTracks: MP4Track[];
  }

  export interface MP4Sample {
    track_id: number;
    description: any;
    is_rap: boolean;
    is_sync: boolean;
    has_redundancy: boolean;
    degradation_priority: number;
    depends_on: number;
    is_depended_on: number;
    empty_duration: number;
    cts: number;
    dts: number;
    duration: number;
    timescale: number;
    size: number;
    data: Uint8Array;
    offset: number;
  }

  export interface MP4File {
    onReady?: (info: MP4Info) => void;
    onError?: (e: any) => void;
    onSamples?: (id: number, user: any, samples: MP4Sample[]) => void;
    appendBuffer(data: ArrayBuffer & { fileStart?: number }): number;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(id: number, user?: any, options?: { nbSamples?: number; rapAlignment?: boolean }): void;
    getTrackById(id: number): any;
  }

  export function createFile(): MP4File;

  export class DataStream {
    static BIG_ENDIAN: boolean;
    static LITTLE_ENDIAN: boolean;
    constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean);
    buffer: ArrayBuffer;
    write(stream: DataStream): void;
  }
}
