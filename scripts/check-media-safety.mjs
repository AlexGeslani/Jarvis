#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  MEDIA_EXTENSIONS,
  findSensitiveLabels,
  parsePrivateLiterals,
  representativeFrameTimes,
} from './media-safety-lib.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'jarvis-media-safety-'));
const requireOcr = process.env.JARVIS_MEDIA_SAFETY_REQUIRE_OCR === '1';
const requireExiftool = process.env.JARVIS_MEDIA_SAFETY_REQUIRE_EXIFTOOL === '1';
const maxBuffer = 8 * 1024 * 1024;

async function run(command, args) {
  return execFileAsync(command, args, { cwd: root, encoding: 'utf8', maxBuffer });
}

async function commandAvailable(command, versionArgs) {
  try {
    await run(command, versionArgs);
    return true;
  } catch {
    return false;
  }
}

async function loadPrivateLiterals() {
  const literals = [];
  try {
    literals.push(...parsePrivateLiterals(
      await readFile(resolve(root, '.public-safety.private.json'), 'utf8'),
      '.public-safety.private.json',
    ));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (process.env.JARVIS_PUBLIC_SAFETY_PRIVATE_LITERALS_JSON) {
    literals.push(...parsePrivateLiterals(
      process.env.JARVIS_PUBLIC_SAFETY_PRIVATE_LITERALS_JSON,
      'JARVIS_PUBLIC_SAFETY_PRIVATE_LITERALS_JSON',
    ));
  }
  return [...new Set(literals)];
}

function metadataText(value, key = '') {
  const excludedKeys = new Set(['directory', 'filename', 'sourcefile']);
  if (excludedKeys.has(key.toLocaleLowerCase('en-US'))) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => metadataText(item)).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([childKey, childValue]) => metadataText(childValue, childKey)).join('\n');
  }
  return '';
}

function durationFromProbe(probe) {
  const candidates = [probe?.format?.duration, ...(probe?.streams ?? []).map((stream) => stream?.duration)];
  for (const candidate of candidates) {
    const duration = Number(candidate);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return null;
}

function safeAssetLabel(name, privateLiterals) {
  if (findSensitiveLabels(name, privateLiterals).length) {
    return `asset_id=${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
  }
  return `asset=${name}`;
}

async function candidateMedia() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'buffer', maxBuffer },
  );
  return stdout.toString('utf8').split('\0').filter(Boolean)
    .filter((name) => MEDIA_EXTENSIONS.has(extname(name).toLocaleLowerCase('en-US')))
    .sort();
}

async function compileVisionOcr() {
  if (process.platform !== 'darwin' || !await commandAvailable('swiftc', ['--version'])) return null;
  const output = resolve(scratch, 'media-ocr-vision');
  await run('swiftc', [resolve(root, 'scripts/media-ocr-vision.swift'), '-o', output]);
  return output;
}

async function extractFrame(source, timestamp, index) {
  const output = resolve(scratch, `frame-${index}.png`);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', String(timestamp), '-i', source, '-frames:v', '1', output,
  ]);
  return output;
}

const findings = [];
let decoded = 0;
let metadataInspected = 0;
let vectorInspected = 0;
let ocrSamples = 0;
let ocrBackend = 'none';
let metadataBackend = 'ffprobe';

try {
  for (const command of ['ffmpeg', 'ffprobe']) {
    if (!await commandAvailable(command, ['-version'])) {
      throw new Error(`${command} is required for candidate-media safety validation`);
    }
  }

  const hasTesseract = await commandAvailable('tesseract', ['--version']);
  const visionOcr = hasTesseract ? null : await compileVisionOcr();
  if (hasTesseract) ocrBackend = 'tesseract';
  else if (visionOcr) ocrBackend = 'apple-vision';
  else if (requireOcr) throw new Error('OCR is required but neither Tesseract nor Apple Vision OCR is available');

  const hasExiftool = await commandAvailable('exiftool', ['-ver']);
  if (hasExiftool) metadataBackend = 'ffprobe+exiftool';
  else if (requireExiftool) throw new Error('ExifTool is required but unavailable');

  const privateLiterals = await loadPrivateLiterals();
  const media = await candidateMedia();
  let frameIndex = 0;

  for (const name of media) {
    const path = resolve(root, name);
    const label = safeAssetLabel(name, privateLiterals);
    let probe;
    try {
      const { stdout } = await run('ffprobe', [
        '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
      ]);
      probe = JSON.parse(stdout);
      metadataInspected += 1;
      for (const finding of findSensitiveLabels(metadataText(probe), privateLiterals)) {
        findings.push(`${label} surface=embedded_metadata category=${finding}`);
      }
    } catch {
      findings.push(`${label} category=metadata_inspection_failed`);
      continue;
    }

    if (hasExiftool) {
      try {
        const { stdout } = await run('exiftool', ['-json', '-n', path]);
        for (const finding of findSensitiveLabels(metadataText(JSON.parse(stdout)), privateLiterals)) {
          findings.push(`${label} surface=embedded_metadata category=${finding}`);
        }
      } catch {
        findings.push(`${label} category=extended_metadata_inspection_failed`);
      }
    }

    const suffix = extname(name).toLocaleLowerCase('en-US');
    if (suffix === '.svg') {
      try {
        const source = await readFile(path, 'utf8');
        for (const finding of findSensitiveLabels(source, privateLiterals)) {
          findings.push(`${label} surface=vector_source_text category=${finding}`);
        }
        vectorInspected += 1;
      } catch {
        findings.push(`${label} category=vector_source_inspection_failed`);
      }
      continue;
    }

    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-i', path, '-f', 'null', '-']);
      decoded += 1;
    } catch {
      findings.push(`${label} category=full_decode_failed`);
      continue;
    }

    if (ocrBackend === 'none') continue;
    let inputs = [path];
    if (['.gif', '.m4v', '.mov', '.mp4', '.webm'].includes(suffix)) {
      const duration = durationFromProbe(probe);
      const timestamps = duration ? representativeFrameTimes(duration) : [0];
      inputs = [];
      for (const timestamp of timestamps) {
        try {
          inputs.push(await extractFrame(path, timestamp, frameIndex++));
        } catch {
          findings.push(`${label} category=representative_frame_extraction_failed`);
        }
      }
    }

    for (const input of inputs) {
      try {
        const { stdout } = hasTesseract
          ? await run('tesseract', [input, 'stdout', '--psm', '11'])
          : await run(visionOcr, [input]);
        ocrSamples += 1;
        for (const finding of findSensitiveLabels(stdout, privateLiterals)) {
          findings.push(`${label} surface=visible_text category=${finding}`);
        }
      } catch {
        findings.push(`${label} category=ocr_failed`);
      }
    }
  }

  if (findings.length) {
    console.error(`media_safety=failed findings=${new Set(findings).size}`);
    for (const finding of [...new Set(findings)].sort()) console.error(finding);
    process.exitCode = 1;
  } else {
    console.log(`media_safety=passed media=${media.length} decoded=${decoded} vectors=${vectorInspected} metadata=${metadataInspected} metadata_backend=${metadataBackend} ocr_samples=${ocrSamples} ocr_backend=${ocrBackend}`);
  }
} catch {
  console.error('media_safety=failed category=scanner_error findings=1');
  process.exitCode = 2;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
