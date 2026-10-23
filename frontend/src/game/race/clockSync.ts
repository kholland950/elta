/**
 * Client/server clock offset estimation (pure). A sample is one ping round trip measured on
 * the local monotonic clock (t0 sent, t1 received) plus the server epoch time in the pong.
 * `serverNow = localNow + offset`.
 */
export interface ClockSample {
  /** Local time the ping was sent. */
  t0: number
  /** Local time the pong arrived. */
  t1: number
  /** Server epoch ms carried by the pong. */
  serverTime: number
}

export const sampleRtt = (s: ClockSample): number => s.t1 - s.t0

/** Offset implied by one sample, assuming the server stamped the pong mid round trip. */
export const sampleOffset = (s: ClockSample): number => s.serverTime + sampleRtt(s) / 2 - s.t1

/** Offset from the minimum-RTT sample (least queueing noise); null when there are no samples. */
export const estimateOffset = (samples: readonly ClockSample[]): number | null => {
  let best: ClockSample | null = null
  for (const s of samples) {
    if (sampleRtt(s) < 0) continue
    if (best === null || sampleRtt(s) < sampleRtt(best)) best = s
  }
  return best === null ? null : sampleOffset(best)
}
