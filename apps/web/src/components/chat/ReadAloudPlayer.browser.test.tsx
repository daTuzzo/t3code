import type { SpeechPlayback } from "@t3tools/client-runtime/read-aloud";
import { DEFAULT_READ_ALOUD_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import "~/index.css";
import { getClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { READ_ALOUD_VOLUME_STORAGE_KEY, readAloudController } from "../../speech/readAloud";
import { ReadAloudPlayer } from "./ReadAloudPlayer";

const speech = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("../../speech/readAloud", async (importOriginal) => {
  const { createReadAloudController } = await import("@t3tools/client-runtime/read-aloud");
  return {
    ...(await importOriginal<typeof import("../../speech/readAloud")>()),
    readAloudController: createReadAloudController((...args) => speech.prepare(...args)),
  };
});

const settings = { ...DEFAULT_READ_ALOUD_SETTINGS, provider: "openai" as const };

function deferred<A>() {
  let resolve: (value: A) => void = () => {};
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeAudio(duration: number) {
  const finished = deferred<void>();
  const listeners = new Set<() => void>();
  const position = { time: 0, duration, buffered: duration, seekable: true, ended: false };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const playback = {
    play: vi.fn(async () => {
      position.ended = false;
    }),
    pause: vi.fn(),
    stop: vi.fn(() => finished.resolve()),
    finished: finished.promise,
    media: {
      progress: () => ({ ...position }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      seek: vi.fn((seconds: number) => {
        position.time = seconds;
        notify();
      }),
      setSpeed: vi.fn(),
      setVolume: vi.fn(),
    },
  } satisfies SpeechPlayback;
  return {
    playback,
    at: (seconds: number) => {
      position.time = seconds;
      notify();
    },
    end: () => {
      position.time = duration;
      position.ended = true;
      notify();
      finished.resolve();
    },
  };
}

const renderPlayer = () =>
  render(
    <div className="relative h-48 w-[48rem]">
      <ReadAloudPlayer threadKey="thread" />
    </div>,
  );

it("follows a reply from loading to its end, and seeks from the buttons and the keyboard", async () => {
  const audio = fakeAudio(20);
  const ready = deferred<SpeechPlayback>();
  speech.prepare.mockImplementation(() => ready.promise);
  await using screen = await renderPlayer();
  using _stop = { [Symbol.dispose]: () => readAloudController.stop() };
  const run = readAloudController.start("thread:1", "A reply.", settings);
  await expect.element(screen.getByRole("button", { name: "Stop reading" })).toBeVisible();
  await expect.element(screen.getByRole("slider", { name: "Seek" })).toBeDisabled();

  ready.resolve(audio.playback);
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  audio.at(3);
  const seek = screen.getByRole("slider", { name: "Seek" });
  await expect.element(seek).toHaveAttribute("aria-valuetext", "0:03 of 0:20");
  await userEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
  expect(audio.playback.media.seek).toHaveBeenLastCalledWith(13);
  await userEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
  expect(audio.playback.media.seek).toHaveBeenLastCalledWith(3);
  seek.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(audio.playback.media.seek).toHaveBeenLastCalledWith(8);
  await userEvent.keyboard("{End}");
  expect(audio.playback.media.seek).toHaveBeenLastCalledWith(20);

  await userEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(audio.playback.pause).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Resume reading" }));
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();

  audio.end();
  await run;
  await userEvent.click(screen.getByRole("button", { name: "Play again" }));
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(speech.prepare).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("button", { name: "Stop and close" }));
  await expect
    .element(screen.getByRole("region", { name: "Read aloud player" }))
    .not.toBeInTheDocument();
  expect(audio.playback.stop).toHaveBeenCalled();
});

it("changes speed and volume from the strip, and saves both", async () => {
  const audio = fakeAudio(20);
  speech.prepare.mockImplementation(async () => audio.playback);
  using _restore = {
    [Symbol.dispose]: () => {
      readAloudController.stop();
      localStorage.removeItem(READ_ALOUD_VOLUME_STORAGE_KEY);
      void updateClientSettings({ readAloud: DEFAULT_READ_ALOUD_SETTINGS });
    },
  };
  await using screen = await renderPlayer();
  void readAloudController.start("thread:1", "A reply.", settings);
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Playback speed" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "1.5×" }));
  expect(audio.playback.media.setSpeed).toHaveBeenLastCalledWith(1.5);
  expect(getClientSettings().readAloud.speed).toBe(1.5);
  await expect
    .element(screen.getByRole("button", { name: "Playback speed" }))
    .toHaveTextContent("1.5×");

  await userEvent.hover(screen.getByRole("button", { name: "Mute" }));
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect.element(volume).toHaveAttribute("aria-orientation", "vertical");
  await expect.element(volume).toHaveAttribute("aria-valuetext", "100%");
  volume.element().focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(audio.playback.media.setVolume).toHaveBeenLastCalledWith(0.95, false);
  expect(JSON.parse(localStorage.getItem(READ_ALOUD_VOLUME_STORAGE_KEY) ?? "null")).toEqual({
    volume: 0.95,
    muted: false,
  });
  await userEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(audio.playback.media.setVolume).toHaveBeenLastCalledWith(0.95, true);
  await expect.element(screen.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect.element(volume).toHaveAttribute("aria-valuetext", "Muted");
  await userEvent.keyboard("{Escape}");
  await expect.element(volume).not.toBeInTheDocument();
});

it("closes when reading fails, because the error is toasted where reading started", async () => {
  let fail: (error: Error) => void = () => {};
  speech.prepare.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await using screen = await renderPlayer();
  using _stop = { [Symbol.dispose]: () => readAloudController.stop() };
  const run = readAloudController.start("thread:1", "A reply.", settings);
  const strip = screen.getByRole("region", { name: "Read aloud player" });
  await expect.element(strip).toBeVisible();
  fail(new Error("The provider reached a usage limit."));
  await run;
  expect(readAloudController.getSnapshot().status).toBe("error");
  await expect.element(strip).not.toBeInTheDocument();
});
