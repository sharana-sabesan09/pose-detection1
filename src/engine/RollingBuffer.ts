/**
 * src/engine/RollingBuffer.ts — TIME-WINDOWED DATA BUFFER
 *
 * A RollingBuffer is like a short-term memory for sensor data.
 * You push new values in, old values automatically fall off the back.
 *
 * WHY WE NEED THIS:
 *   Clinical measurements like "how much did the hips sway in the last 5 seconds?"
 *   require keeping a window of recent data. We can't keep every frame ever recorded
 *   (that would fill up memory). We only need the last N milliseconds.
 *
 * HOW IT WORKS:
 *   Each entry is stored with the timestamp it arrived.
 *   When you call push(), any entry older than `windowMs` milliseconds is
 *   automatically trimmed off the front of the buffer.
 *
 * EXAMPLE:
 *   const buf = new RollingBuffer<number>(5000); // 5-second window
 *   buf.push(0.42);  // hip position at this moment
 *   // ... 300 frames later ...
 *   buf.values();    // returns only frames from the last 5 seconds
 *
 * TYPE PARAMETER <T>:
 *   This is a "generic" buffer — it can hold any type of value:
 *   - RollingBuffer<number>         for single values like hip X position
 *   - RollingBuffer<{x,y}>         for 2D positions
 *   - RollingBuffer<PoseFrame>     for full pose snapshots
 */

export class RollingBuffer<T> {
  /**
   * The internal storage: an array of { timestamp, value } pairs.
   * Entries are always in chronological order (oldest at index 0).
   */
  private buf: { t: number; v: T }[] = [];

  /**
   * @param windowMs  How many milliseconds of history to keep.
   *                  5000 = keep the last 5 seconds of data.
   */
  constructor(private windowMs: number) {}

  /**
   * push() — ADD A NEW VALUE TO THE BUFFER
   *
   * Stamps the value with the current time, appends it to the end,
   * then trims any entries that have aged out of the window.
   */
  push(v: T): void {
    const now = Date.now();
    this.buf.push({ t: now, v });

    // Walk from the front and remove any entry older than our window.
    // We use a splice (one call) rather than multiple shifts for performance.
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.buf.length && this.buf[i].t < cutoff) i++;
    if (i > 0) this.buf.splice(0, i);
  }

  /** Returns just the values (no timestamps) — most detectors only need these. */
  values(): T[] {
    return this.buf.map(b => b.v);
  }

  /** Returns just the timestamps in milliseconds — used for step rhythm timing. */
  timestamps(): number[] {
    return this.buf.map(b => b.t);
  }

  /** Returns full {t, v} pairs — used when you need both value and time together. */
  entries(): { t: number; v: T }[] {
    return [...this.buf];
  }

  /** How many entries are currently in the buffer. */
  get length(): number {
    return this.buf.length;
  }

  /** The most recent value, or null if the buffer is empty. */
  latest(): T | null {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1].v : null;
  }

  /** The oldest entry currently in the buffer. */
  oldest(): { t: number; v: T } | null {
    return this.buf.length > 0 ? this.buf[0] : null;
  }

  /** Wipe all stored data — called when switching modes or resetting. */
  clear(): void {
    this.buf = [];
  }
}
