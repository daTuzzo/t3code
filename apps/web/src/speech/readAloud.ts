import { m } from "~/i18n/messages";
import * as Schema from "effect/Schema";
import { speechSpeedAppliedByProvider, type SpeechSynthesisCatalog } from "@t3tools/contracts";
import {
  createReadAloudController,
  createReadAloudWarmup,
  createTimedWords,
  type SpeechPlayback,
  type SpokenWord,
} from "@t3tools/client-runtime/read-aloud";
import {
  getSpeechSynthesisModels,
  getSpeechSynthesisTimings,
  prepareSpeechSynthesis,
  startSpeechSynthesis,
} from "@t3tools/client-runtime/voice-input";
import { spokenWordAt } from "@t3tools/shared/read-aloud";
import { readLocalStorageValue } from "../hooks/useLocalStorage";
import { readPreparedConnection } from "../state/session";
import { runEnvironmentSpeech } from "./runEnvironmentSpeech";

export const READ_ALOUD_VOLUME_STORAGE_KEY = "t3code:read-aloud-volume:v1";
export const ReadAloudVolume = Schema.Struct({
  volume: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  muted: Schema.Boolean,
});
export const DEFAULT_READ_ALOUD_VOLUME: typeof ReadAloudVolume.Type = { volume: 1, muted: false };

const appended = (buffer: SourceBuffer) =>
  new Promise((resolve) => buffer.addEventListener("updateend", resolve, { once: true }));

/**
 * Feeds the synthesis stream to a MediaSource. Media elements cannot seek in a stream served
 * without byte ranges, but they can seek in the audio a MediaSource has buffered.
 */
async function streamAudio(
  audio: HTMLAudioElement,
  source: MediaSource,
  url: string,
  signal: AbortSignal,
  onAppend: () => void,
) {
  await new Promise((resolve) => source.addEventListener("sourceopen", resolve, { once: true }));
  const buffer = source.addSourceBuffer("audio/mpeg");
  buffer.mode = "sequence";
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error("The speech stream is unavailable.");
  const reader = response.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    for (;;) {
      try {
        buffer.appendBuffer(read.value);
        break;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "QuotaExceededError")) throw error;
        // The browser evicts audio that has already played once playback moves on.
        await new Promise((resolve) =>
          audio.addEventListener("timeupdate", resolve, { once: true }),
        );
      }
    }
    await appended(buffer);
    onAppend();
  }
  source.endOfStream();
}

const MEDIA_EVENTS = ["timeupdate", "durationchange", "seeking", "ended", "emptied"] as const;
// Each one moves the media clock or starts or stops it.
const CLOCK_EVENTS = ["play", "playing", "pause", "seeked", "ratechange", "waiting"] as const;

function mediaPlayback(
  url: string,
  speed: number,
  synthesizedSpeed: number | null,
  timings: Omit<Parameters<typeof createTimedWords>[0], "clock">,
) {
  const audio = new Audio();
  const rate = (value: number) => (synthesizedSpeed ? value / synthesizedSpeed : value);
  // Loading media resets `playbackRate` to `defaultPlaybackRate`.
  audio.defaultPlaybackRate = audio.playbackRate = rate(speed);
  const saved = readLocalStorageValue(
    READ_ALOUD_VOLUME_STORAGE_KEY,
    DEFAULT_READ_ALOUD_VOLUME,
    ReadAloudVolume,
  );
  audio.volume = saved.volume;
  audio.muted = saved.muted;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const abort = new AbortController();
  let done: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    done = resolve;
    fail = reject;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Could not play the generated speech."));
  });
  if (window.MediaSource?.isTypeSupported("audio/mpeg")) {
    const source = new MediaSource();
    const sourceUrl = URL.createObjectURL(source);
    audio.src = sourceUrl;
    void streamAudio(audio, source, url, abort.signal, notify).then(
      () => URL.revokeObjectURL(sourceUrl),
      () => {
        URL.revokeObjectURL(sourceUrl);
        if (!abort.signal.aborted) fail(new Error("Could not play the generated speech."));
      },
    );
  } else audio.src = url;
  const seekableEnd = () =>
    audio.seekable.length ? audio.seekable.end(audio.seekable.length - 1) : 0;
  let timed: ReturnType<typeof createTimedWords> | null = null;
  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    stop: () => {
      if (timed) for (const type of CLOCK_EVENTS) audio.removeEventListener(type, timed.refresh);
      timed?.stop();
      abort.abort();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      done();
    },
    finished,
    // The highlight follows this element's clock, so seeking and speed changes move it too.
    words: (listener) => {
      if (!timed) {
        timed = createTimedWords({
          ...timings,
          clock: () => ({
            seconds: audio.currentTime,
            rate: audio.playbackRate,
            playing: !audio.paused,
          }),
        });
        for (const type of CLOCK_EVENTS) audio.addEventListener(type, timed.refresh);
      }
      return timed.subscribe(listener);
    },
    media: {
      progress: () => ({
        time: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : Infinity,
        buffered: audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0,
        seekable: seekableEnd() > 0,
        ended: audio.ended,
      }),
      subscribe: (listener: () => void) => {
        if (!listeners.size) for (const type of MEDIA_EVENTS) audio.addEventListener(type, notify);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (!listeners.size)
            for (const type of MEDIA_EVENTS) audio.removeEventListener(type, notify);
        };
      },
      // Short of the end while audio is still arriving, so playback does not stall on it.
      seek: (seconds: number) => {
        if (!seekableEnd()) return;
        const end = Number.isFinite(audio.duration) ? audio.duration : seekableEnd() - 0.25;
        audio.currentTime = Math.max(0, Math.min(seconds, end));
        // `seeking` fires a task later; the position is already readable.
        notify();
      },
      setSpeed: (value: number) => {
        audio.defaultPlaybackRate = audio.playbackRate = rate(value);
      },
      setVolume: (volume: number, muted: boolean) => {
        audio.volume = volume;
        audio.muted = muted;
      },
    },
  } satisfies SpeechPlayback;
}

function systemPlayback(
  text: string,
  voice: string,
  speed: number,
  language: string,
): SpeechPlayback {
  if (!("speechSynthesis" in window))
    throw new Error("System voices are not available in this browser.");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speed;
  if (language !== "auto") utterance.lang = language;
  utterance.voice = speechSynthesis.getVoices().find((entry) => entry.voiceURI === voice) ?? null;
  let done: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const finished = new Promise<void>((resolve, fail) => {
    done = resolve;
    reject = fail;
  });
  utterance.onend = done;
  utterance.onerror = () => reject(new Error("The system voice could not read this response."));
  const listeners = new Set<(word: SpokenWord | null) => void>();
  // Some voices, such as Chrome's network voices, send no boundaries; those read unhighlighted.
  utterance.onboundary = (event) => {
    if (event.name !== "word") return;
    const word = spokenWordAt(text, event.charIndex);
    for (const listener of listeners) listener(word);
  };
  let started = false;
  return {
    play: async () => {
      if (started) speechSynthesis.resume();
      else {
        started = true;
        speechSynthesis.resume();
        speechSynthesis.speak(utterance);
      }
    },
    pause: () => speechSynthesis.pause(),
    stop: () => {
      utterance.onerror = null;
      speechSynthesis.cancel();
      done();
    },
    finished,
    words: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const catalogs = new WeakMap<AbortSignal, Promise<SpeechSynthesisCatalog>>();

export const warmReadAloud = createReadAloudWarmup(async (environmentId, model) => {
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) throw new Error("The read-aloud environment is not connected.");
  await runEnvironmentSpeech(prepareSpeechSynthesis(prepared, model));
});

export const readAloudController = createReadAloudController(async (text, settings, signal) => {
  if (settings.provider === "system")
    return systemPlayback(text, settings.voice, settings.speed, settings.language);
  if (settings.provider === "off") throw new Error("Enable read aloud in Settings → Voice.");
  const prepared = settings.environmentId ? readPreparedConnection(settings.environmentId) : null;
  if (!prepared)
    throw new Error("Connect to the read-aloud environment selected in Settings → Voice.");
  let pendingCatalog = catalogs.get(signal);
  if (!pendingCatalog) {
    pendingCatalog = runEnvironmentSpeech(getSpeechSynthesisModels(prepared, settings.provider), {
      signal,
    });
    catalogs.set(signal, pendingCatalog);
  }
  const catalog = await pendingCatalog;
  signal.throwIfAborted();
  if (catalog.error) throw new Error(catalog.error);
  const model = settings.model || catalog.defaultModel;
  const { url, token } = await runEnvironmentSpeech(
    startSpeechSynthesis(prepared, settings.provider, {
      text,
      model,
      voice: settings.voice,
      speed: settings.speed,
      language: settings.language,
    }),
    { signal },
  );
  signal.throwIfAborted();
  return mediaPlayback(
    url,
    settings.speed,
    speechSpeedAppliedByProvider(catalog, model) ? settings.speed : null,
    {
      text,
      wordTimings: catalog.wordTimings ?? "estimated",
      load: (after, signal) =>
        runEnvironmentSpeech(getSpeechSynthesisTimings(prepared, token, after), { signal }),
    },
  );
}, m);
