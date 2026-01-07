
export interface BatchImage {
  id: string;
  url: string;
  base64: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  resolution: string;
  upscaleType?: 'Free' | 'Pro 4K';
  error?: string;
  isCropping?: boolean;
}

export type CopyboardType = 'text' | 'image' | 'video';

export interface CopyboardItem {
  id: string;
  type: CopyboardType;
  content: string; // base64 for image, raw text for text, url or identifier for video
  title?: string;
  timestamp: number;
}

export interface ResultItem {
  id: string;
  url: string;
  base64: string;
  resolution: string;
  upscaleType: string;
  timestamp: number;
}

export interface ImageState {
  url: string | null;
  base64: string | null;
  beforeUrl?: string | null;
  resolution: string;
  isUpscaled: boolean;
  upscaleType?: 'Free' | 'Pro 4K';
}

export enum AppMode {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  EDITING = 'EDITING',
  UPSCALING = 'UPSCALING',
  UPSCALING_FREE = 'UPSCALING_FREE',
  BATCH_PROCESSING = 'BATCH_PROCESSING',
  CROPPING = 'CROPPING',
  ZOOMING = 'ZOOMING',
  REMOVING_WATERMARK = 'REMOVING_WATERMARK',
  MAGIC_HAND = 'MAGIC_HAND',
  ERROR = 'ERROR'
}

export interface HistoryItem {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
}
