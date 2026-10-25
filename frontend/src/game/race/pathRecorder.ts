/** One point of a player's route: `t` is ms since GO. */
export interface PathSample {
  t: number
  x: number
  y: number
}

/** A sample is kept once it is this far (px) from the last kept one. */
export const PATH_MIN_DIST = 24
/** A gap longer than this (ms) keeps the raw sample before it, so a wait keeps its timing. */
export const PATH_MAX_GAP_MS = 250
/** Most samples kept per player; at the cap every other one goes and the spacing doubles. */
export const PATH_CAP = 1024

interface Track {
  samples: PathSample[]
  minDist: number
  /** The latest raw sample, reused; `kept` once it is also the last kept sample. */
  raw: PathSample
  hasRaw: boolean
  kept: boolean
}

/**
 * Every player's route through the race, downsampled as it is recorded: the local orb from each
 * physics step, remote orbs from their moves. Samples before GO (explore, countdown) and after
 * `finalize` are ignored.
 */
export class PathRecorder {
  private goAt?: number
  private done = false
  private tracks = new Map<string, Track>()

  /** A new race from `goAt` (server ms); the last one's paths are dropped. */
  public begin(goAt: number) {
    this.goAt = goAt
    this.done = false
    this.tracks.clear()
  }

  public record(id: string, serverNow: number, x: number, y: number) {
    if (this.goAt === undefined || this.done) return
    const t = serverNow - this.goAt
    if (t < 0) return
    let track = this.tracks.get(id)
    if (!track) {
      track = { samples: [], minDist: PATH_MIN_DIST, raw: { t, x, y }, hasRaw: false, kept: false }
      this.tracks.set(id, track)
    }
    const { samples, raw } = track
    const last = samples[samples.length - 1]
    if (!last) {
      this.keep(track, t, x, y)
    } else {
      const leaving = Math.hypot(x - last.x, y - last.y) >= track.minDist
      // Either side of a wait: the raw sample before a long gap in moves (a remote orb sitting
      // still sends nothing), or, on leaving, the last one of a long stay near the kept one
      const waited = t - raw.t > PATH_MAX_GAP_MS || (leaving && raw.t - last.t > PATH_MAX_GAP_MS)
      if (track.hasRaw && !track.kept && waited) {
        this.keep(track, raw.t, raw.x, raw.y)
      }
      const from = samples[samples.length - 1]
      if (Math.hypot(x - from.x, y - from.y) >= track.minDist) this.keep(track, t, x, y)
      else track.kept = false
    }
    raw.t = t
    raw.x = x
    raw.y = y
    track.hasRaw = true
  }

  private keep(track: Track, t: number, x: number, y: number) {
    const { samples } = track
    if (samples.length >= PATH_CAP) {
      // Halve the path, always keeping its first point
      let n = 0
      for (let i = 0; i < samples.length; i += 2) samples[n++] = samples[i]
      samples.length = n
      track.minDist *= 2
    }
    samples.push({ t, x, y })
    track.kept = true
  }

  /**
   * The race is over: ends each path where that player stopped racing, at their finish time from
   * `times` or else at `endedAt`. Returns the paths and stops recording.
   */
  public finalize(endedAt: number, times: ReadonlyArray<{ playerId: string; raceTimeMs: number }>): Map<string, PathSample[]> {
    const out = new Map<string, PathSample[]>()
    if (this.goAt === undefined) return out
    this.done = true
    const endMs = Math.max(0, endedAt - this.goAt)
    this.tracks.forEach((track, id) => {
      const finish = times.find((time) => time.playerId === id)
      const clip = Math.min(endMs, finish?.raceTimeMs ?? endMs)
      const { samples, raw } = track
      // The last position seen, if it wasn't kept
      if (track.hasRaw && !track.kept) samples.push({ t: raw.t, x: raw.x, y: raw.y })
      track.kept = true
      let n = 0
      while (n < samples.length && samples[n].t <= clip) n++
      if (n < samples.length && n > 0) {
        // Cut the segment that crosses the clip where it crosses
        const a = samples[n - 1]
        const b = samples[n]
        const k = b.t > a.t ? (clip - a.t) / (b.t - a.t) : 0
        samples[n] = { t: clip, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
        n++
      }
      samples.length = n
      if (n > 0) out.set(id, samples)
    })
    return out
  }

  /** A player's own exact path, replacing the one recorded here (path broadcast, later). */
  public replace(id: string, samples: PathSample[]) {
    this.tracks.set(id, {
      samples: samples.slice(0, PATH_CAP),
      minDist: PATH_MIN_DIST,
      raw: { t: 0, x: 0, y: 0 },
      hasRaw: false,
      kept: true,
    })
  }
}
