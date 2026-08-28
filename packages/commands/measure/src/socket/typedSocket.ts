/**
 * A tiny typed event emitter over the {@link SocketFrame} wire protocol, shaped like the slice
 * of the socket.io API this package used (`emit` / `on` / `off` / `removeAllListeners` /
 * `onAny` / `offAny` / `connected`) so call sites did not have to change.
 */

/**
 * Constraint for the event maps: any object whose properties are listener signatures. It is
 * deliberately not `Record<string, …>` — `interface`s have no implicit index signature, so the
 * event maps declared as interfaces would not satisfy it.
 */
export type SocketEventMap = object;

/**
 * The arguments an event carries. Applied to the *emit* side only: listeners keep the declared
 * property type, so method-syntax entries stay bivariant (a `(error: string) => void` listener
 * is still accepted for `sendError(error: unknown)`, as it was with socket.io).
 */
export type SocketEventArgs<Listener> = Listener extends (...args: infer Args) => unknown
  ? Args
  : never[];

export type AnyEventListener = (event: string, ...args: unknown[]) => void;

/** Minimal surface needed to log every incoming event, on either end of the connection. */
export interface SocketEventBroadcaster {
  onAny(listener: AnyEventListener): void;
  offAny(listener: AnyEventListener): void;
}

export interface TypedSocket<
  EmitEvents extends SocketEventMap,
  ListenEvents extends SocketEventMap,
> extends SocketEventBroadcaster {
  /** `true` between the socket opening and closing — polled by the web app UI and by tests. */
  readonly connected: boolean;
  emit<Event extends keyof EmitEvents & string>(
    event: Event,
    ...args: SocketEventArgs<EmitEvents[Event]>
  ): void;
  on<Event extends keyof ListenEvents & string>(event: Event, listener: ListenEvents[Event]): void;
  off<Event extends keyof ListenEvents & string>(event: Event, listener: ListenEvents[Event]): void;
  removeAllListeners(event?: keyof ListenEvents & string): void;
  disconnect(): void;
}

type StoredListener = (...args: never[]) => void;

export abstract class TypedSocketBase<
  EmitEvents extends SocketEventMap,
  ListenEvents extends SocketEventMap,
> implements TypedSocket<EmitEvents, ListenEvents> {
  private readonly listeners = new Map<string, Set<StoredListener>>();
  private readonly anyListeners = new Set<AnyEventListener>();

  abstract get connected(): boolean;

  abstract emit<Event extends keyof EmitEvents & string>(
    event: Event,
    ...args: SocketEventArgs<EmitEvents[Event]>
  ): void;

  abstract disconnect(): void;

  on<Event extends keyof ListenEvents & string>(event: Event, listener: ListenEvents[Event]): void {
    const listeners = this.listeners.get(event) ?? new Set<StoredListener>();
    listeners.add(listener as StoredListener);
    this.listeners.set(event, listeners);
  }

  off<Event extends keyof ListenEvents & string>(
    event: Event,
    listener: ListenEvents[Event]
  ): void {
    this.listeners.get(event)?.delete(listener as StoredListener);
  }

  removeAllListeners(event?: keyof ListenEvents & string): void {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
  }

  onAny(listener: AnyEventListener): void {
    this.anyListeners.add(listener);
  }

  offAny(listener: AnyEventListener): void {
    this.anyListeners.delete(listener);
  }

  /**
   * Dispatches a decoded frame (or a locally generated lifecycle event) to the listeners.
   * Iterating over copies so a listener may add or remove listeners while it runs.
   */
  protected dispatch(event: string, args: unknown[]): void {
    const anyListeners = Array.from(this.anyListeners);
    for (const listener of anyListeners) {
      listener(event, ...args);
    }

    const listeners = this.listeners.get(event);
    if (!listeners) return;

    for (const listener of Array.from(listeners)) {
      (listener as (...args: unknown[]) => void)(...args);
    }
  }
}
