import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import ffprobe from "ffprobe-static";
import { execa } from "execa";

export function checkFfprobeBinary(): string {
  const ffprobePath = ffprobe.path;
  if (!ffprobePath || !fs.existsSync(ffprobePath)) {
    throw new Error(`ffprobe-static binary not found. Path: ${ffprobePath}`);
  }
  return ffprobePath;
}

export interface ProbeResult {
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

export async function probeMediaSample(
  sampleBuffer: Buffer,
  timeoutMs = 12000
): Promise<ProbeResult> {
  const ffprobePath = checkFfprobeBinary();

  // Create local temp file safely
  const tempDir = os.tmpdir();
  const tempFilename = `iptv_sample_${crypto.randomBytes(16).toString("hex")}.ts`;
  const tempPath = path.join(tempDir, tempFilename);

  try {
    fs.writeFileSync(tempPath, sampleBuffer);

    const { stdout } = await execa(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,bit_rate",
        "-of",
        "json",
        tempPath
      ],
      { timeout: timeoutMs }
    );

    const parsed = JSON.parse(stdout);
    const streams = parsed?.streams || [];

    let hasVideo = false;
    let hasAudio = false;
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let bitrate: number | undefined;

    for (const s of streams) {
      if (s.codec_type === "video") {
        hasVideo = true;
        videoCodec = s.codec_name;
        width = s.width ? parseInt(s.width, 10) : undefined;
        height = s.height ? parseInt(s.height, 10) : undefined;
        if (s.bit_rate) bitrate = parseInt(s.bit_rate, 10);
      } else if (s.codec_type === "audio") {
        hasAudio = true;
        audioCodec = s.codec_name;
      }
    }

    return {
      hasVideo,
      hasAudio,
      videoCodec,
      audioCodec,
      width,
      height,
      bitrate
    };
  } catch (err: any) {
    throw new Error(`ffprobe execution failed: ${err.message}`);
  } finally {
    // Ensure temporary file is always deleted
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (cleanupErr: any) {
      console.warn(`Failed to delete temp file ${tempPath}: ${cleanupErr.message}`);
    }
  }
}
