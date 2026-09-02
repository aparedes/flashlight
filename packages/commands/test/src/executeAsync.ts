import { spawn } from "child_process";

export const executeAsync = (command: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, { shell: true });

    // Chunks already carry their own line breaks, so write them through verbatim
    child.stdout.on("data", (data: Buffer) => {
      process.stdout.write(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      // Commands can choose to log diagnostic data on stderr, not necessarily errors
      // Let's just log them and not pollute with a noisy Logger.error
      process.stdout.write(data);
    });

    child.on("error", (error) => {
      reject(new Error(`Error when running "${command}": ${error.message}`));
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Error when running "${command}": exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
