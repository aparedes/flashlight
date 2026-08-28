import React from "react";

const emitter = new EventTarget();

const SET_VIDEO_CURRENT_TIME = "SET_VIDEO_CURRENT_TIME";
export const setVideoCurrentTime = (time: number) => {
  emitter.dispatchEvent(new CustomEvent<number>(SET_VIDEO_CURRENT_TIME, { detail: time }));
};

export const useListenToVideoCurrentTime = (callback: (time: number) => void) => {
  React.useEffect(() => {
    const listener = (event: Event) => callback((event as CustomEvent<number>).detail);
    emitter.addEventListener(SET_VIDEO_CURRENT_TIME, listener);
    return () => {
      emitter.removeEventListener(SET_VIDEO_CURRENT_TIME, listener);
    };
  }, [callback]);
};

export const VideoEnabledContext = React.createContext(false);
