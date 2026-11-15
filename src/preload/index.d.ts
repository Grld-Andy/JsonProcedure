export {};

declare global {
  interface Window {
    /** Exposed by the preload script; absent when the UI runs in a plain browser. */
    jp?: {
      request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }>;
      platform: string;
    };
  }
}
