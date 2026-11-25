import {
  getSpeechSynthesisModels,
  getSpeechSynthesisTimings,
  startSpeechSynthesis,
} from "@t3tools/client-runtime/voice-input";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  DEFAULT_READ_ALOUD_SETTINGS,
  EMPTY_SPEECH_SYNTHESIS_CATALOG,
  EnvironmentId,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import clipUrl from "../assets/notification-completion.mp3";
import { readPreparedConnection } from "../state/session";
import { READ_ALOUD_VOLUME_STORAGE_KEY, readAloudController } from "./readAloud";
import { runEnvironmentSpeech } from "./runEnvironmentSpeech";

vi.mock(import("../state/session"), { spy: true });
vi.mock(import("@t3tools/client-runtime/voice-input"), { spy: true });
vi.mock(import("./runEnvironmentSpeech"), { spy: true });

const settings = {
  ...DEFAULT_READ_ALOUD_SETTINGS,
  provider: "openai" as const,
  environmentId: EnvironmentId.make("env"),
};

/** Serves the short clip as the synthesis of "One two three.", with a word every 0.2 s. */
function setup() {
  const models = Symbol("models");
  const started = Symbol("started");
  const timings = Symbol("timings");
  const results = new Map<unknown, unknown>([
    [models, { ...EMPTY_SPEECH_SYNTHESIS_CATALOG, wordTimings: "provider" }],
    [started, { url: clipUrl, token: "clip" }],
    [
      timings,
      {
        words: [
          { start: 0, end: 3, startSeconds: 0, endSeconds: 0.15 },
          { start: 4, end: 7, startSeconds: 0.2, endSeconds: 0.35 },
          { start: 8, end: 14, startSeconds: 0.4, endSeconds: 0.55 },
        ],
        done: true,
        durationSeconds: 0.6,
      },
    ],
  ]);
  vi.mocked(readPreparedConnection).mockReturnValue({} as PreparedConnection);
  vi.mocked(getSpeechSynthesisModels).mockReturnValue(models as never);
  vi.mocked(startSpeechSynthesis).mockReturnValue(started as never);
  vi.mocked(getSpeechSynthesisTimings).mockReturnValue(timings as never);
  vi.mocked(runEnvironmentSpeech).mockImplementation(((request: unknown) =>
    results.has(request)
      ? Promise.resolve(results.get(request))
      : Promise.reject(new Error("Unexpected environment request."))) as never);
  // Muted audio may start without a user gesture.
  localStorage.setItem(READ_ALOUD_VOLUME_STORAGE_KEY, JSON.stringify({ volume: 1, muted: true }));
  return {
    [Symbol.dispose]: () => {
      readAloudController.stop();
      localStorage.removeItem(READ_ALOUD_VOLUME_STORAGE_KEY);
    },
  };
}

/** Starts reading and pauses once the whole clip has arrived. */
async function readAndPause() {
  const run = readAloudController.start("thread:1", "One two three.", settings);
  await vi.waitFor(() => expect(readAloudController.getSnapshot().status).toBe("playing"));
  readAloudController.pause();
  await vi.waitFor(() => expect(readAloudController.getProgress()?.duration).toBeLessThan(1));
  // Wrapped: an async function that returns a promise would wait for the whole reading.
  return { run };
}

const highlightedWord = () => readAloudController.getHighlight()?.word.cue.text;

it("streams speech into audio it can seek, and keeps the audio after the end", async () => {
  using _environment = setup();
  const { run } = await readAndPause();
  readAloudController.seek(0.3);
  expect(readAloudController.getProgress()).toMatchObject({ seekable: true });
  expect(readAloudController.getProgress()?.time).toBeCloseTo(0.3);

  await readAloudController.resume();
  await run;
  expect(readAloudController.getSnapshot().status).toBe("ended");
  readAloudController.seek(0.1);
  expect(readAloudController.getSnapshot().status).toBe("paused");
  expect(readAloudController.getProgress()?.time).toBeCloseTo(0.1);
  await readAloudController.resume();
  await vi.waitFor(() => expect(readAloudController.getSnapshot().status).toBe("ended"));
  expect(startSpeechSynthesis).toHaveBeenCalledTimes(1);
});

it("moves the highlighted word when the player seeks, also after the end", async () => {
  using _environment = setup();
  const { run } = await readAndPause();
  readAloudController.seek(0.45);
  await vi.waitFor(() => expect(highlightedWord()).toBe("three."));
  readAloudController.seek(0.05);
  await vi.waitFor(() => expect(highlightedWord()).toBe("One"));

  await readAloudController.resume();
  await run;
  expect(readAloudController.getSnapshot().status).toBe("ended");
  readAloudController.seek(0.25);
  await vi.waitFor(() => expect(highlightedWord()).toBe("two"));
});
