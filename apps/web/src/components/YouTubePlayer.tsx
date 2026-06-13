import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  getCurrentTime(): number;
  destroy(): void;
}

interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number }) => void;
  };
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load the IFrame Player API exactly once, shared across all player instances.
let apiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export interface YouTubePlayerHandle {
  /** Seek to a position (seconds) and start playback. */
  seekTo: (seconds: number) => void;
}

interface YouTubePlayerProps {
  videoId: string;
  /** Fired ~2x/sec while playing, and once on pause/end, with the current time. */
  onTimeUpdate?: (seconds: number) => void;
  /** Fired when the video can't be embedded/played (e.g. uploader disabled embeds). */
  onError?: () => void;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ videoId, onTimeUpdate, onError }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const pollRef = useRef<number | null>(null);

    // Keep latest callbacks in refs so the player isn't recreated when they change.
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onErrorRef = useRef(onError);
    onTimeUpdateRef.current = onTimeUpdate;
    onErrorRef.current = onError;

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (seconds: number) => {
          playerRef.current?.seekTo(seconds, true);
          playerRef.current?.playVideo();
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;

      const stopPolling = () => {
        if (pollRef.current !== null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
      const emitTime = () => {
        const t = playerRef.current?.getCurrentTime();
        if (typeof t === "number") onTimeUpdateRef.current?.(t);
      };
      const startPolling = () => {
        stopPolling();
        pollRef.current = window.setInterval(emitTime, 500);
      };

      // YT.Player replaces the target node with an <iframe>. Create that node
      // imperatively so React never tries to reconcile the swapped element.
      const target = document.createElement("div");
      target.className = "w-full h-full";
      wrapRef.current?.appendChild(target);

      loadYouTubeIframeApi().then(() => {
        if (cancelled || !window.YT) return;
        playerRef.current = new window.YT.Player(target, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1 },
          events: {
            onStateChange: (e) => {
              if (e.data === window.YT!.PlayerState.PLAYING) startPolling();
              else stopPolling();
              if (e.data !== window.YT!.PlayerState.PLAYING) emitTime();
            },
            onError: () => onErrorRef.current?.(),
          },
        });
      });

      return () => {
        cancelled = true;
        stopPolling();
        playerRef.current?.destroy();
        playerRef.current = null;
      };
    }, [videoId]);

    return (
      <div className="relative w-full aspect-video">
        <div ref={wrapRef} className="absolute inset-0" />
      </div>
    );
  },
);
