import { Measure, Platform, POLLING_INTERVAL } from "@lantern/types";
import { useState, useEffect, useCallback } from "react";
import { SocketType, SocketData, SocketEvents } from "./socketInterface";

export const useSocketState = (socket: SocketType, platform: Platform) => {
  const [state, _setState] = useState<SocketData>({
    isMeasuring: false,
    bundleId: null,
    results: [],
    platform,
    apps: [],
  });

  // Stable identity: the consumers register socket listeners in effects that depend on it, so a
  // new function every render would tear down and re-register those listeners on every state
  // change.
  const setState = useCallback(
    (newState: Partial<SocketData> | ((previousState: SocketData) => SocketData)) => {
      _setState(
        typeof newState === "function"
          ? newState
          : (previousState) => ({
              ...previousState,
              ...newState,
            })
      );
    },
    []
  );

  useEffect(() => {
    socket.emit(SocketEvents.UPDATE_STATE, state);
  }, [state, socket]);

  return [state, setState] as const;
};

export const updateMeasuresReducer = (state: SocketData, measures: Measure[]): SocketData => {
  // A poll can still land after RESET emptied the results: there is no result to update, and
  // spreading `undefined` would fabricate a nameless one.
  if (state.results.length === 0) return state;

  return {
    ...state,
    results: [
      ...state.results.slice(0, state.results.length - 1),
      {
        ...state.results[state.results.length - 1],
        iterations: [
          {
            measures,
            time: measures.length * POLLING_INTERVAL,
            status: "SUCCESS",
          },
        ],
      },
    ],
  };
};

export const addNewResultReducer = (
  state: SocketData,
  name: string,
  refreshRate: number
): SocketData => ({
  ...state,
  results: [
    ...state.results,
    {
      name,
      iterations: [],
      status: "SUCCESS",
      specs: {
        refreshRate,
      },
    },
  ],
});
