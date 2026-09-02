import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { downloadFile } from "./downloadFile";

const FFMPEG_BINARY_FOLDER_PATH = path.join(os.tmpdir(), "ffmpeg-binary");
const FFMPEG_BINARY_PATH = path.join(FFMPEG_BINARY_FOLDER_PATH, "ffmpeg");

const execAsync = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      settle(() => reject(new Error(`Could not run ${command}: ${error.message}`)));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            new Error(
              `Command "${[command, ...args].join(" ")}" failed with code ${code}${
                stderr.trim() ? `:\n${stderr.trim()}` : ""
              }`
            )
          )
        );
      } else {
        settle(resolve);
      }
    });
  });

// Static builds from https://github.com/eugeneware/ffmpeg-static (raw executables, no archive).
// ffbinaries (used before) has no macOS arm64 build at any version, which forced Rosetta.
const FFMPEG_STATIC_RELEASE = "b6.1.1";
const platformToAsset: Partial<Record<`${NodeJS.Platform}-${NodeJS.Architecture}`, string>> = {
  "darwin-arm64": "ffmpeg-darwin-arm64",
  "darwin-x64": "ffmpeg-darwin-x64",
  "linux-x64": "ffmpeg-linux-x64",
  "linux-arm64": "ffmpeg-linux-arm64",
};

const getFFMpegDownloadUrl = () => {
  const key = `${process.platform}-${process.arch}` as const;
  const asset = platformToAsset[key];
  if (!asset) {
    throw new Error(`Unsupported os ${process.platform}-${process.arch} to install FFMpeg`);
  }
  return `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_RELEASE}/${asset}`;
};

export const installFFMpeg = async () => {
  fs.mkdirSync(FFMPEG_BINARY_FOLDER_PATH, { recursive: true });

  // Download next to the final path and rename once complete, so that an interrupted download can
  // never be mistaken for a working binary
  const temporaryPath = `${FFMPEG_BINARY_PATH}.${process.pid}.download`;
  try {
    await downloadFile(getFFMpegDownloadUrl(), temporaryPath);
    fs.chmodSync(temporaryPath, 0o755);
    fs.renameSync(temporaryPath, FFMPEG_BINARY_PATH);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
};

/**
 * When coming from AWS Device Farm or certain devices, it seems the video is not encoded properly.
 * `-vsync 0` is important since we have variable frame rate from adb shell screenrecord.
 */
export const getFFMpegArgs = (filePath: string, destinationPath: string): string[] => [
  "-loglevel",
  "error",
  "-y",
  "-vsync",
  "0",
  "-i",
  filePath,
  "-c:v",
  "libx264",
  "-crf",
  "23",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  destinationPath,
];

export const processVideoFile = async (filePath: string, destinationPath: string) => {
  const ffmpegExecutable = fs.existsSync(FFMPEG_BINARY_PATH) ? FFMPEG_BINARY_PATH : "ffmpeg";

  await execAsync(ffmpegExecutable, getFFMpegArgs(filePath, destinationPath));
};
