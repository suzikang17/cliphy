import type { Summary } from "./types.js";

// Extension message types for communication between content script and background

export interface VideoInfo {
  videoId: string | null;
  title: string;
  url: string;
  channel: string | null;
  duration: string | null;
}

// Content script → Background
export interface VideoDetectedMessage {
  type: "VIDEO_DETECTED";
  video: VideoInfo;
}

// Popup → Content script
export interface GetVideoInfoMessage {
  type: "GET_VIDEO_INFO";
}

// Popup → Background
export interface AddToQueueMessage {
  type: "ADD_TO_QUEUE";
  videoUrl: string;
  videoTitle?: string;
  videoChannel?: string;
}

// Popup → Background (auth)
export interface SignInMessage {
  type: "SIGN_IN";
}

export interface SignOutMessage {
  type: "SIGN_OUT";
}

// Background → Popup/UI (Realtime update)
export interface SummaryUpdatedMessage {
  type: "SUMMARY_UPDATED";
  summary: Summary;
}

// Side panel → Content script
export interface SeekVideoMessage {
  type: "SEEK_VIDEO";
  seconds: number;
}

export type ExtensionMessage =
  | VideoDetectedMessage
  | GetVideoInfoMessage
  | AddToQueueMessage
  | SignInMessage
  | SignOutMessage
  | SummaryUpdatedMessage
  | SeekVideoMessage;
