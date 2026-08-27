import { spawn } from "child_process";
import { downloadFile } from "./downloadFile";
import fs from "fs";

const FFMPEG_BINARY_FOLDER_PATH = "/tmp/ffmpeg-binary";
const FFMPEG_BINARY_PATH = `${FFMPEG_BINARY_FOLDER_PATH}/ffmpeg`;

const execAsync = (command: string) =>
  new Promise<void>((resolve, reject) => {
    const parts = command.split(" ");
    const proc = spawn(parts[0], parts.slice(1));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command ${command} failed with code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on("error", reject);
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
  await downloadFile(getFFMpegDownloadUrl(), FFMPEG_BINARY_PATH);
  fs.chmodSync(FFMPEG_BINARY_PATH, 0o755);
};

export const processVideoFile = async (filePath: string, destinationPath: string) => {
  const ffmpegExecutable = fs.existsSync(FFMPEG_BINARY_PATH) ? FFMPEG_BINARY_PATH : "ffmpeg";

  // When coming from AWS Device Farm or certain devices, it seems the video is not encoded properly
  // VSync 0 is important since we have variable frame rate from adb shell screenrecord
  await execAsync(
    `${ffmpegExecutable} -y -vsync 0 -i ${filePath} -c:v libx264 -crf 23 -c:a aac -b:a 128k ${destinationPath} -loglevel error`
  );
};
