import { useState, useSyncExternalStore, type SVGProps } from "react";
import { useGT } from "gt-react";
import { Slider } from "@base-ui/react/slider";
import { PauseIcon, PlayIcon, Volume1Icon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { READ_ALOUD_SPEEDS } from "@t3tools/contracts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import {
  DEFAULT_READ_ALOUD_VOLUME,
  READ_ALOUD_VOLUME_STORAGE_KEY,
  ReadAloudVolume,
  readAloudController,
} from "../../speech/readAloud";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastReadAloudError } from "./ReadAloudButton";

const SKIP_SECONDS = 10;
const KEY_SEEK_SECONDS = 5;
const VOLUME_STEP = 0.05;
// Audio still arriving leaves this much empty track, so the bar shows that more is coming.
const GENERATING_HEADROOM_SECONDS = 8;

function formatTime(seconds: number) {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function SkipIcon({ direction, ...props }: SVGProps<SVGSVGElement> & { direction: -1 | 1 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <g transform={direction === 1 ? "matrix(-1 0 0 1 24 0)" : undefined}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </g>
      <text
        x="12"
        y="15.3"
        textAnchor="middle"
        fontSize="8"
        fontWeight={650}
        fill="currentColor"
        stroke="none"
      >
        {SKIP_SECONDS}
      </text>
    </svg>
  );
}

/** Floats over the timeline while one of this thread's replies is read aloud. */
export function ReadAloudPlayer({ threadKey }: { threadKey: string }) {
  const state = useSyncExternalStore(
    readAloudController.subscribe,
    readAloudController.getSnapshot,
  );
  // Errors are toasted where reading started, so a failed reading closes the strip.
  if (state.status === "idle" || state.status === "error" || !state.id?.startsWith(`${threadKey}:`))
    return null;
  return <ReadAloudStrip id={state.id} status={state.status} />;
}

function ReadAloudStrip({
  id,
  status,
}: {
  id: string;
  status: "loading" | "playing" | "paused" | "ended";
}) {
  const gt = useGT();
  const progress = useSyncExternalStore(
    readAloudController.subscribeProgress,
    readAloudController.getProgress,
  );
  const settings = useClientSettings((value) => value.readAloud);
  const [output, setOutput] = useLocalStorage(
    READ_ALOUD_VOLUME_STORAGE_KEY,
    DEFAULT_READ_ALOUD_VOLUME,
    ReadAloudVolume,
  );
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);

  // System voices speak without a timeline to show or move.
  const timeline = settings.provider !== "system";
  const generating = progress !== null && !Number.isFinite(progress.duration);
  const time = progress?.time ?? 0;
  const length = progress ? (generating ? progress.buffered : progress.duration) : 0;
  const scale = generating ? length + GENERATING_HEADROOM_SECONDS : length;
  const seekable = progress?.seekable === true && scale > 0;
  const level = output.muted ? 0 : output.volume;

  const playLabel =
    status === "loading"
      ? gt("Stop reading")
      : status === "playing"
        ? gt("Pause", { $context: "verb, pauses the audio being read aloud" })
        : status === "ended"
          ? gt("Play again")
          : gt("Resume reading");
  const togglePlayback = () => {
    if (status === "loading") readAloudController.stop();
    else if (status === "playing") readAloudController.pause();
    else
      void readAloudController
        .resume()
        .then(() => toastReadAloudError(id, gt("Could not read aloud")));
  };
  const changeSpeed = (speed: number) => {
    readAloudController.setSpeed(speed);
    void updateClientSettings({ readAloud: { ...getClientSettings().readAloud, speed } });
  };
  const changeOutput = (next: typeof output) => {
    readAloudController.setVolume(next.volume, next.muted);
    setOutput(next);
  };
  const changeLevel = (volume: number) =>
    changeOutput({
      volume: Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100,
      muted: false,
    });
  const toggleMute = () =>
    changeOutput(
      level === 0 ? { volume: output.volume || 0.5, muted: false } : { ...output, muted: true },
    );
  const VolumeIcon = level === 0 ? VolumeXIcon : level < 0.5 ? Volume1Icon : Volume2Icon;

  return (
    <div className="@container pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center ps-(--chat-lane-inset-start) pe-(--chat-lane-inset-end)">
      <div
        role="region"
        aria-label={gt("Read aloud player")}
        className="surface-glass pointer-events-auto flex h-10 min-w-0 max-w-[calc(100%-2rem)] items-center gap-0.5 rounded-full border border-border/60 p-1 tabular-nums shadow-lg/5 select-none transition-[opacity,translate] duration-200 starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none [-webkit-app-region:no-drag]"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm-pill"
                variant="default"
                aria-label={playLabel}
                onClick={togglePlayback}
              >
                {status === "loading" ? (
                  <Spinner />
                ) : status === "playing" ? (
                  <PauseIcon className="fill-current" />
                ) : (
                  <PlayIcon className="fill-current" />
                )}
              </Button>
            }
          />
          <TooltipPopup>{playLabel}</TooltipPopup>
        </Tooltip>
        {timeline && (
          <>
            {(
              [
                [-1, gt("Back 10 seconds")],
                [1, gt("Forward 10 seconds")],
              ] as const
            ).map(([direction, label]) => (
              <Tooltip key={direction}>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm-pill"
                      variant="ghost-muted"
                      aria-label={label}
                      disabled={!seekable}
                      className="@max-lg:hidden"
                      onClick={() => readAloudController.seek(time + direction * SKIP_SECONDS)}
                    >
                      <SkipIcon direction={direction} />
                    </Button>
                  }
                />
                <TooltipPopup>{label}</TooltipPopup>
              </Tooltip>
            ))}
            <span className="min-w-9 px-0.5 text-center text-xs text-muted-foreground">
              {formatTime(scrubbing ?? time)}
            </span>
            <Slider.Root
              value={Math.min(scrubbing ?? time, scale)}
              min={0}
              max={Math.max(scale, 1)}
              step={0.1}
              largeStep={30}
              disabled={!seekable}
              onValueChange={(value) => setScrubbing(value)}
              onValueCommitted={(value) => {
                readAloudController.seek(value);
                setScrubbing(null);
              }}
              className="mx-1.5 w-[clamp(6rem,30cqw,15rem)] min-w-16 shrink"
            >
              <Slider.Control className="group/seek flex h-7 w-full cursor-pointer touch-none items-center data-disabled:cursor-default">
                <Slider.Track className="relative h-0.75 w-full rounded-full bg-foreground/10 transition-[height] group-hover/seek:h-1.25 group-data-dragging/seek:h-1.25 group-has-focus-visible/seek:h-1.25">
                  <div
                    aria-hidden
                    className="absolute inset-y-0 start-0 rounded-full bg-primary/24"
                    style={{
                      width: `${scale > 0 ? Math.min(1, (progress?.buffered ?? 0) / scale) * 100 : 0}%`,
                    }}
                  />
                  <Slider.Indicator className="rounded-full bg-primary" />
                  <Slider.Thumb
                    getAriaLabel={() => gt("Seek")}
                    getAriaValueText={(_formatted, value) =>
                      gt("{elapsed} of {total}", {
                        elapsed: formatTime(value),
                        total: formatTime(length),
                      })
                    }
                    onKeyDown={(event) => {
                      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[
                        event.key
                      ];
                      if (!step) return;
                      event.preventDefault();
                      readAloudController.seek(time + step * KEY_SEEK_SECONDS);
                    }}
                    className="size-2.5 scale-0 rounded-full bg-primary-foreground shadow-sm ring-1 ring-primary/60 transition-transform group-hover/seek:scale-100 data-dragging:scale-100 has-focus-visible:scale-100 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
                  />
                </Slider.Track>
              </Slider.Control>
            </Slider.Root>
            <span className="min-w-9 px-0.5 text-center text-xs text-muted-foreground">
              {formatTime(length)}
            </span>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <Button
                          size="sm-pill"
                          variant="ghost-muted"
                          aria-label={gt("Playback speed")}
                        />
                      }
                    />
                  }
                >
                  {/* Wide enough for every speed, so changing it does not move the strip. */}
                  <span className="min-w-9 text-center">{settings.speed}×</span>
                </TooltipTrigger>
                <TooltipPopup>{gt("Playback speed")}</TooltipPopup>
              </Tooltip>
              <MenuPopup width="content">
                <MenuRadioGroup
                  value={settings.speed}
                  onValueChange={(value: number) => changeSpeed(value)}
                >
                  {READ_ALOUD_SPEEDS.map((speed) => (
                    <MenuRadioItem key={speed} value={speed} closeOnClick>
                      {speed}×
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            {/* The slider opens on hover, so the button itself only mutes. */}
            <Popover open={volumeOpen} onOpenChange={setVolumeOpen}>
              <PopoverTrigger
                openOnHover
                delay={150}
                closeDelay={200}
                render={
                  <Button
                    size="icon-sm-pill"
                    variant="ghost-muted"
                    aria-label={level === 0 ? gt("Unmute") : gt("Mute")}
                  />
                }
                onClick={(event) => {
                  (
                    event as typeof event & { preventBaseUIHandler?: () => void }
                  ).preventBaseUIHandler?.();
                  // Touch has no hover, so a tap opens the slider instead.
                  if ((event.nativeEvent as Partial<PointerEvent>).pointerType === "touch")
                    setVolumeOpen(true);
                  else toggleMute();
                }}
                onKeyDown={(event) => {
                  const step = { ArrowDown: -1, ArrowUp: 1, PageDown: -4, PageUp: 4 }[event.key];
                  if (!step) return;
                  event.preventDefault();
                  changeLevel(level + step * VOLUME_STEP);
                  setVolumeOpen(true);
                }}
                onWheel={(event) => changeLevel(level + Math.sign(-event.deltaY) * VOLUME_STEP)}
              >
                <VolumeIcon />
              </PopoverTrigger>
              <PopoverPopup padding="compact" initialFocus={false}>
                <div
                  className="flex flex-col items-center gap-1.5"
                  onWheel={(event) => changeLevel(level + Math.sign(-event.deltaY) * VOLUME_STEP)}
                >
                  <Slider.Root
                    orientation="vertical"
                    value={Math.round(level * 100)}
                    min={0}
                    max={100}
                    step={VOLUME_STEP * 100}
                    onValueChange={(value) => changeLevel(value / 100)}
                    className="h-24"
                  >
                    <Slider.Control className="group/volume flex h-full w-6 cursor-pointer touch-none justify-center">
                      <Slider.Track className="relative h-full w-1 rounded-full bg-foreground/10 transition-[width] group-hover/volume:w-1.5 group-data-dragging/volume:w-1.5">
                        <Slider.Indicator className="rounded-full bg-primary" />
                        <Slider.Thumb
                          getAriaLabel={() => gt("Volume")}
                          getAriaValueText={(_formatted, value) =>
                            value === 0
                              ? gt("Muted")
                              : gt("{percent}%", { percent: Math.round(value) })
                          }
                          className="size-2.5 rounded-full bg-primary-foreground shadow-sm ring-1 ring-primary/60 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
                        />
                      </Slider.Track>
                    </Slider.Control>
                  </Slider.Root>
                  <span aria-hidden className="text-2xs text-muted-foreground tabular-nums">
                    {Math.round(level * 100)}
                  </span>
                </div>
              </PopoverPopup>
            </Popover>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm-pill"
                variant="ghost-muted"
                aria-label={gt("Stop and close")}
                onClick={() => readAloudController.stop()}
              >
                <XIcon />
              </Button>
            }
          />
          <TooltipPopup>{gt("Stop and close")}</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}
