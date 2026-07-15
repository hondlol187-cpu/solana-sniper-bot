export interface EventSource<T> {
  name: string;
  start(
    onEvent: (event: T) => Promise<void>
  ): Promise<void>;
  stop(): Promise<void>;
}