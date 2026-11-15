/** An error that maps to an HTTP-style status and a user-facing message. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Encrypts/decrypts secrets at rest. In the app this is Electron's safeStorage (DPAPI on Windows). */
export interface Protector {
  protect(plain: string): string;
  unprotect(protectedText: string): string;
}

/** A decoded request body: parsed JSON, so any shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

/** UTC "yyyy-MM-ddTHH:mm:ss[.fff]" with no zone suffix, the way the old API serialised DateTime. */
export function isoLocal(d: Date): string {
  const s = d.toISOString().slice(0, -1); // drop the Z
  return s.replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function nowIso(): string {
  return new Date().toISOString(); // yyyy-MM-ddTHH:mm:ss.fffZ
}
