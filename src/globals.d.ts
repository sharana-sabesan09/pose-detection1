// Hermes exposes these at runtime but the RN tsconfig base doesn't include DOM lib.
declare const performance: { now(): number };
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(encoding?: string);
  decode(input?: Uint8Array): string;
}
