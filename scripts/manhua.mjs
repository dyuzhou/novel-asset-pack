#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildPrompt } from './prompt-builder.mjs';

export const PHASES = [
  ['01-source-analysis', '原著解析与世界观建立'],
  ['02-art-direction', '美术总监与视觉体系设计'],
  ['03-master-assets', '主资产设计与生成'],
  ['04-derived-assets', '衍生资产生成'],
  ['05-screenplay', '原著忠实型剧本'],
  ['06-storyboard', '分镜设计与分镜图生成'],
  ['07-video', '视频生成'],
  ['08-audio-qc', '音频与最终质量审核'],
];

export const PHASE_STATUSES = [
  'NOT_STARTED', 'IN_PROGRESS', 'VALIDATING', 'PENDING_REVIEW',
  'APPROVED', 'REJECTED', 'FAILED', 'BLOCKED', 'STALE', 'SKIPPED',
];

const DATA_FILES = {
  source_index: 'data/source_index.json',
  continuity: 'data/continuity.json',
  source_evidence: 'data/source_evidence.json',
  story_events: 'data/story_events.json',
  event_beats: 'data/event_beats.json',
  characters: 'data/characters.json',
  factions: 'data/factions.json',
  scenes: 'data/scenes.json',
  props: 'data/props.json',
  timeline: 'data/timeline.json',
  asset_registry: 'data/asset_registry.json',
  visual_style: 'data/visual_style.json',
  costume_rules: 'data/costume_rules.json',
  screenplay: 'data/screenplay.json',
  story_coverage: 'data/story_coverage.json',
  storyboard: 'data/storyboard.json',
  production_tasks: 'data/production_tasks.json',
  audio_timeline: 'data/audio_timeline.json',
  quality_reports: 'data/quality_reports.json',
  approvals: 'data/approvals.json',
};

const COLLECTIONS = {
  source_index: 'chapters',
  continuity: 'chapters',
  source_evidence: 'evidence',
  story_events: 'events',
  event_beats: 'beats',
  characters: 'characters',
  factions: 'factions',
  scenes: 'scenes',
  props: 'props',
  timeline: 'events',
  asset_registry: 'assets',
  costume_rules: 'rules',
  screenplay: 'scenes',
  story_coverage: 'coverage',
  storyboard: 'shots',
  production_tasks: 'tasks',
  audio_timeline: 'tracks',
};

const STAGE_SNAPSHOT_FILES = {
  '01-source-analysis': ['source_index', 'continuity', 'source_evidence', 'story_events', 'characters', 'factions', 'scenes', 'props', 'timeline'],
  '02-art-direction': ['visual_style', 'costume_rules'],
  '03-master-assets': ['asset_registry'],
  '04-derived-assets': ['asset_registry'],
  '05-screenplay': ['continuity', 'screenplay', 'story_coverage', 'event_beats'],
  '06-storyboard': ['storyboard'],
  '07-video': ['production_tasks'],
  '08-audio-qc': ['audio_timeline', 'production_tasks', 'quality_reports'],
};

const IMAGE_DIRS = {
  character: 'images/角色',
  scene: 'images/场景',
  prop: 'images/道具',
  storyboard: 'images/分镜',
  qc: 'images/质检',
};

const SEGMENT_TYPES = new Set(['DIALOGUE', 'NARRATION', 'INNER_MONOLOGUE', 'ACTION', 'ENVIRONMENT']);
const TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'FAILED', 'COMPLETED', 'CANCELLED', 'STALE']);
const APPROVAL_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'REGENERATE']);
const FACT_PROVENANCE = new Set(['SOURCE_FACT', 'INFERENCE', 'ART_DECISION', 'UNKNOWN']);
const SCHEMA_FILES = {
  project: 'project.schema.json',
  source_index: 'source-index.schema.json',
  continuity: 'continuity.schema.json',
  source_evidence: 'source-evidence.schema.json',
  story_events: 'story-events.schema.json',
  event_beats: 'event-beats.schema.json',
  characters: 'character.schema.json',
  factions: 'factions.schema.json',
  scenes: 'scene.schema.json',
  props: 'props.schema.json',
  timeline: 'timeline.schema.json',
  asset_registry: 'asset.schema.json',
  visual_style: 'visual-style.schema.json',
  costume_rules: 'costume-rules.schema.json',
  screenplay: 'screenplay.schema.json',
  story_coverage: 'story-coverage.schema.json',
  storyboard: 'storyboard.schema.json',
  production_tasks: 'production-tasks.schema.json',
  audio_timeline: 'audio-timeline.schema.json',
  quality_reports: 'quality-reports.schema.json',
  approvals: 'approvals.schema.json',
};
const schemaValidator = new Ajv2020({ allErrors: true, strict: false });
addFormats(schemaValidator);
const schemaChecks = new Map(
  Object.entries(SCHEMA_FILES).map(([key, file]) => [
    key,
    schemaValidator.compile(JSON.parse(fs.readFileSync(new URL(`../schemas/${file}`, import.meta.url), 'utf8'))),
  ]),
);

const isNonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const asArray = (value) => Array.isArray(value) ? value : [];
const now = () => new Date().toISOString();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function safePath(root, relativePath) {
  if (!isNonEmpty(relativePath)) return null;
  const portablePath = relativePath.replace(/\\/g, '/');
  if (path.isAbsolute(portablePath) || /^[A-Za-z]:\//.test(portablePath) || portablePath.startsWith('//')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...portablePath.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(resolvedRoot)) return resolved;
  const actualRoot = fs.realpathSync(resolvedRoot);
  let probe = resolved;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const actualProbe = fs.realpathSync(probe);
  const realRelative = path.relative(actualRoot, actualProbe);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
  if (fs.existsSync(resolved)) {
    const actualFile = fs.realpathSync(resolved);
    const fileRelative = path.relative(actualRoot, actualFile);
    if (fileRelative.startsWith('..') || path.isAbsolute(fileRelative)) return null;
  }
  return resolved;
}

const toPosixPath = (value) => typeof value === 'string' ? value.replace(/\\/g, '/') : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, json(value), 'utf8');
  fs.renameSync(temp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON ${file}: ${error.message}`);
  }
}

function slug(value) {
  const ascii = String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ascii || `project-${crypto.randomUUID().slice(0, 8)}`;
}

function emptyData() {
  return {
    source_index: { chapters: [] },
    continuity: { chapters: [] },
    source_evidence: { evidence: [] },
    story_events: { events: [] },
    event_beats: { beats: [] },
    characters: { characters: [] },
    factions: { factions: [] },
    scenes: { scenes: [] },
    props: { props: [] },
    timeline: { events: [] },
    asset_registry: { assets: [] },
    visual_style: {
      visual_style: '',
      aspect_ratio: '16:9',
      color_palette: [],
      lighting_rules: [],
      era_constraints: { allowed_elements: [], forbidden_elements: [] },
      quality_constraints: [],
      negative_constraints: [],
    },
    costume_rules: { rules: [] },
    screenplay: { scenes: [] },
    story_coverage: { coverage: [] },
    storyboard: { shots: [] },
    production_tasks: { tasks: [] },
    audio_timeline: { tracks: [] },
    quality_reports: { reports: [] },
    approvals: { approvals: [] },
  };
}

export function createProject(title, createdAt = now()) {
  const projectId = slug(title);
  return {
    schema_version: '1.0',
    project_id: projectId,
    title,
    created_at: createdAt,
    source_scope: '',
    source_files: [],
    source_fidelity: true,
    aspect_ratio: '16:9',
    world_bible: 'world/world_bible.md',
    data_files: { ...DATA_FILES },
    phases: PHASES.map(([id, name]) => ({
      id, name, status: 'NOT_STARTED', version: 1,
      started_at: null, approved_at: null, approved_by: null,
      approval_note: '', snapshot_sha256: null, skipped_reason: null, skipped_by: null, skipped_at: null,
    })),
    current_phase: null,
  };
}

export function initializeProject(title, directory) {
  if (!isNonEmpty(title)) throw new Error('项目名称不能为空。');
  const root = path.resolve(directory);
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    throw new Error(`目标目录非空，拒绝覆盖：${root}`);
  }
  fs.mkdirSync(root, { recursive: true });
  for (const relative of [
    'source', 'world', 'data', 'images/角色', 'images/场景', 'images/道具',
    'images/分镜', 'images/质检', 'storyboards', 'videos', 'audio', 'output', 'reports', 'logs',
  ]) fs.mkdirSync(path.join(root, relative), { recursive: true });

  writeJson(path.join(root, 'project.json'), createProject(title));
  for (const [key, file] of Object.entries(DATA_FILES)) {
    writeJson(path.join(root, file), emptyData()[key]);
  }
  fs.writeFileSync(
    path.join(root, 'world/world_bible.md'),
    `# ${title} · 世界观设定\n\n> 待阶段 01 根据原著填写。所有设定需标注来源类型和原著出处。\n`,
    'utf8',
  );
  return root;
}

export function loadProject(directory) {
  const root = path.resolve(directory);
  const projectFile = path.join(root, 'project.json');
  if (!fs.existsSync(projectFile)) throw new Error(`找不到项目文件：${projectFile}`);
  const project = readJson(projectFile);
  if (!Array.isArray(project.source_files)) {
    throw new Error('project.source_files 必须是统一登记的来源文件数组。');
  }
  for (const [index, entry] of project.source_files.entries()) {
    if (!(typeof entry === 'string' && isNonEmpty(entry)) &&
        !(entry && typeof entry === 'object' && isNonEmpty(entry.path))) {
      throw new Error(`project.source_files[${index}] 缺少有效 path。`);
    }
  }
  const data = {};
  const files = {};
  for (const [key, fallback] of Object.entries(DATA_FILES)) {
    const relative = project.data_files?.[key] ?? fallback;
    const file = safePath(root, relative);
    if (!file) throw new Error(`项目数据路径无效：data_files.${key}=${relative}`);
    files[key] = file;
    if (!fs.existsSync(file)) throw new Error(`缺少项目数据文件：${relative}`);
    data[key] = readJson(file);
  }
  const worldBible = safePath(root, project.world_bible);
  if (!worldBible) throw new Error(`世界观文件路径无效：${project.world_bible}`);
  const context = { root, project, data, files, worldBible };
  let projectChanged = false;
  const changedDataFiles = new Set();
  for (const [key, relative] of Object.entries(project.data_files ?? {})) {
    const portable = toPosixPath(relative);
    if (portable !== relative) {
      project.data_files[key] = portable;
      projectChanged = true;
    }
  }
  if (toPosixPath(project.world_bible) !== project.world_bible) {
    project.world_bible = toPosixPath(project.world_bible);
    projectChanged = true;
  }
  const sourceRecords = new Map(asArray(project.source_files).map((entry) => {
    const record = typeof entry === 'string' ? { path: entry } : entry;
    if (typeof entry === 'string') projectChanged = true;
    return [toPosixPath(record?.path), record];
  }).filter(([file]) => isNonEmpty(file)));
  for (const chapter of list(data, 'source_index')) {
    if (!isNonEmpty(chapter.source_file)) continue;
    const portableChapterPath = toPosixPath(chapter.source_file);
    if (portableChapterPath !== chapter.source_file) projectChanged = true;
    chapter.source_file = portableChapterPath;
    const file = safePath(root, chapter.source_file);
    const currentHash = file && fs.existsSync(file) && fs.statSync(file).isFile()
      ? sha256(fs.readFileSync(file))
      : null;
    const record = sourceRecords.get(chapter.source_file) ?? { path: chapter.source_file };
    if (!sourceRecords.has(chapter.source_file)) projectChanged = true;
    if (!record.sha256 && currentHash) {
      record.sha256 = currentHash;
      projectChanged = true;
    }
    if (!chapter.source_file_hash && record.sha256) {
      chapter.source_file_hash = record.sha256;
      projectChanged = true;
    }
    sourceRecords.set(chapter.source_file, record);
  }
  for (const record of sourceRecords.values()) {
    const file = safePath(root, record.path);
    if (!record.sha256 && file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      record.sha256 = sha256(fs.readFileSync(file));
      projectChanged = true;
    }
  }
  project.source_files = [...sourceRecords.values()];
  for (const record of project.source_files) {
    const portable = toPosixPath(record.path);
    if (portable !== record.path) {
      record.path = portable;
      projectChanged = true;
    }
  }
  for (const collectionName of ['asset_registry', 'storyboard', 'production_tasks', 'audio_timeline', 'source_evidence']) {
    const field = collectionName === 'storyboard' ? 'image_file'
      : collectionName === 'production_tasks' ? 'output_file'
        : collectionName === 'audio_timeline' ? 'file'
          : collectionName === 'source_evidence' ? 'source_file' : 'file';
    const collection = list(data, collectionName);
    for (const item of collection) {
      if (typeof item[field] === 'string' && item[field] !== toPosixPath(item[field])) {
        item[field] = toPosixPath(item[field]);
        changedDataFiles.add(collectionName);
      }
    }
  }
  for (const record of project.source_files) {
    const chapter = list(data, 'source_index').find((entry) => entry.source_file === record.path);
    if (chapter && !chapter.source_file_hash && record.sha256) chapter.source_file_hash = record.sha256;
  }
  if (projectChanged) {
    writeJson(projectFile, project);
    writeJson(files.source_index, data.source_index);
  }
  for (const key of changedDataFiles) writeJson(files[key], data[key]);
  return context;
}

function issue(ruleId, file, objectId, message, suggestion, severity = 'ERROR') {
  return { rule_id: ruleId, file, object_id: objectId ?? null, severity, message, suggestion };
}

function list(data, key) {
  const collection = COLLECTIONS[key];
  return collection ? asArray(data[key]?.[collection]) : [];
}

function hasReferences(actual, known) {
  return asArray(actual).every((id) => known.has(typeof id === 'string' ? id : id?.chapter_id));
}

function chapterIds(data) {
  return new Set(list(data, 'source_index').map((item) => item?.id).filter(isNonEmpty));
}

function entityIds(data, key) {
  return new Set(list(data, key).map((item) => item?.id).filter(isNonEmpty));
}

function assetVersions(data) {
  return new Map(list(data, 'asset_registry').map((asset) => [asset?.version_id, asset]).filter(([id]) => isNonEmpty(id)));
}

function pngInfo(file) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!file.subarray(0, 8).equals(signature)) return null;
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  let offset = 8;
  let header;
  let ended = false;
  const imageData = [];
  while (offset + 12 <= file.length) {
    const length = file.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > file.length) return null;
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (crc32(file.subarray(offset + 4, offset + 8 + length)) !== file.readUInt32BE(offset + 8 + length)) return null;
    if (type === 'IHDR') {
      if (header || length !== 13) return null;
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') {
      if (length !== 0) return null;
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!header?.width || !header.height || !imageData.length || !ended || offset !== file.length) return null;
  try {
    const decoded = zlib.inflateSync(Buffer.concat(imageData));
    if (!decoded.length) return null;
    if (!header.interlace) {
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[header.colorType];
      if (!channels || ![1, 2, 4, 8, 16].includes(header.bitDepth)) return null;
      const rowBytes = Math.ceil(header.width * channels * header.bitDepth / 8) + 1;
      if (decoded.length !== rowBytes * header.height) return null;
    }
    return { width: header.width, height: header.height };
  } catch {
    return null;
  }
}

function jpegDimensions(file) {
  if (file[0] === 0xff && file[1] === 0xd8) {
    let offset = 2;
    let dimensions = null;
    let hasScan = false;
    while (offset + 8 < file.length) {
      if (file[offset] !== 0xff) {
        if (hasScan) {
          offset++;
          continue;
        }
        return null;
      }
      while (file[offset] === 0xff) offset++;
      const marker = file[offset++];
      if (marker === 0xda) {
        hasScan = true;
        break;
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > file.length) break;
      const length = file.readUInt16BE(offset);
      if (length < 2 || offset + length > file.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        dimensions = { height: file.readUInt16BE(offset + 3), width: file.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
    return dimensions && hasScan && file[file.length - 2] === 0xff && file[file.length - 1] === 0xd9
      ? dimensions
      : null;
  }
  return null;
}

function webpDimensions(file) {
  if (file.length >= 30 && file.toString('ascii', 0, 4) === 'RIFF' &&
      file.readUInt32LE(4) + 8 === file.length && file.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = file.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && file.length >= 30) {
      return {
        width: 1 + file[24] + (file[25] << 8) + (file[26] << 16),
        height: 1 + file[27] + (file[28] << 8) + (file[29] << 16),
      };
    }
    if (chunk === 'VP8L' && file.length >= 25 && file[20] === 0x2f) {
      return {
        width: 1 + file[21] + ((file[22] & 0x3f) << 8),
        height: 1 + (file[22] >> 6) + (file[23] << 2) + ((file[24] & 0x0f) << 10),
      };
    }
  }
  return null;
}

function imageDimensions(file) {
  return pngInfo(file) ?? jpegDimensions(file) ?? webpDimensions(file);
}

function isImageFile(file) {
  return Boolean(imageDimensions(file));
}

function boxes(buffer, start = 0, end = buffer.length) {
  const found = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    found.push({ type, start: offset, end: offset + size, payload: offset + headerSize });
    offset += size;
  }
  return found;
}

function probeBasicMp4(buffer) {
  const rootBoxes = boxes(buffer);
  const moov = rootBoxes.find((box) => box.type === 'moov');
  const hasFtyp = rootBoxes.some((box) => box.type === 'ftyp');
  const hasMdat = rootBoxes.some((box) => box.type === 'mdat' && box.end - box.payload > 0);
  if (!hasFtyp || !moov || !hasMdat) return { valid: false, reason: 'MP4 缺少有效 ftyp、moov 或非空 mdat 容器。' };
  const tracks = [];
  for (const track of boxes(buffer, moov.payload, moov.end).filter((box) => box.type === 'trak')) {
    const trackBoxes = boxes(buffer, track.payload, track.end);
    const tkhd = trackBoxes.find((box) => box.type === 'tkhd');
    const mdia = trackBoxes.find((box) => box.type === 'mdia');
    if (!mdia) continue;
    const mediaBoxes = boxes(buffer, mdia.payload, mdia.end);
    const hdlr = mediaBoxes.find((box) => box.type === 'hdlr');
    const mdhd = mediaBoxes.find((box) => box.type === 'mdhd');
    const minf = mediaBoxes.find((box) => box.type === 'minf');
    const stbl = minf && boxes(buffer, minf.payload, minf.end).find((box) => box.type === 'stbl');
    const stsd = stbl && boxes(buffer, stbl.payload, stbl.end).find((box) => box.type === 'stsd');
    const stsz = stbl && boxes(buffer, stbl.payload, stbl.end).find((box) => box.type === 'stsz');
    if (!hdlr || hdlr.payload + 12 > hdlr.end) continue;
    const type = buffer.toString('ascii', hdlr.payload + 8, hdlr.payload + 12) === 'vide' ? 'video'
      : buffer.toString('ascii', hdlr.payload + 8, hdlr.payload + 12) === 'soun' ? 'audio' : null;
    if (!type) continue;
    const version = mdhd ? buffer[mdhd.payload] : 0;
    const timescaleOffset = mdhd ? mdhd.payload + (version === 1 ? 20 : 12) : 0;
    const durationOffset = mdhd ? mdhd.payload + (version === 1 ? 24 : 16) : 0;
    const timescale = mdhd && timescaleOffset + 4 <= mdhd.end ? buffer.readUInt32BE(timescaleOffset) : 0;
    const durationUnits = !mdhd ? 0 : version === 1 && durationOffset + 8 <= mdhd.end
      ? Number(buffer.readBigUInt64BE(durationOffset))
      : durationOffset + 4 <= mdhd.end ? buffer.readUInt32BE(durationOffset) : 0;
    const sampleCount = stsz && stsz.payload + 12 <= stsz.end ? buffer.readUInt32BE(stsz.payload + 8) : 0;
    const codec = stsd && stsd.payload + 16 <= stsd.end
      ? buffer.toString('ascii', stsd.payload + 12, stsd.payload + 16)
      : '';
    tracks.push({
      codec_name: codec,
      codec_type: type,
      duration: timescale ? durationUnits / timescale : 0,
      sample_count: sampleCount,
      width: type === 'video' && tkhd?.end >= tkhd.start + 8
        ? buffer.readUInt32BE(tkhd.end - 8) >>> 16
        : undefined,
      height: type === 'video' && tkhd?.end >= tkhd.start + 4
        ? buffer.readUInt32BE(tkhd.end - 4) >>> 16
        : undefined,
    });
  }
  const video = tracks.find((track) => track.codec_type === 'video');
  if (!video || !video.codec_name || !video.sample_count || !video.width || !video.height || !(video.duration > 0)) {
    return { valid: false, reason: 'MP4 容器中没有可验证的非空视频流、分辨率或正时长。' };
  }
  return { valid: true, streams: tracks, duration: Math.max(...tracks.map((track) => track.duration)) };
}

function probeBasicWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { valid: false, reason: 'WAV 缺少完整 RIFF/WAVE 头。' };
  }
  let offset = 12;
  let format = null;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + size > buffer.length) return { valid: false, reason: 'WAV chunk 长度超出文件。' };
    if (chunk === 'fmt ' && size >= 16) {
      format = {
        codec_name: `pcm_${buffer.readUInt16LE(payload)}`,
        channels: buffer.readUInt16LE(payload + 2),
        sample_rate: buffer.readUInt32LE(payload + 4),
        byte_rate: buffer.readUInt32LE(payload + 8),
      };
    } else if (chunk === 'data') dataSize = size;
    offset = payload + size + (size % 2);
  }
  if (!format || !format.channels || !format.sample_rate || !format.byte_rate || !dataSize) {
    return { valid: false, reason: 'WAV 缺少有效 fmt 或非空 data 音频流。' };
  }
  return { valid: true, streams: [{ ...format, codec_type: 'audio' }], duration: dataSize / format.byte_rate };
}

function probeBasicMp3(buffer) {
  let offset = buffer.toString('ascii', 0, 3) === 'ID3' && buffer.length >= 10
    ? 10 + ((buffer[6] & 0x7f) << 21) + ((buffer[7] & 0x7f) << 14) + ((buffer[8] & 0x7f) << 7) + (buffer[9] & 0x7f)
    : 0;
  for (; offset + 4 <= buffer.length; offset++) {
    const header = buffer.readUInt32BE(offset);
    const bitrateIndex = (header >>> 12) & 0xf;
    const sampleRateIndex = (header >>> 10) & 0x3;
    if ((header >>> 21) === 0x7ff && bitrateIndex > 0 && bitrateIndex < 15 && sampleRateIndex < 3) {
      const version = (header >>> 19) & 0x3;
      const bitrateTable = version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const bitrate = bitrateTable[bitrateIndex] * 1000;
      return {
        valid: true,
        streams: [{ codec_name: 'mp3', codec_type: 'audio' }],
        duration: (buffer.length - offset) * 8 / bitrate,
      };
    }
  }
  return { valid: false, reason: 'MP3 中没有可识别的有效 MPEG 音频帧。' };
}

function probeMediaFile(file, mediaType) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,sample_rate,channels:format=duration',
    '-of', 'json', file,
  ], { encoding: 'utf8', windowsHide: true });
  if (!result.error || result.error.code !== 'ENOENT') {
    if (result.status !== 0) {
      return { valid: false, level: 'FFPROBE', reason: result.stderr.trim() || 'FFprobe 无法读取媒体文件。' };
    }
    try {
      const metadata = JSON.parse(result.stdout);
      const streams = asArray(metadata.streams);
      const formatDuration = Number(metadata.format?.duration);
      const requiredStream = mediaType === 'VIDEO' ? 'video' : 'audio';
      const stream = streams.find((entry) => entry.codec_type === requiredStream);
      if (!stream) return { valid: false, level: 'FFPROBE', reason: `媒体中缺少 ${requiredStream} 流。` };
      return {
        valid: Number.isFinite(formatDuration) && formatDuration > 0,
        level: 'FFPROBE',
        reason: Number.isFinite(formatDuration) && formatDuration > 0 ? '' : '媒体时长不是正数。',
        streams,
        duration: formatDuration,
      };
    } catch (error) {
      return { valid: false, level: 'FFPROBE', reason: `FFprobe 元数据无法解析：${error.message}` };
    }
  }

  const buffer = fs.readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  const basic = extension === '.mp4' || extension === '.m4v' || extension === '.mov'
    ? probeBasicMp4(buffer)
    : extension === '.wav' ? probeBasicWav(buffer)
      : extension === '.mp3' ? probeBasicMp3(buffer)
        : { valid: false, reason: `不支持的 ${mediaType} 文件扩展名：${extension || '无扩展名'}。` };
  return { ...basic, level: 'BASIC' };
}

function aspectRatio(dimensions) {
  if (!dimensions?.width || !dimensions?.height) return null;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(dimensions.width, dimensions.height);
  return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function checkCollectionIds(data) {
  const issues = [];
  const seen = new Map();
  for (const key of Object.keys(COLLECTIONS)) {
    for (const item of list(data, key)) {
      const id = key === 'source_evidence' ? item?.source_id : item?.id;
      if (!isNonEmpty(id)) {
        issues.push(issue('DATA-ID-REQUIRED', DATA_FILES[key], null, '记录缺少非空稳定 id。', '为每条记录分配稳定且唯一的 id。'));
      } else if (seen.has(id)) {
        issues.push(issue('DATA-ID-DUPLICATE', DATA_FILES[key], id, `id 与 ${seen.get(id)} 中的记录重复。`, '为每种实体分配全局唯一 id。'));
      } else {
        seen.set(id, key);
      }
    }
  }
  const versionIds = new Set();
  for (const asset of list(data, 'asset_registry')) {
    if (!isNonEmpty(asset?.version_id)) {
      issues.push(issue('ASSET-VERSION-ID', DATA_FILES.asset_registry, asset?.asset_id, '资产版本缺少 version_id。', '使用稳定且唯一的版本 ID，例如 char-001-v001。'));
    } else if (versionIds.has(asset.version_id)) {
      issues.push(issue('ASSET-VERSION-DUPLICATE', DATA_FILES.asset_registry, asset.asset_id, `重复的资产版本 ${asset.version_id}。`, '为重新生成的文件新增版本记录，不要覆盖旧版本。'));
    } else versionIds.add(asset.version_id);
    if (!isNonEmpty(asset?.asset_id) || !Number.isInteger(asset?.version) || asset.version < 1) {
      issues.push(issue('ASSET-VERSION-FIELDS', DATA_FILES.asset_registry, asset?.asset_id, '资产必须提供 asset_id 和正整数 version。', '补齐资产身份和递增版本号。'));
    }
    if (!APPROVAL_STATUSES.has(asset?.approval_status)) {
      issues.push(issue('ASSET-APPROVAL-STATUS', DATA_FILES.asset_registry, asset?.asset_id, `非法审核状态：${asset?.approval_status ?? '缺失'}。`, `使用 ${[...APPROVAL_STATUSES].join('、')} 之一。`));
    }
    if (asset?.parent_asset_version_id && !versionIds.has(asset.parent_asset_version_id)) {
      // Parent may appear later in the file; full resolution is checked below.
    }
  }
  for (const asset of list(data, 'asset_registry')) {
    if (asset?.parent_asset_version_id && !versionIds.has(asset.parent_asset_version_id)) {
      issues.push(issue('ASSET-PARENT-REF', DATA_FILES.asset_registry, asset.asset_id, `父资产版本不存在：${asset.parent_asset_version_id}。`, '引用已登记的主资产版本；衍生资产不得脱离主资产。'));
    }
    if (asset?.parent_asset_version_id) {
      const parent = list(data, 'asset_registry').find((candidate) => candidate.version_id === asset.parent_asset_version_id);
      if (parent && parent.approval_status !== 'APPROVED') {
        issues.push(issue('ASSET-PARENT-UNAPPROVED', DATA_FILES.asset_registry, asset.asset_id, '父资产尚未人工审核通过。', '先审核并锁定主资产，再生成衍生资产。'));
      }
      if (!isNonEmpty(asset.variant_type) || !isNonEmpty(asset.source_version) || !isNonEmpty(asset.prompt_version)) {
        issues.push(issue('ASSET-DERIVATIVE-METADATA', DATA_FILES.asset_registry, asset.asset_id, '衍生资产缺少变体类型、来源版本或提示词版本。', '补齐 parent_asset_version_id、variant_type、source_version 和 prompt_version。'));
      }
    }
  }
  return issues;
}

export function validateSchemas(context) {
  const issues = [];
  const entries = [['project', context.project, 'project.json']];
  for (const [key, validator] of schemaChecks) {
    if (key === 'project') continue;
    entries.push([key, context.data[key], DATA_FILES[key] ?? `data/${key}.json`]);
  }
  for (const [key, value, file] of entries) {
    const validator = schemaChecks.get(key);
    if (!validator(value)) {
      for (const error of validator.errors ?? []) {
        issues.push(issue(
          'SCHEMA-VALIDATION',
          file,
          error.instancePath || '/',
          `${error.instancePath || '/'} ${error.message ?? 'Schema validation failed'} (${error.keyword}).`,
          `修正 JSON Schema 错误；路径：${error.instancePath || '/'}；原因：${error.message ?? error.keyword}。`,
        ));
      }
    }
  }
  return issues;
}

function paragraphRanges(text) {
  const ranges = [];
  let start = null;
  let end = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor);
    const lineEnd = newline < 0 ? text.length : newline;
    const contentEnd = lineEnd > cursor && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    const line = text.slice(cursor, contentEnd);
    if (line.trim()) {
      if (start === null) start = cursor + line.length - line.trimStart().length;
      end = cursor + line.trimEnd().length;
    } else if (start !== null) {
      ranges.push({ start, end });
      start = null;
    }
    if (newline < 0) break;
    cursor = newline + 1;
  }
  if (start !== null) ranges.push({ start, end });
  return ranges;
}

function checkSourceEvidence(context) {
  const issues = [];
  const chapters = new Map(list(context.data, 'source_index').map((chapter) => [chapter.id, chapter]));
  const evidenceById = new Map(list(context.data, 'source_evidence').map((entry) => [entry.source_id, entry]));
  const contentByFile = new Map();
  for (const evidence of list(context.data, 'source_evidence')) {
    const chapter = chapters.get(evidence.chapter_id);
    const file = safePath(context.root, evidence.source_file);
    if (!chapter || chapter.source_file !== evidence.source_file || !file || !fs.existsSync(file)) {
      issues.push(issue('SOURCE-EVIDENCE-LOCATION', DATA_FILES.source_evidence, evidence.source_id, '证据未指向已登记章节的原著文件。', 'source_file 必须与 source_index 中对应章节的原文文件一致。'));
      continue;
    }
    let sourceText = contentByFile.get(evidence.source_file);
    if (sourceText === undefined) {
      sourceText = fs.readFileSync(file, 'utf8');
      contentByFile.set(evidence.source_file, sourceText);
    }
    const currentSourceHash = sha256(fs.readFileSync(file));
    if (evidence.source_file_hash !== currentSourceHash) {
      issues.push(issue('SOURCE-EVIDENCE-FILE-CHANGED', DATA_FILES.source_evidence, evidence.source_id, '证据对应的原著文件 SHA-256 已变化。', '重新核对摘录和偏移量；保留旧审批记录并更新受影响内容版本。'));
    }
    const { start_offset: start, end_offset: end } = evidence;
    const ranges = paragraphRanges(sourceText);
    const paragraphIndex = ranges.findIndex((range) => start >= range.start && end <= range.end);
    const expectedParagraphId = paragraphIndex >= 0 ? `${evidence.chapter_id}:p${String(paragraphIndex + 1).padStart(4, '0')}` : null;
    const excerpt = Number.isInteger(start) && Number.isInteger(end) ? sourceText.slice(start, end) : '';
    if (start < 0 || end <= start || !excerpt || excerpt !== evidence.evidence_text ||
        evidence.evidence_hash !== sha256(evidence.evidence_text) || evidence.paragraph_id !== expectedParagraphId) {
      issues.push(issue('SOURCE-EVIDENCE-INVALID', DATA_FILES.source_evidence, evidence.source_id, '段落定位、短摘录、偏移量或证据 SHA-256 无法与原文匹配。', '以原文 UTF-16 字符偏移定位段落内短摘录，并重算 evidence_hash。'));
    }
  }
  const records = [
    ...list(context.data, 'story_events'),
    ...list(context.data, 'characters'),
    ...list(context.data, 'factions'),
    ...list(context.data, 'scenes'),
    ...list(context.data, 'props'),
  ];
  for (const record of records) {
    for (const claim of [...asArray(record.claims), ...(record.provenance ? [record] : [])]) {
      const provenance = claim.provenance;
      if (provenance === 'SOURCE_FACT') {
        if (!asArray(claim.evidence_refs).length ||
            claim.evidence_refs.some((id) => !evidenceById.has(id))) {
          issues.push(issue('FACT-EVIDENCE-REQUIRED', 'data', record.id, 'SOURCE_FACT 必须引用有效段落证据，章节 ID 不足以证明出处。', '为该事实添加 source_evidence 记录并填写 evidence_refs。'));
        } else if (asArray(claim.source_refs).length && claim.evidence_refs.some((id) =>
          !asArray(claim.source_refs).includes(evidenceById.get(id)?.chapter_id))) {
          issues.push(issue('FACT-EVIDENCE-CHAPTER', 'data', record.id, '事实证据所属章节与 source_refs 不一致。', '确保具体证据段落属于该事实所声明的原著章节。'));
        }
      } else if (provenance === 'INFERENCE' && !isNonEmpty(claim.basis)) {
        issues.push(issue('FACT-INFERENCE-BASIS', 'data', record.id, 'INFERENCE 必须记录推断依据，不能写成原著事实。', '填写依据和不确定性；如无法判断则标记 UNKNOWN。'));
      } else if (provenance === 'ART_DECISION' && !isNonEmpty(claim.reason)) {
        issues.push(issue('FACT-ART-DECISION-REASON', 'data', record.id, 'ART_DECISION 必须记录美术补充理由。', '填写美术决策理由并等待用户确认。'));
      } else if (provenance === 'UNKNOWN' && !isNonEmpty(claim.note)) {
        issues.push(issue('FACT-UNKNOWN-EXPLICIT', 'data', record.id, 'UNKNOWN 必须明确说明未知内容。', '在 note 中说明原著未说明或尚待核实。'));
      }
    }
  }
  for (const event of list(context.data, 'story_events')) {
    if (event.provenance === 'SOURCE_FACT' &&
        (!asArray(event.evidence_refs).length || event.evidence_refs.some((id) => !evidenceById.has(id)))) {
      issues.push(issue('EVENT-EVIDENCE-REQUIRED', DATA_FILES.story_events, event.id, '原著事件缺少有效段落证据。', '绑定精确的 source_evidence，而非仅提供 chapter_id。'));
    } else if (event.provenance === 'SOURCE_FACT' && asArray(event.source_refs).length &&
        event.evidence_refs.some((id) => !asArray(event.source_refs).includes(evidenceById.get(id)?.chapter_id))) {
      issues.push(issue('EVENT-EVIDENCE-CHAPTER', DATA_FILES.story_events, event.id, '事件证据所属章节与 source_refs 不一致。', '确保事件段落摘录来自已声明章节。'));
    }
  }
  return issues;
}

function checkReferences(data) {
  const issues = [];
  const chapters = chapterIds(data);
  const factions = entityIds(data, 'factions');
  const characters = entityIds(data, 'characters');
  const scenes = entityIds(data, 'scenes');
  const props = entityIds(data, 'props');
  const events = entityIds(data, 'story_events');
  const scriptScenes = entityIds(data, 'screenplay');
  const assetVersionIds = assetVersions(data);
  const evidenceIds = new Set(list(data, 'source_evidence').map((entry) => entry?.source_id).filter(isNonEmpty));
  const fileFor = (key) => DATA_FILES[key];

  for (const key of ['story_events', 'characters', 'factions', 'scenes', 'props']) {
    for (const record of list(data, key)) {
      if (record.source_refs && !hasReferences(record.source_refs, chapters)) {
        issues.push(issue('SOURCE-CHAPTER-REF', fileFor(key), record.id, 'source_refs 引用了不存在的章节。', '修正章节 ID，或先补全 source_index.json。'));
      }
      for (const claim of asArray(record.claims)) {
        if (!FACT_PROVENANCE.has(claim?.provenance)) {
          issues.push(issue('FACT-PROVENANCE', fileFor(key), record.id, `事实来源类型非法：${claim?.provenance ?? '缺失'}。`, `使用 ${[...FACT_PROVENANCE].join('、')}，不得把推断或美术补充写成原著事实。`));
        }
        if (claim?.provenance === 'SOURCE_FACT' &&
            (!asArray(claim.source_refs).length || !hasReferences(claim.source_refs, chapters))) {
          issues.push(issue('FACT-SOURCE-CITATION', fileFor(key), record.id, 'SOURCE_FACT 缺少有效原著章节出处。', '添加有效章节引用；无法核实时改标为 UNKNOWN 或 INFERENCE。'));
        }
      }
    }
  }
  for (const character of list(data, 'characters')) {
    if (character.faction_id && !factions.has(character.faction_id)) {
      issues.push(issue('CHARACTER-FACTION-REF', fileFor('characters'), character.id, `所属势力不存在：${character.faction_id}。`, '引用 factions.json 中的 faction id。'));
    }
    if (character.identity_anchor_id && !isNonEmpty(character.identity_anchor_id)) {
      issues.push(issue('CHARACTER-IDENTITY-ANCHOR', fileFor('characters'), character.id, '人物身份锚点 ID 无效。', '为人物设置稳定且唯一的 identity_anchor_id。'));
    }
    if (character.required_views && (!Array.isArray(character.required_views) ||
        character.required_views.some((view) => !['FRONT', 'SIDE', 'BACK', 'FACE', 'EXPRESSION', 'COSTUME_DETAIL'].includes(view)))) {
      issues.push(issue('CHARACTER-REQUIRED-VIEWS', fileFor('characters'), character.id, '人物 required_views 包含无效视角。', '仅使用 FRONT、SIDE、BACK、FACE、EXPRESSION、COSTUME_DETAIL。'));
    }
  }
  for (const rule of list(data, 'costume_rules')) {
    if (rule.source_refs && !hasReferences(rule.source_refs, chapters)) {
      issues.push(issue('COSTUME-SOURCE-REF', fileFor('costume_rules'), rule.id, '服饰规则引用了不存在的原著章节。', '修正 source_refs；美术例外须另有理由并经用户确认。'));
    }
  }
  for (const rule of list(data, 'costume_rules')) {
    if (!factions.has(rule.faction_id)) {
      issues.push(issue('COSTUME-FACTION-REF', fileFor('costume_rules'), rule.id, `服饰规则引用的势力不存在：${rule.faction_id ?? '缺失'}。`, '引用 factions.json 中的稳定势力 ID。'));
    }
    for (const evidenceId of asArray(rule.exception_evidence_refs)) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push(issue('COSTUME-EXCEPTION-EVIDENCE', fileFor('costume_rules'), rule.id, `服饰例外证据不存在：${evidenceId}。`, '引用 source_evidence.json 中已验证的原文段落，或记录用户批准。'));
      }
    }
  }
  for (const event of list(data, 'story_events')) {
    if (event.chapter_id && !chapters.has(event.chapter_id)) {
      issues.push(issue('EVENT-CHAPTER-REF', fileFor('story_events'), event.id, `原著章节不存在：${event.chapter_id}。`, '先登记原著章节，再建立事件引用。'));
    }
  }
  for (const entry of list(data, 'timeline')) {
    if (entry.story_event_id && !events.has(entry.story_event_id)) {
      issues.push(issue('TIMELINE-EVENT-REF', fileFor('timeline'), entry.id, `时间线引用的原著事件不存在：${entry.story_event_id}。`, '引用 story_events.json 中已登记的事件 ID。'));
    }
  }
  const continuityByChapter = new Map(list(data, 'continuity').map((entry) => [entry.chapter_id, entry]));
  for (const entry of list(data, 'continuity')) {
    if (!chapters.has(entry.chapter_id)) {
      issues.push(issue('CONTINUITY-CHAPTER-REF', fileFor('continuity'), entry.chapter_id, '连续性状态引用了不存在的章节。', '先在 source_index.json 登记章节。'));
    }
    for (const eventId of asArray(entry.confirmed_event_ids)) {
      if (!events.has(eventId)) issues.push(issue('CONTINUITY-EVENT-REF', fileFor('continuity'), entry.chapter_id, `已确认事件不存在：${eventId}。`, '引用 story_events.json 中的事件 ID。'));
    }
    for (const state of asArray(entry.character_states)) {
      if (!characters.has(state.character_id)) issues.push(issue('CONTINUITY-CHARACTER-REF', fileFor('continuity'), entry.chapter_id, `人物状态引用不存在的人物：${state.character_id}。`, '引用 characters.json 中的稳定人物 ID。'));
      for (const propId of asArray(state.held_prop_ids)) {
        if (!props.has(propId)) issues.push(issue('CONTINUITY-PROP-REF', fileFor('continuity'), entry.chapter_id, `人物持有道具不存在：${propId}。`, '引用 props.json 中的稳定道具 ID。'));
      }
      if (state.current_scene_id && !scenes.has(state.current_scene_id)) {
        issues.push(issue('CONTINUITY-SCENE-REF', fileFor('continuity'), entry.chapter_id, `当前场景不存在：${state.current_scene_id}。`, '引用 scenes.json 中的稳定场景 ID。'));
      }
    }
    if (entry.inherited_from_chapter_id && !continuityByChapter.has(entry.inherited_from_chapter_id)) {
      issues.push(issue('CONTINUITY-INHERITANCE-REF', fileFor('continuity'), entry.chapter_id, '继承来源章节缺少已记录的连续性状态。', '引用上一已确认章节的 continuity 状态。'));
    }
  }
  for (const scene of list(data, 'screenplay')) {
    if (scene.chapter_id && !chapters.has(scene.chapter_id)) {
      issues.push(issue('SCREENPLAY-CHAPTER-REF', fileFor('screenplay'), scene.id, `原著章节不存在：${scene.chapter_id}。`, '修正章节引用。'));
    }
    const segmentIds = new Set(list(data, 'screenplay').flatMap((scene) =>
      asArray(scene.segments).map((segment) => segment?.id).filter(isNonEmpty),
    ));
    const shotIds = entityIds(data, 'storyboard');
    for (const beat of list(data, 'event_beats')) {
      if (!events.has(beat.event_id)) {
        issues.push(issue('EVENT-BEAT-EVENT-REF', fileFor('event_beats'), beat.id, `事件细节引用的原著事件不存在：${beat.event_id ?? '缺失'}。`, '引用 story_events.json 中的稳定事件 ID。'));
      }
      for (const id of asArray(beat.evidence_refs)) {
        if (!evidenceIds.has(id)) issues.push(issue('EVENT-BEAT-EVIDENCE-REF', fileFor('event_beats'), beat.id, `事件细节引用的原著证据不存在：${id}。`, '绑定 source_evidence.json 中已验证的段落证据。'));
      }
      for (const id of asArray(beat.screenplay_scene_ids)) {
        if (!scriptScenes.has(id)) issues.push(issue('EVENT-BEAT-SCENE-REF', fileFor('event_beats'), beat.id, `事件细节映射的剧本场次不存在：${id}。`, '将关键事实映射到实际剧本场次。'));
      }
      for (const id of asArray(beat.screenplay_segment_ids)) {
        if (!segmentIds.has(id)) issues.push(issue('EVENT-BEAT-SEGMENT-REF', fileFor('event_beats'), beat.id, `事件细节映射的剧本片段不存在：${id}。`, '将关键事实映射到实际剧本片段。'));
      }
      for (const id of asArray(beat.shot_ids)) {
        if (list(data, 'storyboard').length && !shotIds.has(id)) {
          issues.push(issue('EVENT-BEAT-SHOT-REF', fileFor('event_beats'), beat.id, `事件细节映射的分镜不存在：${id}。`, '将关键事实映射到至少一个实际分镜。'));
        }
      }
    }
    if (scene.scene_id && !scenes.has(scene.scene_id)) {
      issues.push(issue('SCREENPLAY-SCENE-REF', fileFor('screenplay'), scene.id, `场景不存在：${scene.scene_id}。`, '引用 scenes.json 中已登记的场景。'));
    }
    for (const eventId of asArray(scene.event_ids)) {
      if (!events.has(eventId)) issues.push(issue('SCREENPLAY-EVENT-REF', fileFor('screenplay'), scene.id, `原著事件不存在：${eventId}。`, '使用 story_events.json 中的事件 ID。'));
    }
    for (const characterId of asArray(scene.character_ids)) {
      if (!characters.has(characterId)) issues.push(issue('SCREENPLAY-CHARACTER-REF', fileFor('screenplay'), scene.id, `人物不存在：${characterId}。`, '引用 characters.json 中已登记的人物。'));
    }
    for (const segment of asArray(scene.segments)) {
      if (!SEGMENT_TYPES.has(segment?.type)) {
        issues.push(issue('SCREENPLAY-SEGMENT-TYPE', fileFor('screenplay'), scene.id, `内容类型非法：${segment?.type ?? '缺失'}。`, `使用 ${[...SEGMENT_TYPES].join('、')}。`));
      }
      if (!isNonEmpty(segment?.text)) {
        issues.push(issue('SCREENPLAY-SEGMENT-TEXT', fileFor('screenplay'), scene.id, '剧本片段缺少内容。', '补充对白、旁白、独白、动作或环境叙述。'));
      }
      if (segment?.duration_seconds !== undefined && (!Number.isFinite(segment.duration_seconds) || segment.duration_seconds <= 0)) {
        issues.push(issue('SCREENPLAY-DURATION', fileFor('screenplay'), scene.id, '片段时长必须大于 0。', '对白/旁白按内容计算时长，动作与环境镜头填写合理时长。'));
      }
    }
  }
  for (const row of list(data, 'story_coverage')) {
    if (!events.has(row.event_id)) issues.push(issue('COVERAGE-EVENT-REF', fileFor('story_coverage'), row.id, `事件不存在：${row.event_id}。`, '引用 story_events.json 中的事件 ID。'));
    if (!['COVERED', 'OMITTED'].includes(row.status)) {
      issues.push(issue('COVERAGE-STATUS', fileFor('story_coverage'), row.id, `覆盖状态非法：${row.status ?? '缺失'}。`, '使用 COVERED 或 OMITTED，并为遗漏记录原因。'));
    }
    if (row.status === 'OMITTED') {
      issues.push(issue('STORY-EVENT-OMITTED', fileFor('story_coverage'), row.event_id, `原著事件被标记为遗漏：${row.reason || '未提供理由'}。`, '恢复事件或暂停并向用户展示原著对账差异；不得由 Agent 静默删减。'));
    }
    if (row.status === 'COVERED' && !asArray(row.screenplay_scene_ids).some((id) => scriptScenes.has(id))) {
      issues.push(issue('COVERAGE-SCREENPLAY-REF', fileFor('story_coverage'), row.event_id, '已覆盖事件未关联有效剧本场次。', '为该事件关联一个或多个 screenplay scene id。'));
    }
  }
  for (const shot of list(data, 'storyboard')) {
    if (!scriptScenes.has(shot.screenplay_scene_id)) {
      issues.push(issue('STORYBOARD-SCREENPLAY-REF', fileFor('storyboard'), shot.id, `剧本场次不存在：${shot.screenplay_scene_id}。`, '引用 screenplay.json 中的场次 ID。'));
    }
    if (shot.event_id && !events.has(shot.event_id)) {
      issues.push(issue('STORYBOARD-EVENT-REF', fileFor('storyboard'), shot.id, `原著事件不存在：${shot.event_id}。`, '引用 story_events.json 中的事件 ID。'));
    }
    if (shot.scene_id && !scenes.has(shot.scene_id)) {
      issues.push(issue('STORYBOARD-SCENE-REF', fileFor('storyboard'), shot.id, `场景不存在：${shot.scene_id}。`, '引用 scenes.json 中已确认的场景。'));
    }
    for (const id of asArray(shot.character_ids)) {
      if (!characters.has(id)) issues.push(issue('STORYBOARD-CHARACTER-REF', fileFor('storyboard'), shot.id, `人物不存在：${id}。`, '引用 characters.json 中的人物 ID。'));
    }
    for (const id of asArray(shot.prop_ids)) {
      if (!props.has(id)) issues.push(issue('STORYBOARD-PROP-REF', fileFor('storyboard'), shot.id, `道具不存在：${id}。`, '引用 props.json 中的道具 ID。'));
    }
    for (const id of asArray(shot.asset_version_ids)) {
      const asset = assetVersionIds.get(id);
      if (!asset) {
        issues.push(issue('STORYBOARD-ASSET-REF', fileFor('storyboard'), shot.id, `资产版本不存在：${id}。`, '使用 asset_registry.json 中明确的 version_id。'));
      } else if (shot.review_status === 'APPROVED' &&
          (asset.approval_status !== 'APPROVED' || asset.stale)) {
        issues.push(issue('STORYBOARD-ASSET-UNAPPROVED', fileFor('storyboard'), shot.id, `分镜引用的资产版本尚未批准或已过期：${id}。`, '先审核资产版本或重新检查其变更影响。'));
      }
    }
    if (!Number.isFinite(shot.duration_seconds) || shot.duration_seconds <= 0) {
      issues.push(issue('STORYBOARD-DURATION', fileFor('storyboard'), shot.id, '分镜时长必须大于 0。', '根据动作、对白和叙事信息量估算，不固定套用单一秒数。'));
    }
  }
  for (const task of list(data, 'production_tasks')) {
    if (!TASK_STATUSES.has(task.status)) {
      issues.push(issue('TASK-STATUS', fileFor('production_tasks'), task.id, `生成任务状态非法：${task.status ?? '缺失'}。`, `使用 ${[...TASK_STATUSES].join('、')} 之一。`));
    }
    if (task.kind === 'VIDEO') {
      const shot = list(data, 'storyboard').find((entry) => entry.id === task.shot_id);
      if (!shot) {
        issues.push(issue('VIDEO-SHOT-REF', fileFor('production_tasks'), task.id, `视频任务引用的分镜不存在：${task.shot_id ?? '缺失'}。`, '先完成分镜并引用有效 shot id。'));
      } else if (['RUNNING', 'COMPLETED'].includes(task.status) && shot.review_status !== 'APPROVED') {
        issues.push(issue('VIDEO-SHOT-UNAPPROVED', fileFor('production_tasks'), task.id, '视频任务引用的分镜图尚未人工审核通过。', '先审核分镜图，再启动视频生成。'));
      }
      if (task.background_music === true) {
        issues.push(issue('VIDEO-BGM-COUPLING', fileFor('production_tasks'), task.id, '视频任务启用了背景音乐，与独立音频制作约定冲突。', '关闭视频生成中的背景音乐，统一在后期音频时间轴安排。'));
      }
      if (task.dialogue_generation === true || task.narration_generation === true) {
        issues.push(issue('VIDEO-AUDIO-COUPLING', fileFor('production_tasks'), task.id, '视频任务启用了对白或旁白生成。', '默认将对白/旁白与视频分离管理。'));
      }
      for (const versionId of asArray(task.reference_asset_version_ids)) {
        const asset = assetVersionIds.get(versionId);
        if (!asset) {
          issues.push(issue('VIDEO-ASSET-REF', fileFor('production_tasks'), task.id, `视频任务引用的资产版本不存在：${versionId}。`, '引用已审核的资产版本 ID。'));
        } else if (['RUNNING', 'COMPLETED'].includes(task.status) &&
            (asset.approval_status !== 'APPROVED' || asset.stale)) {
          issues.push(issue('VIDEO-ASSET-UNAPPROVED', fileFor('production_tasks'), task.id, `视频任务引用了未批准或已过期资产：${versionId}。`, '重新审核资产或更新任务引用后再生成。'));
        }
      }
    }
    if (task.status === 'COMPLETED' && !isNonEmpty(task.output_file)) {
      issues.push(issue('TASK-OUTPUT-MISSING', fileFor('production_tasks'), task.id, '任务标记为 COMPLETED，但没有输出文件。', '任务启动不代表成功；检查实际产物后再标记完成。'));
    }
  }
  return issues;
}

function checkFiles(root, data) {
  const issues = [];
  const digests = new Map();
  for (const asset of list(data, 'asset_registry')) {
    if (!isNonEmpty(asset.file)) continue;
    const file = safePath(root, asset.file);
    if (!file) {
      issues.push(issue('ASSET-FILE-PATH', DATA_FILES.asset_registry, asset.asset_id, `资产路径越界或无效：${asset.file}。`, '使用项目根目录内的相对路径。'));
      continue;
    }
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    const expectedDir = IMAGE_DIRS[asset.asset_type];
    if (!expectedDir) {
      issues.push(issue('ASSET-TYPE', DATA_FILES.asset_registry, asset.asset_id, `未知资产类型：${asset.asset_type ?? '缺失'}。`, `使用 ${Object.keys(IMAGE_DIRS).join('、')} 对应类型。`));
    } else {
      const expected = path.resolve(root, expectedDir);
      if (path.dirname(file) !== expected) {
        issues.push(issue('IMAGE-FLAT-DIRECTORY', DATA_FILES.asset_registry, asset.asset_id, `图片必须直接放在 ${expectedDir}/，不可创建子目录。`, `将文件移至对应平铺图片目录，并使用文件名区分资产、时期和版本。`));
      }
    }
    if (!fs.existsSync(file)) {
      issues.push(issue('ASSET-FILE-MISSING', DATA_FILES.asset_registry, asset.asset_id, `登记的资产文件不存在：${asset.file}。`, '仅登记真实生成并保存的文件路径。'));
      continue;
    }
    const contents = fs.readFileSync(file);
    if (!isImageFile(contents)) {
      issues.push(issue('IMAGE-FILE-INVALID', DATA_FILES.asset_registry, asset.asset_id, '文件存在但不是可识别的 PNG、JPEG 或 WebP 图片。', '验证真实图片文件并修正资产路径。'));
    }
    const dimensions = imageDimensions(contents);
    if (!dimensions?.width || !dimensions?.height) {
      issues.push(issue('IMAGE-DIMENSIONS', DATA_FILES.asset_registry, asset.asset_id, '无法读取图片宽高，或图片尺寸为零。', '使用有效的 PNG、JPEG 或支持的 WebP 文件重新登记资产。'));
    } else {
      if (asset.expected_width && dimensions.width !== asset.expected_width) {
        issues.push(issue('IMAGE-WIDTH', DATA_FILES.asset_registry, asset.asset_id, `图片宽度 ${dimensions.width} 与登记值 ${asset.expected_width} 不一致。`, '修正文件或尺寸记录。'));
      }
      if (asset.expected_height && dimensions.height !== asset.expected_height) {
        issues.push(issue('IMAGE-HEIGHT', DATA_FILES.asset_registry, asset.asset_id, `图片高度 ${dimensions.height} 与登记值 ${asset.expected_height} 不一致。`, '修正文件或尺寸记录。'));
      }
      if (asset.expected_aspect_ratio && aspectRatio(dimensions) !== asset.expected_aspect_ratio) {
        issues.push(issue('IMAGE-ASPECT-RATIO', DATA_FILES.asset_registry, asset.asset_id, `图片比例 ${aspectRatio(dimensions)} 与任务要求 ${asset.expected_aspect_ratio} 不一致。`, '按该资产视图/任务要求重新导出或更新比例要求。'));
      }
    }
    const digest = crypto.createHash('sha256').update(contents).digest('hex');
    if (digests.has(digest)) {
      issues.push(issue('ASSET-FILE-DUPLICATE', DATA_FILES.asset_registry, asset.asset_id, `图片与 ${digests.get(digest)} 内容重复。`, '确认是否误复制了同一生成结果，勿以重复文件伪装多视角。'));
    } else digests.set(digest, asset.version_id);
  }
  for (const shot of list(data, 'storyboard')) {
    if (!isNonEmpty(shot.image_file)) continue;
    const file = safePath(root, shot.image_file);
    if (!file || path.dirname(file) !== path.resolve(root, IMAGE_DIRS.storyboard)) {
      issues.push(issue('STORYBOARD-IMAGE-PATH', DATA_FILES.storyboard, shot.id, `分镜图片路径无效或不在 ${IMAGE_DIRS.storyboard}/ 平铺目录中：${shot.image_file}。`, '将图片放入 images/分镜/ 根目录，并记录项目内相对路径。'));
      continue;
    }
    if (!fs.existsSync(file)) {
      issues.push(issue('STORYBOARD-IMAGE-MISSING', DATA_FILES.storyboard, shot.id, `登记的分镜图片不存在：${shot.image_file}。`, '只登记真实生成并保存的文件路径。'));
      continue;
    }
    const contents = fs.readFileSync(file);
    if (!isImageFile(contents)) {
      issues.push(issue('STORYBOARD-IMAGE-INVALID', DATA_FILES.storyboard, shot.id, '分镜文件存在但不是可识别的 PNG、JPEG 或 WebP 图片。', '验证真实图片文件并修正分镜图路径。'));
    }
    const dimensions = imageDimensions(contents);
    if (!dimensions?.width || !dimensions?.height) {
      issues.push(issue('STORYBOARD-IMAGE-DIMENSIONS', DATA_FILES.storyboard, shot.id, '无法读取分镜图宽高，或图片尺寸为零。', '使用有效的 PNG、JPEG 或支持的 WebP 文件重新登记。'));
    } else {
      const expectedRatio = shot.expected_aspect_ratio ?? data.visual_style?.aspect_ratio;
      if (expectedRatio && aspectRatio(dimensions) !== expectedRatio) {
        issues.push(issue('STORYBOARD-IMAGE-ASPECT-RATIO', DATA_FILES.storyboard, shot.id, `分镜图比例 ${aspectRatio(dimensions)} 与项目要求 ${expectedRatio} 不一致。`, '按项目画幅重新生成/导出分镜图，或在明确视图例外时记录资产比例。'));
      }
    }
    const digest = crypto.createHash('sha256').update(contents).digest('hex');
    if (digests.has(digest)) {
      issues.push(issue('ASSET-FILE-DUPLICATE', DATA_FILES.storyboard, shot.id, `分镜图与 ${digests.get(digest)} 内容重复。`, '检查是否将同一图片重复登记为多个镜头。'));
    } else digests.set(digest, shot.id);
  }
  for (const task of list(data, 'production_tasks')) {
    if (task.status !== 'COMPLETED') continue;
    const file = safePath(root, task.output_file);
    if (!isNonEmpty(task.output_file) || !file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      issues.push(issue('MEDIA-OUTPUT-UNREADABLE', DATA_FILES.production_tasks, task.id, `已完成任务的输出文件不存在、为空或不可读取：${task.output_file ?? ''}。`, '只在真实输出文件可读并通过对应媒体流检查后标记 COMPLETED。'));
      continue;
    }
    if (['VIDEO', 'FINAL_RENDER'].includes(task.kind)) {
      const inspected = probeMediaFile(file, 'VIDEO');
      if (!inspected.valid) {
        const missingStream = /缺少 video 流|没有可验证的非空视频流/.test(inspected.reason ?? '');
        issues.push(issue(
          missingStream ? 'MEDIA-STREAM-MISSING' : 'MEDIA-FILE-INVALID',
          DATA_FILES.production_tasks,
          task.id,
          inspected.reason || '视频输出无法验证。',
          '使用具有真实视频流的文件；FFprobe 存在时应记录有效编码、分辨率和时长。',
        ));
        continue;
      }
      if (!(inspected.duration > 0)) {
        issues.push(issue('MEDIA-DURATION-INVALID', DATA_FILES.production_tasks, task.id, '视频流时长无效。', '使用真实视频时长，不得根据任务参数伪造检测值。'));
      }
      if (task.verification_level !== inspected.level) {
        issues.push(issue('MEDIA-VERIFICATION-LEVEL', DATA_FILES.production_tasks, task.id,
          `任务登记的验证等级 ${task.verification_level ?? '缺失'} 与实际 ${inspected.level} 检查不一致。`,
          `准确记录 ${inspected.level}；BASIC 仅表示基础格式检查，非完整解码验证。`));
      }
      const videoStream = asArray(inspected.streams).find((stream) => stream.codec_type === 'video');
      if (videoStream && (task.width || task.height) &&
          (videoStream.width !== task.width || videoStream.height !== task.height)) {
        issues.push(issue('MEDIA-RESOLUTION-MISMATCH', DATA_FILES.production_tasks, task.id, '视频实际分辨率与任务登记值不一致。', '以媒体探测结果更新登记或重新输出。'));
      }
      if (task.kind === 'VIDEO' && task.allow_audio_streams !== true &&
          asArray(inspected.streams).some((stream) => stream.codec_type === 'audio')) {
        issues.push(issue('AUDIO-UNEXPECTED-STREAM', DATA_FILES.production_tasks, task.id, '视频生成任务出现未声明的音频流。', '剥离未授权对白/BGM，或显式记录经审核的音频流策略。'));
      }
      if (task.kind === 'FINAL_RENDER') {
        const hasCompletedAudio = list(data, 'audio_timeline').some((track) => track.status === 'COMPLETED');
        const hasAudioStream = asArray(inspected.streams).some((stream) => stream.codec_type === 'audio');
        if (hasCompletedAudio && !hasAudioStream) {
          issues.push(issue('MEDIA-STREAM-MISSING', DATA_FILES.production_tasks, task.id, '最终成片缺少计划的音频流。', '将已审核对白/旁白/音效混入最终声轨并重新验证。'));
        }
        if (!hasCompletedAudio && hasAudioStream &&
            !list(data, 'audio_timeline').some((track) => track.status === 'NOT_APPLICABLE' && isNonEmpty(track.reason))) {
          issues.push(issue('AUDIO-UNEXPECTED-STREAM', DATA_FILES.production_tasks, task.id, '最终成片有音轨，但没有对应音频时间轴或 NOT_APPLICABLE 说明。', '登记实际音轨或记录不需要音频的原因。'));
        }
      }
      if (Number.isFinite(task.duration_seconds) &&
          Math.abs(inspected.duration - task.duration_seconds) > Math.max(0.5, task.duration_seconds * 0.1)) {
        issues.push(issue('MEDIA-DURATION-MISMATCH', DATA_FILES.production_tasks, task.id, `实际媒体时长 ${inspected.duration.toFixed(2)}s 与任务记录不一致。`, '依据媒体流探测结果更正时长，并复核分镜节奏。'));
      }
      if (inspected.level === 'BASIC') {
        issues.push(issue('MEDIA-BASIC-VERIFICATION', DATA_FILES.production_tasks, task.id, '媒体已通过基础结构检查；未检测到 FFprobe，未执行完整解码验证。', '在支持 FFprobe 的环境中复核流编码和解码；该限制已显式记录。', 'WARNING'));
      }
    }
  }
  for (const track of list(data, 'audio_timeline')) {
    if (track.status === 'NOT_APPLICABLE') {
      if (!isNonEmpty(track.reason)) {
        issues.push(issue('AUDIO-NOT-APPLICABLE-REASON', DATA_FILES.audio_timeline, track.id, 'NOT_APPLICABLE 音轨必须记录原因。', '说明该镜头为何不需要对白、旁白、环境音或特效音。'));
      }
      continue;
    }
    if (!isNonEmpty(track.file)) {
      if (track.status === 'COMPLETED') issues.push(issue('MEDIA-OUTPUT-UNREADABLE', DATA_FILES.audio_timeline, track.id, '已完成音轨缺少实际文件路径。', '登记真实 WAV/MP3 文件，不能仅依靠状态字段。'));
      continue;
    }
    const file = safePath(root, track.file);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      issues.push(issue('MEDIA-OUTPUT-UNREADABLE', DATA_FILES.audio_timeline, track.id, `登记的音频文件不存在、为空或不可读取：${track.file}。`, '只记录已落盘并通过 WAV/MP3 流检查的音频产物。'));
      continue;
    }
    const inspected = probeMediaFile(file, 'AUDIO');
    if (!inspected.valid) {
      const missingStream = /缺少 audio 流|缺少有效 fmt 或非空 data 音频流|没有可识别的有效 MPEG 音频帧/.test(inspected.reason ?? '');
      issues.push(issue(missingStream ? 'MEDIA-STREAM-MISSING' : 'MEDIA-FILE-INVALID', DATA_FILES.audio_timeline, track.id,
        inspected.reason || '音频输出无法验证。', '使用具有真实音频流和正时长的 WAV 或 MP3 文件。'));
      continue;
    }
    if (inspected.level === 'BASIC' && track.verification_level !== 'BASIC') {
      issues.push(issue('MEDIA-VERIFICATION-LEVEL', DATA_FILES.audio_timeline, track.id, '系统没有 FFprobe；音频仅通过基础结构检查，未明确记录 BASIC 验证等级。', '将 verification_level 设为 BASIC，并在可用时用 FFprobe 复核。'));
    }
    if (inspected.level === 'BASIC') {
      issues.push(issue('MEDIA-BASIC-VERIFICATION', DATA_FILES.audio_timeline, track.id, '音频通过基础结构检查；未执行完整解码验证。', '在支持 FFprobe 的环境中复核流编码和时长。', 'WARNING'));
    }
    if (Number.isFinite(track.duration_seconds) &&
        Math.abs(inspected.duration - track.duration_seconds) > Math.max(0.5, track.duration_seconds * 0.1)) {
      issues.push(issue('MEDIA-DURATION-MISMATCH', DATA_FILES.audio_timeline, track.id, `实际音频时长 ${inspected.duration.toFixed(2)}s 与时间轴记录不一致。`, '根据检测到的真实音频流时长修正时间轴。'));
    }
  }
  const musicFiles = new Set();
  for (const track of list(data, 'audio_timeline').filter((entry) => entry.type === 'BACKGROUND_MUSIC' && isNonEmpty(entry.file))) {
    if (musicFiles.has(track.file)) {
      issues.push(issue('AUDIO-BGM-DUPLICATE', DATA_FILES.audio_timeline, track.id, '同一背景音乐文件在音频时间轴重复登记。', '检查是否为每个视频片段重复叠加 BGM；在全片时间轴统一编排。'));
    }
    musicFiles.add(track.file);
  }
  return issues;
}

function checkProjectFiles(context) {
  const issues = [];
  const sourceRecords = new Map(asArray(context.project.source_files).map((entry) => {
    const record = typeof entry === 'string' ? { path: entry } : entry;
    return [record?.path, record];
  }));
  const files = new Set(sourceRecords.keys());
  for (const chapter of list(context.data, 'source_index')) {
    if (isNonEmpty(chapter.source_file)) {
      files.add(chapter.source_file);
      if (!sourceRecords.has(chapter.source_file)) {
        issues.push(issue('SOURCE-FILE-UNREGISTERED', DATA_FILES.source_index, chapter.id, '章节原著文件未登记到 project.source_files。', '将原著来源统一登记并保存 SHA-256。'));
      }
    }
  }
  for (const relativePath of files) {
    const file = safePath(context.root, relativePath);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      issues.push(issue('SOURCE-FILE-MISSING', 'project.json', relativePath, `原著来源文件不存在或路径无效：${relativePath}。`, '将原著文件放入项目目录或修正相对路径；不能伪造已读来源。'));
      continue;
    }
    const digest = sha256(fs.readFileSync(file));
    const record = sourceRecords.get(relativePath);
    if (!record?.sha256) {
      issues.push(issue('SOURCE-FILE-HASH-MISSING', 'project.json', relativePath, '原著来源文件未登记 SHA-256。', '初始化时登记文件哈希；不可将章节 ID 作为内容完整性的替代。'));
    } else if (record.sha256 !== digest) {
      issues.push(issue('SOURCE-FILE-CHANGED', 'project.json', relativePath, '原著输入文件 SHA-256 已变化，现有来源证据和已确认阶段需要复核。', '确认这是有意修订后更新来源版本，并仅刷新引用该来源的下游资产/剧本；保留旧审批记录。'));
    }
    for (const chapter of list(context.data, 'source_index').filter((entry) => entry.source_file === relativePath)) {
      if (chapter.source_file_hash !== digest) {
        issues.push(issue('SOURCE-CHAPTER-HASH-CHANGED', DATA_FILES.source_index, chapter.id, '章节登记的原著文件哈希与当前内容不一致。', '重新核对该章节段落证据，更新 hash 并标记实际引用它的下游成果为 STALE。'));
      }
    }
  }
  return issues;
}

function checkProjectStructure(project) {
  const issues = [];
  if (!isNonEmpty(project.project_id) || !isNonEmpty(project.title)) {
    issues.push(issue('PROJECT-IDENTITY', 'project.json', null, '项目必须包含 project_id 和 title。', '运行 init 创建合法项目，或补齐项目身份字段。'));
  }
  if (project.source_fidelity !== true) {
    issues.push(issue('SOURCE-FIDELITY', 'project.json', null, '原著忠实模式必须开启。', '本 Skill 不执行擅自删改、添加或重排剧情的商业化改编。'));
  }
  if (!/^\d{1,2}:\d{1,2}$/.test(String(project.aspect_ratio ?? ''))) {
    issues.push(issue('PROJECT-ASPECT-RATIO', 'project.json', null, '画幅比例格式无效。', '使用如 16:9 或 9:16 的比例。'));
  }
  const phases = asArray(project.phases);
  if (phases.length !== PHASES.length || phases.some((phase, index) => phase.id !== PHASES[index][0])) {
    issues.push(issue('PHASE-SEQUENCE', 'project.json', null, '阶段清单缺失、顺序错误或被修改。', '恢复规定的八阶段顺序；不得未经用户授权跳过阶段。'));
  }
  for (const phase of phases) {
    if (!PHASE_STATUSES.includes(phase.status)) {
      issues.push(issue('PHASE-STATUS', 'project.json', phase.id, `阶段状态非法：${phase.status ?? '缺失'}。`, `使用 ${PHASE_STATUSES.join('、')} 之一。`));
    }
    if (phase.status === 'SKIPPED' &&
        (!isNonEmpty(phase.skipped_reason) || !isNonEmpty(phase.skipped_by) || !isNonEmpty(phase.skipped_at))) {
      issues.push(issue('PHASE-SKIP-AUTH', 'project.json', phase.id, 'SKIPPED 阶段缺少原因、授权人或授权时间。', '只在用户明确授权后跳过，并保存授权人、原因和时间。'));
    }
    if (phase.status === 'APPROVED' && (!isNonEmpty(phase.approved_by) || !isNonEmpty(phase.approved_at))) {
      issues.push(issue('PHASE-APPROVAL-RECORD', 'project.json', phase.id, '已批准阶段缺少人工确认人或确认时间。', '通过 approve 命令记录用户明确确认；Agent 自检不能代替用户确认。'));
    }
    if (phase.status === 'APPROVED' && !isNonEmpty(phase.snapshot_sha256)) {
      issues.push(issue('PHASE-APPROVAL-SNAPSHOT', 'project.json', phase.id, '已批准阶段缺少交付快照。', '重新记录用户确认并保存阶段内容 SHA-256。'));
    }
  }
  const knownPhaseIds = new Set(PHASES.map(([id]) => id));
  if (project.current_phase !== null && !knownPhaseIds.has(project.current_phase)) {
    issues.push(issue('PHASE-CURRENT-REF', 'project.json', project.current_phase, 'current_phase 未引用有效阶段。', '恢复为固定八阶段之一或在全部完成时设为 null。'));
  }
  for (let index = 1; index < phases.length; index++) {
    if (['APPROVED', 'SKIPPED'].includes(phases[index].status) &&
        !['APPROVED', 'SKIPPED'].includes(phases[index - 1].status)) {
      issues.push(issue('PHASE-APPROVAL-ORDER', 'project.json', phases[index].id, '阶段在前一阶段尚未批准或授权跳过时被标记为已完成。', '恢复顺序并按用户确认逐阶段推进。'));
    }
  }
  return issues;
}

function checkApprovals(project, data) {
  const issues = [];
  const known = new Map(asArray(project.phases).map((phase) => [phase.id, phase]));
  const decisions = asArray(data.approvals?.approvals);
  for (const decision of decisions) {
    if (!known.has(decision.phase_id)) {
      issues.push(issue('APPROVAL-PHASE-REF', DATA_FILES.approvals, decision.id, `确认记录引用了未知阶段：${decision.phase_id ?? '缺失'}。`, '修正阶段 ID 并保留原始人工确认记录。'));
    }
    if (!isNonEmpty(decision.decided_by) || !isNonEmpty(decision.decided_at) ||
        !isNonEmpty(decision.snapshot_sha256) ||
        !['APPROVED', 'REJECTED', 'SKIPPED'].includes(decision.decision)) {
      issues.push(issue('APPROVAL-RECORD', DATA_FILES.approvals, decision.id, '确认记录缺少审核人、时间、快照或合法决定。', '通过状态机命令保存完整的人工决定记录。'));
    }
  }
  for (const phase of asArray(project.phases)) {
    const phaseDecisions = decisions.filter((decision) => decision.phase_id === phase.id);
    if (phase.status === 'APPROVED' && !phaseDecisions.some((decision) => decision.decision === 'APPROVED')) {
      issues.push(issue('APPROVAL-RECORD-MISSING', DATA_FILES.approvals, phase.id, '阶段标为 APPROVED，但没有对应用户确认记录。', '不得从状态文字推断授权；重新取得明确用户确认并记录。'));
    }
    if (phase.status === 'SKIPPED' && !phaseDecisions.some((decision) => decision.decision === 'SKIPPED')) {
      issues.push(issue('PHASE-SKIP-AUTH', DATA_FILES.approvals, phase.id, '跳过阶段缺少明确用户授权记录。', '记录授权人、原因、时间和阶段快照。'));
    }
  }
  const active = asArray(project.phases).filter((phase) =>
    ['IN_PROGRESS', 'VALIDATING', 'PENDING_REVIEW', 'REJECTED', 'FAILED', 'BLOCKED'].includes(phase.status),
  );
  if (active.length > 1) {
    issues.push(issue('PHASE-ACTIVE-UNIQUE', 'project.json', null, '同时存在多个正在处理的阶段。', '每次只推进一个正式阶段；其余阶段保持未开始或待复核。'));
  }
  if (active.length === 1 && project.current_phase !== active[0].id) {
    issues.push(issue('PHASE-CURRENT-ACTIVE', 'project.json', active[0].id, '当前处理中阶段与 current_phase 不一致。', '修正断点状态，确保项目进度唯一且可续作。'));
  }
  const approvalIds = new Set();
  for (const decision of decisions) {
    if (isNonEmpty(decision.id) && approvalIds.has(decision.id)) {
      issues.push(issue('APPROVAL-ID-DUPLICATE', DATA_FILES.approvals, decision.id, '审批记录 ID 重复。', '为每次用户决定保存独立不可变 ID。'));
    }
    approvalIds.add(decision.id);
  }
  return issues;
}

function checkCoverage(data) {
  const issues = [];
  const events = list(data, 'story_events');
  const coverage = list(data, 'story_coverage');
  const coveredIds = new Set(coverage.map((row) => row.event_id));
  for (const event of events) {
    if (!coveredIds.has(event.id)) {
      issues.push(issue('STORY-EVENT-UNCOVERED', DATA_FILES.story_coverage, event.id, '原著事件没有剧本覆盖记录。', '补齐逐事件对账，并给出对应剧本场次。'));
    }
  }
  const duplicates = new Set();
  for (const row of coverage) {
    if (duplicates.has(row.event_id)) issues.push(issue('COVERAGE-DUPLICATE', DATA_FILES.story_coverage, row.event_id, '同一原著事件存在多条覆盖记录。', '合并为单一对账行，并关联所有对应剧本场次。'));
    duplicates.add(row.event_id);
  }
  return issues;
}

export function calculateSpeechDuration(text, type, rates = {}) {
  const content = String(text ?? '').trim();
  if (!content) return 0;
  const profile = rates.speakers?.[rates.speaker_id] ?? rates[type?.toLowerCase()] ?? rates;
  const chineseRate = profile.chineseCharactersPerMinute ?? 240;
  const englishRate = profile.englishWordsPerMinute ?? 150;
  if (!(chineseRate > 0) || !(englishRate > 0)) throw new Error('语速必须大于 0。');
  const chineseChars = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const englishWords = (content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const pauseSeconds = (content.match(/[，。！？；：,.!?;:]/g) ?? []).length * (profile.pause_seconds ?? 0.12);
  const chineseSeconds = chineseChars ? chineseChars * 60 / chineseRate : 0;
  const englishSeconds = englishWords ? englishWords * 60 / englishRate : 0;
  const emotionFactor = Number.isFinite(profile.emotion_factor) && profile.emotion_factor > 0 ? profile.emotion_factor : 1;
  const seconds = (chineseSeconds + englishSeconds) * emotionFactor + pauseSeconds +
    (Number.isFinite(profile.emotion_pause_seconds) ? profile.emotion_pause_seconds : 0);
  return Math.round(seconds * 10) / 10;
}

export function estimateSpeechDuration(text, type, rates = {}) {
  const estimated = calculateSpeechDuration(text, type, rates);
  return {
    duration_min: Math.round(estimated * 0.85 * 10) / 10,
    duration_estimated: estimated,
    duration_max: Math.round(estimated * 1.2 * 10) / 10,
  };
}

export function estimateSegmentDuration(segment, rates) {
  if (Number.isFinite(segment?.duration_estimated)) return segment.duration_estimated;
  if (Number.isFinite(segment?.duration_seconds)) return segment.duration_seconds;
  if (['DIALOGUE', 'NARRATION', 'INNER_MONOLOGUE'].includes(segment?.type)) {
    return calculateSpeechDuration(segment.text, segment.type, {
      ...rates,
      speaker_id: segment.speaker_id,
      ...(segment.speech_rate ? { [segment.type.toLowerCase()]: segment.speech_rate } : {}),
      ...(Number.isFinite(segment.pause_seconds) ? { pause_seconds: segment.pause_seconds } : {}),
      ...(Number.isFinite(segment.emotion_factor) ? { emotion_factor: segment.emotion_factor } : {}),
      ...(Number.isFinite(segment.emotion_pause_seconds) ? { emotion_pause_seconds: segment.emotion_pause_seconds } : {}),
    });
  }
  return null;
}

function stageIssues(stageId, context) {
  const { root, project, data, worldBible } = context;
  const issues = [];
  const add = (id, file, objectId, message, suggestion) => issues.push(issue(id, file, objectId, message, suggestion));
  switch (stageId) {
    case '01-source-analysis': {
      if (!isNonEmpty(project.source_scope)) add('STAGE-01-SCOPE', 'project.json', null, '尚未记录本次原著阅读范围。', '记录实际章节范围；未读完的内容不得标记为已解析。');
      if (!list(data, 'source_index').length) add('STAGE-01-CHAPTERS', DATA_FILES.source_index, null, '章节索引为空。', '登记实际阅读的章节及原文文件来源。');
      if (!list(data, 'story_events').length) add('STAGE-01-EVENTS', DATA_FILES.story_events, null, '原著事件清单为空。', '按章节提取事件并保留可追溯出处。');
      if (!fs.existsSync(worldBible) || fs.statSync(worldBible).size === 0) add('STAGE-01-WORLD-BIBLE', project.world_bible, null, '世界观文档不存在或为空。', '根据已阅读原著建立世界观文档，不补造原著设定。');
      for (const event of list(data, 'story_events')) {
        if (!isNonEmpty(event.summary) || !asArray(event.source_refs).length) {
          add('STAGE-01-EVENT-SOURCE', DATA_FILES.story_events, event.id, '重要事件缺少摘要或原著章节出处。', '为事件填写可核对摘要和至少一条来源引用。');
        }
      }
      break;
    }
    case '02-art-direction': {
      const style = data.visual_style;
      for (const field of ['visual_style', 'aspect_ratio']) {
        if (!isNonEmpty(style[field])) add('STAGE-02-STYLE', DATA_FILES.visual_style, null, `视觉体系缺少 ${field}。`, '先完成人工确认的 Art Bible，再生成大量图像。');
      }
      for (const field of ['color_palette', 'lighting_rules', 'quality_constraints']) {
        if (!asArray(style[field]).length) add('STAGE-02-RULES', DATA_FILES.visual_style, null, `视觉体系缺少 ${field}。`, '补齐全剧统一的色彩、光线和质量约束。');
      }
      if (!asArray(style.era_constraints?.forbidden_elements).length) {
        add('STAGE-02-ERA', DATA_FILES.visual_style, null, '尚未建立基于本项目世界观的时代禁用元素清单。', '结合世界设定列出禁止元素；不要只套用固定古风模板。');
      }
      const factions = list(data, 'factions');
      const rules = list(data, 'costume_rules');
      const evidenceIds = new Set(list(data, 'source_evidence').map((entry) => entry.source_id));
      const factionVisuals = new Set();
      for (const faction of factions) {
        const factionRules = rules.filter((rule) => rule.faction_id === faction.id);
        const mainColor = faction.visual_identity?.main_color;
        const pattern = faction.visual_identity?.pattern;
        if (!isNonEmpty(mainColor) || !isNonEmpty(pattern)) {
          add('STAGE-02-FACTION-VISUAL', DATA_FILES.factions, faction.id, '势力缺少独立主色或视觉纹样。', '为每个势力建立可区分的视觉识别体系；原文未说明时标记为美术决策并请用户确认。');
        } else {
          const identity = `${mainColor}\0${pattern}`;
          if (factionVisuals.has(identity)) {
            add('STAGE-02-FACTION-DUPLICATE', DATA_FILES.factions, faction.id, '两个势力使用相同的主色与纹样组合。', '调整为彼此可辨识的势力视觉体系，并经用户确认。');
          }
          factionVisuals.add(identity);
        }
        const ranks = asArray(faction.class_system);
        if (!ranks.length) {
          const ruleUnknown = faction.class_system_status === 'UNKNOWN' && faction.user_confirmation_required === true;
          add(ruleUnknown ? 'STAGE-02-RANKS-UNKNOWN' : 'STAGE-02-RANKS', DATA_FILES.factions, faction.id,
            ruleUnknown ? '原著未明确该势力的等级体系，等待用户确认，不得自行补造。' : '势力没有原著依据的等级体系。',
            '提取原著中出现的等级；原文没有等级时记录 UNKNOWN，并明确等待用户确认。');
        } else if (ranks.length !== factionRules.length || ranks.some((rank) => !factionRules.some((rule) => rule.rank === rank))) {
          add('STAGE-02-RANK-COVERAGE', DATA_FILES.costume_rules, faction.id, '服饰等级规则未覆盖该势力的全部等级。', '每个原著等级分别设计服装规则，不得合并层级。');
        }
        if (!factionRules.length) {
          add('STAGE-02-COSTUME-FACTION', DATA_FILES.costume_rules, faction.id, '势力缺少服饰等级规则。', '逐等级定义颜色、面料、结构、纹样、配饰、武器或身份标识和华丽度。');
        }
        for (const rule of factionRules) {
          for (const field of [
            'rank', 'color', 'material', 'structure', 'pattern', 'accessories', 'weapon',
            'insignia', 'ornament_level', 'garment_formality', 'costume_context',
          ]) {
            if (!isNonEmpty(rule[field])) add('STAGE-02-COSTUME-FIELDS', DATA_FILES.costume_rules, rule.id, `服饰等级规则缺少 ${field}。`, '补齐可执行的等级视觉差异；未知内容标记为推断或待确认。');
          }
          for (const field of ['material_grade', 'craftsmanship_grade', 'insignia_grade', 'accessory_grade']) {
            const grade = rule[field];
            if (!(Number.isInteger(grade) && grade >= 1 && grade <= 5) && grade !== 'UNKNOWN') {
              add('STAGE-02-COSTUME-GRADE', DATA_FILES.costume_rules, rule.id, `${field} 必须是 1–5 等级或 UNKNOWN。`, '分别记录面料、工艺、身份标识和配饰等级，不得只按颜色或华丽度区分。');
            }
          }
          if (!Array.isArray(rule.source_refs)) {
            add('STAGE-02-COSTUME-SOURCE', DATA_FILES.costume_rules, rule.id, '服饰等级规则缺少来源引用数组。', '记录原著依据；原著未说明时标记 UNKNOWN 并等待用户确认。');
          }
          const validException = isNonEmpty(rule.exception_reason) &&
            (isNonEmpty(rule.exception_approved_by) ||
              asArray(rule.exception_evidence_refs).some((id) => evidenceIds.has(id)));
          if (isNonEmpty(rule.exception_reason) && !validException) {
            add('STAGE-02-COSTUME-EXCEPTION', DATA_FILES.costume_rules, rule.id, '特殊服饰例外缺少原著证据或用户批准。', '添加有效原著证据引用，或记录用户批准人和例外理由。');
          }
          if (!Number.isInteger(rule.rank_order) || rule.rank_order < 1) {
            add('STAGE-02-RANK-ORDER', DATA_FILES.costume_rules, rule.id, '服饰等级缺少正整数 rank_order。', '按原著等级从低到高设置稳定序号。');
          }
          if (!Number.isFinite(rule.ornament_score) || rule.ornament_score < 1 || rule.ornament_score > 5) {
            add('STAGE-02-ORNAMENT-SCORE', DATA_FILES.costume_rules, rule.id, '服饰等级缺少 1–5 的 ornament_score。', '以机器可检查的华丽度梯度表达等级差异。');
          }
        }
        const sortedRules = [...factionRules].filter((rule) => Number.isInteger(rule.rank_order)).sort((a, b) => a.rank_order - b.rank_order);
        if (new Set(sortedRules.map((rule) => rule.rank)).size !== sortedRules.length ||
            new Set(sortedRules.map((rule) => rule.rank_order)).size !== sortedRules.length) {
          add('STAGE-02-RANK-DUPLICATE', DATA_FILES.costume_rules, faction.id, '同一势力内服饰等级或 rank_order 重复。', '为每个等级保留唯一规则和顺序。');
        }
        for (let index = 1; index < sortedRules.length; index++) {
          const current = sortedRules[index];
          const previous = sortedRules[index - 1];
          const approvedException = isNonEmpty(current.exception_reason) &&
            (isNonEmpty(current.exception_approved_by) ||
              asArray(current.exception_evidence_refs).some((id) => evidenceIds.has(id)));
          if (current.ornament_score < previous.ornament_score && !approvedException) {
            add('STAGE-02-ORNAMENT-ORDER', DATA_FILES.costume_rules, current.id, '低等级服饰华丽度高于前一级。', '使华丽度随等级上升或保持一致；特殊例外必须有原著依据或用户批准。');
          }
          for (const field of ['material_grade', 'craftsmanship_grade', 'insignia_grade', 'accessory_grade']) {
            if (Number.isInteger(previous[field]) && Number.isInteger(current[field]) &&
                current[field] < previous[field] && !approvedException) {
              add('STAGE-02-COSTUME-GRADE-ORDER', DATA_FILES.costume_rules, current.id, `${field} 低于同势力的前一等级。`, '检查等级区分；例外须记录原著依据或用户批准，不能仅凭颜色或华丽度区分。');
            }
          }
        }
      }
      break;
    }
    case '03-master-assets': {
      const masters = list(data, 'asset_registry').filter((asset) => ['character', 'scene', 'prop'].includes(asset.asset_type) && !asset.parent_asset_version_id);
      if (!masters.length) add('STAGE-03-MASTERS', DATA_FILES.asset_registry, null, '尚未登记人物、场景或道具主资产。', '建立资产身份档案并生成主参考图。');
      for (const [key, type] of [['characters', 'character'], ['scenes', 'scene'], ['props', 'prop']]) {
        const registered = new Set(masters.filter((asset) => asset.asset_type === type).map((asset) => asset.asset_id));
        for (const entity of list(data, key)) {
          if (!registered.has(entity.id)) {
            add('STAGE-03-ASSET-COVERAGE', DATA_FILES.asset_registry, entity.id, `缺少 ${type} 主资产。`, '为每个人物、重要场景和道具创建独立主资产参考图。');
          }
        }
      }
      for (const asset of masters) {
        if (asset.approval_status !== 'APPROVED') add('STAGE-03-HUMAN-REVIEW', DATA_FILES.asset_registry, asset.asset_id, '主资产尚未获得人工审核通过。', '先展示参考图及提示词，等待用户明确确认后锁定版本。');
        if (!isNonEmpty(asset.file)) add('STAGE-03-ASSET-FILE', DATA_FILES.asset_registry, asset.asset_id, '主资产尚未登记真实图片文件。', '检查生成能力和文件落盘结果；不得伪造文件路径。');
        if (!isNonEmpty(asset.prompt) || !isNonEmpty(asset.prompt_version)) {
          add('STAGE-03-PROMPT', DATA_FILES.asset_registry, asset.asset_id, '主资产缺少可复用的完整提示词或提示词版本。', '保存最终提示词、组装后的世界观约束和提示词版本。');
        }
      }
      break;
    }
    case '04-derived-assets': {
      for (const asset of list(data, 'asset_registry').filter((entry) => entry.parent_asset_version_id)) {
        if (!asset.reference_asset_version_ids?.includes(asset.parent_asset_version_id)) {
          add('STAGE-04-PARENT-REFERENCE', DATA_FILES.asset_registry, asset.asset_id, '衍生资产未显式引用其主资产版本。', '复用已经确认的主资产参考图，记录 parent 和 reference 版本。');
        }
        if (asset.approval_status !== 'APPROVED') {
          add('STAGE-04-HUMAN-REVIEW', DATA_FILES.asset_registry, asset.asset_id, '衍生资产尚未人工审核通过。', '检查身份一致性和变更范围，等待用户审核确认。');
        }
        if (!isNonEmpty(asset.file) || !isNonEmpty(asset.prompt)) {
          add('STAGE-04-OUTPUT', DATA_FILES.asset_registry, asset.asset_id, '衍生资产缺少真实图片文件或完整提示词。', '登记实际生成文件和提示词；不可覆盖已批准的旧版本。');
        }
        if (asset.asset_type === 'character') {
          const parent = assetVersions(data).get(asset.parent_asset_version_id);
          const characterId = asset.character_id ?? asset.asset_id;
          const character = list(data, 'characters').find((entry) => entry.id === characterId);
          const anchor = asset.identity_anchor_id ?? character?.identity_anchor_id;
          if (!isNonEmpty(anchor) || (parent?.identity_anchor_id && parent.identity_anchor_id !== anchor)) {
            add('CHARACTER-IDENTITY-ANCHOR', DATA_FILES.asset_registry, asset.asset_id, '人物衍生资产缺少与主版本一致的身份锚点。', '普通换装和年龄时期变化必须继承身份锚点及核心识别特征。');
          }
          if (asset.transformation_type && asset.transformation_type !== 'COSTUME_CHANGE' &&
              (asset.identity_change_allowed !== true || !asArray(asset.identity_change_evidence).length)) {
            add('CHARACTER-IDENTITY-CHANGE-EVIDENCE', DATA_FILES.asset_registry, asset.asset_id, '幻化、易容、夺舍或变身缺少明确授权及原著依据。', '记录 transformation_type、identity_change_allowed 和对应 source evidence。');
          }
        }
      }
      for (const character of list(data, 'characters')) {
        const characterAssets = list(data, 'asset_registry').filter((asset) =>
          asset.asset_type === 'character' && (asset.character_id === character.id || asset.asset_id === character.id),
        );
        const master = characterAssets.find((asset) => !asset.parent_asset_version_id && asset.approval_status === 'APPROVED');
        for (const view of asArray(character.required_views)) {
          const found = characterAssets.some((asset) => asset.view_type === view &&
            asset.approval_status === 'APPROVED' && !asset.stale &&
            (view === 'FRONT' ? !asset.parent_asset_version_id
              : master && asset.parent_asset_version_id === master.version_id));
          if (!found) add('CHARACTER-REQUIRED-VIEW', DATA_FILES.asset_registry, character.id,
            `人物 ${character.id} 缺少已批准且引用主版本的 ${view} 视角资产。`,
            '仅为配置要求的主要人物视角生成资产；所有非主视角必须引用已批准主资产版本。');
        }
      }
      break;
    }
    case '05-screenplay': {
      issues.push(...checkCoverage(data));
      const coveredBeats = list(data, 'event_beats');
      const requiredBeatTypes = ['CAUSE', 'PROCESS', 'KEY_ACTION', 'REACTION', 'RESULT', 'CONSEQUENCE'];
      for (const event of list(data, 'story_events').filter((entry) => entry.importance !== 'MINOR')) {
        const eventBeats = coveredBeats.filter((beat) => beat.event_id === event.id);
        if (!eventBeats.length) {
          add('EVENT-BEATS-MISSING', DATA_FILES.event_beats, event.id, '重要原著事件缺少关键事实单元拆解。', '拆分起因、经过、关键动作、重要对话、人物反应、结果和后续影响，并映射到剧本片段和镜头。');
        }
        for (const beatType of [...requiredBeatTypes, ...(event.dialogue_required ? ['DIALOGUE'] : [])]) {
          if (!eventBeats.some((beat) => beat.beat_type === beatType)) {
            add('EVENT-BEAT-TYPE-MISSING', DATA_FILES.event_beats, event.id, `重要事件缺少 ${beatType} 事实单元。`,
              '逐项保留事件起因、经过、关键动作、人物反应、结果和后续影响；原著有关键对话时单独拆解。');
          }
        }
      }
      for (const beat of coveredBeats) {
        if (!asArray(beat.screenplay_scene_ids).length || !asArray(beat.screenplay_segment_ids).length) {
          add('EVENT-BEAT-SCREENPLAY-COVERAGE', DATA_FILES.event_beats, beat.id, '重要事实单元未映射到剧本场次和片段。', '逐项关联保留该事实的剧本场次及具体剧本片段。');
        }
      }
      if (!list(data, 'screenplay').length) add('STAGE-05-SCREENPLAY', DATA_FILES.screenplay, null, '剧本没有场次。', '按原著事件写场次，结构化区分对白、旁白、内心独白、动作和环境。');
      for (const scene of list(data, 'screenplay')) {
        if (!asArray(scene.event_ids).length) add('STAGE-05-SCENE-EVENTS', DATA_FILES.screenplay, scene.id, '剧本场次没有绑定原著事件。', '将每场戏映射到一条或多条原著事件。');
        const continuity = list(data, 'continuity').find((entry) => entry.chapter_id === scene.chapter_id);
        if (!continuity || continuity.read_status !== 'READ') {
          add('STAGE-05-CONTINUITY-CHAPTER', DATA_FILES.continuity, scene.chapter_id ?? scene.id, '剧本章节缺少已读并确认的连续性状态。', '记录已读章节、已确认事件、人物当前状态和未解决问题，再继续剧本制作。');
        } else {
          const currentIndex = list(data, 'source_index').findIndex((chapter) => chapter.id === scene.chapter_id);
          if (currentIndex > 0) {
            const previousChapterId = list(data, 'source_index')[currentIndex - 1].id;
            if (continuity.inherited_from_chapter_id !== previousChapterId) {
              add('STAGE-05-CONTINUITY-INHERITANCE', DATA_FILES.continuity, scene.chapter_id, '新章节未继承上一章节的确认状态。', '继承前章人物时期、服装、伤势、持有道具、场景状态和未解决问题。');
            }
          }
          for (const characterId of asArray(scene.character_ids)) {
            if (!asArray(continuity.character_states).some((state) => state.character_id === characterId)) {
              add('STAGE-05-CONTINUITY-CHARACTER', DATA_FILES.continuity, scene.chapter_id, `缺少人物 ${characterId} 的当前连续性状态。`, '记录人物年龄/时期、当前服装、伤势、持有道具和所在场景。');
            }
          }
        }
        let calculatedDuration = 0;
        for (const segment of asArray(scene.segments)) {
          const duration = estimateSegmentDuration(segment);
          if (!Number.isFinite(duration) || duration <= 0) {
            add('STAGE-05-SEGMENT-DURATION', DATA_FILES.screenplay, segment.id ?? scene.id, '剧本片段缺少可计算的正时长。', '对白/旁白按字数与语速估算；动作/环境片段填写叙事所需时长。');
          } else calculatedDuration += duration;
          if (segment.type === 'DIALOGUE' && !characters.has(segment.speaker_id)) {
            add('STAGE-05-DIALOGUE-SPEAKER', DATA_FILES.screenplay, segment.id ?? scene.id, '对白缺少有效说话人 ID。', '将说话人绑定到 characters.json 中的角色。');
          }
        }
        if (!Number.isFinite(scene.estimated_duration_seconds) || scene.estimated_duration_seconds <= 0) {
          add('STAGE-05-SCENE-DURATION', DATA_FILES.screenplay, scene.id, '场次缺少正的预计时长。', '根据台词、动作和环境镜头的叙事价值汇总时长。');
        } else if (Math.abs(scene.estimated_duration_seconds - calculatedDuration) > Math.max(0.5, calculatedDuration * 0.1)) {
          add('STAGE-05-DURATION-TOTAL', DATA_FILES.screenplay, scene.id, `场次预计时长 ${scene.estimated_duration_seconds}s 与片段估算 ${Math.round(calculatedDuration * 10) / 10}s 不一致。`, '修正分段时长或场次总时长；不得为套固定时长删除原著信息。');
        }
      }
      break;
    }
    case '06-storyboard': {
      if (!list(data, 'storyboard').length) add('STAGE-06-SHOTS', DATA_FILES.storyboard, null, '分镜清单为空。', '先按场次拆镜头和关键帧，审核分镜图后再生成视频。');
      for (const shot of list(data, 'storyboard')) {
        if (!isNonEmpty(shot.image_file)) add('STAGE-06-IMAGE', DATA_FILES.storyboard, shot.id, '分镜图没有登记真实文件。', '使用已审核资产生成分镜候选图，并登记实际路径。');
        if (shot.review_status !== 'APPROVED') add('STAGE-06-REVIEW', DATA_FILES.storyboard, shot.id, '分镜图尚未人工审核通过。', '展示候选图并等待人工确认。');
      }
      for (const beat of list(data, 'event_beats')) {
        if (!asArray(beat.shot_ids).length || beat.shot_ids.some((id) => !entityIds(data, 'storyboard').has(id))) {
          add('EVENT-BEAT-SHOT-COVERAGE', DATA_FILES.event_beats, beat.id, '原著关键事实未映射到有效分镜镜头。', '为起因、关键动作、对话、反应、结果和后续影响安排明确镜头。');
        }
      }
      break;
    }
    case '07-video': {
      const videos = list(data, 'production_tasks').filter((task) => task.kind === 'VIDEO');
      if (!videos.length) add('STAGE-07-TASKS', DATA_FILES.production_tasks, null, '没有视频生成任务。', '从已审核分镜图建立视频任务，不默认生成对白或背景音乐。');
      for (const task of videos) {
        if (task.status !== 'COMPLETED' || !isNonEmpty(task.output_file)) {
          add('STAGE-07-OUTPUT', DATA_FILES.production_tasks, task.id, `视频任务未成功完成（${task.status ?? '无状态'}）。`, '真实检查视频文件并记录失败原因；任务启动不等于成功。');
        }
        for (const field of ['model', 'prompt', 'resolution', 'aspect_ratio']) {
          if (!isNonEmpty(task[field])) add('STAGE-07-METADATA', DATA_FILES.production_tasks, task.id, `视频生成记录缺少 ${field}。`, '记录实际使用的模型、提示词、分辨率和画幅。');
        }
        if (!Number.isFinite(task.duration_seconds) || task.duration_seconds <= 0) {
          add('STAGE-07-DURATION', DATA_FILES.production_tasks, task.id, '视频任务缺少有效时长。', '记录模型实际生成单元的时长。');
        }
        if (!asArray(task.reference_asset_version_ids).length) {
          add('STAGE-07-ASSET-REF', DATA_FILES.production_tasks, task.id, '视频任务未记录参考资产版本。', '保存实际引用的已确认人物、场景、道具和分镜版本。');
        }
      }
      break;
    }
    case '08-audio-qc': {
      if (!list(data, 'audio_timeline').length) add('STAGE-08-AUDIO', DATA_FILES.audio_timeline, null, '独立音频时间轴为空。', '按对白、旁白、内心独白、环境音效、特效音效和背景音乐管理音频。');
      for (const track of list(data, 'audio_timeline')) {
        if (!['DIALOGUE', 'NARRATION', 'INNER_MONOLOGUE', 'AMBIENCE', 'SFX', 'BACKGROUND_MUSIC'].includes(track.type)) {
          add('STAGE-08-AUDIO-TYPE', DATA_FILES.audio_timeline, track.id, `音轨类型非法：${track.type ?? '缺失'}。`, '使用对白、旁白、内心独白、环境音效、特效音效或背景音乐类型。');
        }
        if (track.status === 'NOT_APPLICABLE') {
          if (!isNonEmpty(track.reason)) add('STAGE-08-AUDIO-NA-REASON', DATA_FILES.audio_timeline, track.id, 'NOT_APPLICABLE 音轨缺少原因。', '记录该镜头不需要此类音轨的理由。');
        } else if (track.status !== 'COMPLETED' || !isNonEmpty(track.file)) {
          add('STAGE-08-AUDIO-FILE', DATA_FILES.audio_timeline, track.id, '音频时间轴条目尚无已完成的真实音频文件。', '确认实际文件和时间轴同步后再提交终检。');
        }
        if (track.status !== 'NOT_APPLICABLE' && (!Number.isFinite(track.start_seconds) || track.start_seconds < 0 ||
            !Number.isFinite(track.duration_seconds) || track.duration_seconds <= 0)) {
          add('STAGE-08-AUDIO-TIMING', DATA_FILES.audio_timeline, track.id, '音频轨道缺少有效时间范围。', '提供非负起始时间和正的实际时长。');
        }
      }
      const requiredAudioChecks = [
        'unexpected_bgm', 'stream_separation', 'voice_consistency', 'lip_sync',
        'environment_sound_repetition', 'final_audio_integrity',
      ];
      const finalQc = asArray(data.quality_reports?.reports).find((report) => report.scope === 'FINAL' && report.status === 'APPROVED');
      for (const checkId of requiredAudioChecks) {
        const check = asArray(finalQc?.checks).find((entry) => entry.id === checkId);
        if (!check || !['PASS', 'NOT_APPLICABLE'].includes(check.status) ||
            (check.status === 'NOT_APPLICABLE' && !isNonEmpty(check.reason))) {
          add('STAGE-08-AUDIO-QC-CHECK', DATA_FILES.quality_reports, checkId, `缺少 ${checkId} 的人工音视频质量检查记录或有效 NOT_APPLICABLE 理由。`,
            '记录实际核验结果；对白声音一致性、口型同步、意外 BGM、环境音重复及最终音轨完整性均需审核。');
        }
      }
      const finalRenders = list(data, 'production_tasks').filter((task) => task.kind === 'FINAL_RENDER');
      if (!finalRenders.some((task) => task.status === 'COMPLETED' && isNonEmpty(task.output_file))) {
        add('STAGE-08-FINAL-VIDEO', DATA_FILES.production_tasks, null, '缺少实际完成的最终视频输出。', '检查并登记可读取的最终视频文件。');
      }
      if (!asArray(data.quality_reports?.reports).some((report) => report.scope === 'FINAL' && report.status === 'APPROVED')) {
        add('STAGE-08-QC', DATA_FILES.quality_reports, null, '缺少最终人工质检通过记录。', '核查剧情覆盖、声画同步、重复音频、连续性和实际输出文件。');
      }
      break;
    }
    default:
      add('STAGE-UNKNOWN', 'project.json', stageId, '未知制作阶段。', '使用固定的八阶段 ID。');
  }
  return issues;
}

function sourceReferencesForPhase(context, phaseId) {
  const { data } = context;
  const chapterIds = new Set();
  const evidenceIds = new Set();
  const eventIds = new Set();
  const addRecord = (record) => {
    asArray(record?.source_refs).forEach((id) => chapterIds.add(typeof id === 'string' ? id : id?.chapter_id));
    asArray(record?.evidence_refs).forEach((id) => evidenceIds.add(typeof id === 'string' ? id : id?.source_id));
    asArray(record?.claims).forEach((claim) => addRecord(claim));
  };
  const addEvents = (ids) => {
    for (const id of ids) {
      eventIds.add(id);
      const event = list(data, 'story_events').find((entry) => entry.id === id);
      if (event) addRecord(event);
    }
  };
  if (phaseId === '01-source-analysis') {
    list(data, 'source_index').forEach((chapter) => chapterIds.add(chapter.id));
    asArray(context.project.source_files).forEach((entry) =>
      chapterIds.add(typeof entry === 'string' ? entry : entry.path),
    );
  } else if (phaseId === '02-art-direction') {
    [...list(data, 'factions'), ...list(data, 'costume_rules')].forEach(addRecord);
  } else if (['03-master-assets', '04-derived-assets'].includes(phaseId)) {
    const derived = phaseId === '04-derived-assets';
    const assets = list(data, 'asset_registry').filter((asset) =>
      derived ? Boolean(asset.parent_asset_version_id) : !asset.parent_asset_version_id,
    );
    assets.forEach(addRecord);
    for (const asset of assets) {
      const entityId = asset.character_id ?? asset.scene_id ?? asset.prop_id ?? asset.asset_id;
      const entity = [...list(data, 'characters'), ...list(data, 'scenes'), ...list(data, 'props')]
        .find((entry) => entry.id === entityId);
      if (entity) addRecord(entity);
    }
  } else if (phaseId === '05-screenplay') {
    for (const scene of list(data, 'screenplay')) {
      addEvents(asArray(scene.event_ids));
    }
    for (const beat of list(data, 'event_beats')) addRecord(beat);
  } else if (phaseId === '06-storyboard') {
    for (const shot of list(data, 'storyboard')) {
      if (shot.event_id) addEvents([shot.event_id]);
    }
  } else if (phaseId === '07-video') {
    for (const task of list(data, 'production_tasks').filter((entry) => entry.kind === 'VIDEO')) {
      for (const id of asArray(task.reference_asset_version_ids)) {
        const asset = assetVersions(data).get(id);
        if (asset) addRecord(asset);
      }
      const shot = list(data, 'storyboard').find((entry) => entry.id === task.shot_id);
      if (shot?.event_id) addEvents([shot.event_id]);
    }
  } else if (phaseId === '08-audio-qc') {
    for (const track of list(data, 'audio_timeline')) {
      const scene = list(data, 'screenplay').find((entry) => entry.id === track.screenplay_scene_id);
      if (scene) addEvents(asArray(scene.event_ids));
    }
  }
  const sourceFiles = new Set();
  const chapters = new Map(list(data, 'source_index').map((chapter) => [chapter.id, chapter]));
  const evidence = new Map(list(data, 'source_evidence').map((entry) => [entry.source_id, entry]));
  for (const chapterId of chapterIds) {
    const chapter = chapters.get(chapterId);
    if (chapter?.source_file) sourceFiles.add(chapter.source_file);
    else if (typeof chapterId === 'string' && chapterId.includes('/')) sourceFiles.add(chapterId);
  }
  for (const id of evidenceIds) {
    const entry = evidence.get(id);
    if (entry?.source_file) sourceFiles.add(entry.source_file);
  }
  return [...sourceFiles];
}

function changedSourcePaths(context) {
  return new Set(asArray(context.project.source_files).flatMap((entry) => {
    const record = typeof entry === 'string' ? { path: entry } : entry;
    const file = safePath(context.root, record?.path);
    if (!file || !record?.sha256 || !fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    return sha256(fs.readFileSync(file)) !== record.sha256 ? [record.path] : [];
  }));
}

function markChangedSourceDependents(context) {
  const changedPaths = changedSourcePaths(context);
  if (!changedPaths.size) return false;
  let modified = false;
  const changedChapters = new Set(list(context.data, 'source_index')
    .filter((chapter) => changedPaths.has(chapter.source_file)).map((chapter) => chapter.id));
  const changedEvidence = new Set(list(context.data, 'source_evidence')
    .filter((entry) => changedPaths.has(entry.source_file)).map((entry) => entry.source_id));
  const usesChangedSource = (record) =>
    asArray(record?.source_refs).some((id) => changedChapters.has(typeof id === 'string' ? id : id?.chapter_id)) ||
    asArray(record?.evidence_refs).some((id) => changedEvidence.has(typeof id === 'string' ? id : id?.source_id)) ||
    asArray(record?.claims).some(usesChangedSource);
  const changedEvents = new Set(list(context.data, 'story_events')
    .filter((event) => usesChangedSource(event)).map((event) => event.id));
  const affectedEntities = new Set([
    ...list(context.data, 'characters'),
    ...list(context.data, 'scenes'),
    ...list(context.data, 'props'),
  ].filter(usesChangedSource).map((entity) => entity.id));
  for (const asset of list(context.data, 'asset_registry')) {
    if (usesChangedSource(asset) || affectedEntities.has(asset.character_id ?? asset.scene_id ?? asset.prop_id ?? asset.asset_id)) {
      if (!asset.stale) {
        asset.stale = true;
        modified = true;
      }
    }
  }
  const staleAssetVersions = new Set(list(context.data, 'asset_registry').filter((asset) => asset.stale).map((asset) => asset.version_id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const asset of list(context.data, 'asset_registry')) {
      if (!asset.stale && (staleAssetVersions.has(asset.parent_asset_version_id) ||
          asArray(asset.reference_asset_version_ids).some((id) => staleAssetVersions.has(id)))) {
        asset.stale = true;
        staleAssetVersions.add(asset.version_id);
        modified = true;
        grew = true;
      }
    }
  }
  for (const scene of list(context.data, 'screenplay')) {
    if (asArray(scene.event_ids).some((id) => changedEvents.has(id)) && !scene.stale) {
      scene.stale = true;
      modified = true;
    }
  }
  for (const beat of list(context.data, 'event_beats')) {
    if ((changedEvents.has(beat.event_id) || usesChangedSource(beat)) && !beat.stale) {
      beat.stale = true;
      modified = true;
    }
  }
  const changedShots = new Set(list(context.data, 'storyboard')
    .filter((shot) => changedEvents.has(shot.event_id)).map((shot) => shot.id));
  for (const shot of list(context.data, 'storyboard')) {
    if (changedEvents.has(shot.event_id) && !shot.stale) {
      shot.stale = true;
      modified = true;
    }
  }
  for (const task of list(context.data, 'production_tasks')) {
    if (changedShots.has(task.shot_id) && !task.stale) {
      task.stale = true;
      modified = true;
    }
  }
  return modified;
}

export function phaseSnapshot(context, phaseId) {
  const keys = STAGE_SNAPSHOT_FILES[phaseId] ?? [];
  const parts = [];
  const addMediaDigest = (items) => {
    for (const item of items) {
      if (!isNonEmpty(item.file ?? item.output_file ?? item.image_file)) continue;
      const relative = item.file ?? item.output_file ?? item.image_file;
      const file = safePath(context.root, relative);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        parts.push(`media:${relative}\0${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
      }
    }
  };
  for (const key of keys) {
    const file = context.files[key];
    if (key === 'asset_registry') {
      const assets = list(context.data, key).filter((asset) =>
        phaseId === '03-master-assets' ? !asset.parent_asset_version_id : Boolean(asset.parent_asset_version_id),
      );
      parts.push(`${key}\0${JSON.stringify(assets)}`);
    } else if (key === 'production_tasks' && phaseId === '07-video') {
      parts.push(`${key}\0${JSON.stringify(list(context.data, key).filter((task) => task.kind === 'VIDEO'))}`);
    } else {
      parts.push(`${key}\0${fs.readFileSync(file)}`);
    }
  }
  if (['03-master-assets', '04-derived-assets'].includes(phaseId)) {
    addMediaDigest(list(context.data, 'asset_registry').filter((asset) =>
      phaseId === '03-master-assets' ? !asset.parent_asset_version_id : Boolean(asset.parent_asset_version_id),
    ));
  }
  if (phaseId === '06-storyboard') addMediaDigest(list(context.data, 'storyboard'));
  if (phaseId === '07-video') addMediaDigest(list(context.data, 'production_tasks').filter((task) => task.kind === 'VIDEO'));
  if (phaseId === '08-audio-qc') addMediaDigest(list(context.data, 'audio_timeline'));
  if (phaseId === '01-source-analysis' && fs.existsSync(context.worldBible)) {
    parts.push(`world_bible\0${fs.readFileSync(context.worldBible)}`);
  }
  for (const relative of sourceReferencesForPhase(context, phaseId)) {
    const file = safePath(context.root, relative);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      parts.push(`source:${relative}\0${sha256(fs.readFileSync(file))}`);
    }
  }
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function validateProject(context, options = {}) {
  const { root, project, data } = context;
  const issues = [
    ...validateSchemas(context),
    ...checkProjectStructure(project),
    ...checkApprovals(project, data),
    ...checkCollectionIds(data),
    ...checkSourceEvidence(context),
    ...checkReferences(data),
    ...checkFiles(root, data),
    ...checkProjectFiles(context),
  ];
  if (list(data, 'screenplay').length || list(data, 'story_coverage').length) {
    issues.push(...checkCoverage(data));
  }
  if (options.stage) issues.push(...stageIssues(options.stage, context));
  if (options.includeApprovalDrift !== false) {
    for (const phase of asArray(project.phases)) {
      if (phase.status === 'APPROVED' && phase.snapshot_sha256) {
        const latest = phaseSnapshot(context, phase.id);
        if (latest !== phase.snapshot_sha256) {
          issues.push(issue('PHASE-APPROVAL-STALE', 'project.json', phase.id, '已确认阶段的交付内容在确认后发生变化。', '运行 refresh-stale，使该阶段及其下游进入 STALE，再重新审核受影响内容。'));
        }
      }
    }
  }
  return issues;
}

export function buildImagePrompt(style, parts, mode = 'ASSET') {
  if (!['ASSET', 'STORYBOARD'].includes(mode) && ![
    'CHARACTER_ASSET', 'CHARACTER_VIEWS', 'CHARACTER_EXPRESSION', 'CHARACTER_DERIVATIVE',
    'SCENE_MASTER', 'SCENE_VARIANT', 'PROP_ASSET',
  ].includes(mode)) throw new Error('图片提示词模式无效。');
  return buildPrompt(style, parts, mode).prompt;
}

export function buildPromptForProject(context, parts, requestedType) {
  const taskType = String(requestedType ?? parts.task_type ?? '').toUpperCase();
  let promptParts = { ...parts };
  if (parts.task_id) {
    const task = list(context.data, 'production_tasks').find((entry) => entry.id === parts.task_id);
    if (!task) throw new Error(`生图预检失败：找不到任务 ${parts.task_id}。`);
    promptParts = {
      ...task,
      ...promptParts,
      reference_asset_version_ids: promptParts.reference_asset_version_ids ?? task.reference_asset_version_ids,
    };
    if (task.shot_id) promptParts.shot_id = task.shot_id;
  }
  if (promptParts.shot_id) {
    const shot = list(context.data, 'storyboard').find((entry) => entry.id === promptParts.shot_id);
    if (!shot) throw new Error(`生图预检失败：找不到分镜 ${promptParts.shot_id}。`);
    promptParts = {
      ...shot,
      ...promptParts,
      reference_asset_version_ids: promptParts.reference_asset_version_ids ?? shot.asset_version_ids,
      scene_id: promptParts.scene_id ?? shot.scene_id,
      character_ids: promptParts.character_ids ?? shot.character_ids,
      prop_ids: promptParts.prop_ids ?? shot.prop_ids,
    };
  }
  const referenceIds = promptParts.reference_asset_version_ids ??
    asArray(promptParts.references).map((reference) => typeof reference === 'string' ? reference : reference.version_id);
  const assets = assetVersions(context.data);
  const references = asArray(referenceIds).map((id) => {
    const asset = assets.get(id);
    if (!asset) throw new Error(`生图预检失败：参考资产版本不存在 ${id}。`);
    if (asset.approval_status !== 'APPROVED' || asset.stale) {
      throw new Error(`生图预检失败：参考资产 ${id} 未批准或已过期。`);
    }
    const file = safePath(context.root, asset.file);
    if (!file || !fs.existsSync(file) || !imageDimensions(fs.readFileSync(file))) {
      throw new Error(`生图预检失败：参考图 ${id} 缺失或不是可读取的 PNG/JPEG/WebP。`);
    }
    return {
      ...asset,
      role: asset.parent_asset_version_id ? 'variant' : 'master',
    };
  });
  promptParts.references = references;
  if (promptParts.character_id) promptParts.character_ids ??= [promptParts.character_id];
  const characterId = promptParts.character_id ?? asArray(promptParts.character_ids)[0];
  const character = list(context.data, 'characters').find((entry) => entry.id === characterId);
  if (character) {
    if (!isNonEmpty(character.identity_anchor_id)) {
      throw new Error('生图预检失败：人物档案缺少 identity_anchor_id。');
    }
    if (promptParts.identity_anchor_id && character.identity_anchor_id &&
        promptParts.identity_anchor_id !== character.identity_anchor_id) {
      throw new Error('生图预检失败：提示词身份锚点与人物档案不一致。');
    }
    promptParts.identity_anchor_id ??= character.identity_anchor_id;
    promptParts.identity_anchor ??= character.identity_anchor;
    if (!isNonEmpty(promptParts.appearance_period)) {
      throw new Error('生图预检失败：人物当前时期未明确。');
    }
    if (['CHARACTER_DERIVATIVE', 'CHARACTER_VIEWS', 'CHARACTER_EXPRESSION'].includes(taskType) &&
        !isNonEmpty(promptParts.costume_variant)) {
      throw new Error('生图预检失败：人物服装/状态变体未明确。');
    }
    const factionId = promptParts.faction_id ?? character.faction_id;
    if (factionId) {
      if (!isNonEmpty(promptParts.faction_rank) || !isNonEmpty(promptParts.costume_context)) {
        throw new Error('生图预检失败：人物服装缺少势力等级或服装场景。');
      }
      const rule = list(context.data, 'costume_rules').find((entry) =>
        entry.faction_id === factionId && entry.rank === promptParts.faction_rank &&
        entry.costume_context === promptParts.costume_context,
      );
      if (!rule) throw new Error('生图预检失败：找不到与势力、等级和服装场景对应的服饰规则。');
      promptParts.faction_costume_rule = rule;
    }
    if (promptParts.transformation_type && promptParts.transformation_type !== 'COSTUME_CHANGE') {
      const evidenceIds = new Set(list(context.data, 'source_evidence').map((entry) => entry.source_id));
      if (promptParts.identity_change_allowed !== true ||
          !asArray(promptParts.identity_change_evidence).length ||
          asArray(promptParts.identity_change_evidence).some((id) => !evidenceIds.has(id))) {
        throw new Error('生图预检失败：特殊身份变化缺少明确授权或有效原文证据。');
      }
    }
  }
  return buildPrompt(context.data.visual_style, promptParts, taskType);
}

export function affectedAssetVersions(data, changedVersionId) {
  const assets = list(data, 'asset_registry');
  if (!assets.some((asset) => asset.version_id === changedVersionId)) {
    throw new Error(`找不到资产版本：${changedVersionId}`);
  }
  const affected = new Set([changedVersionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const asset of assets) {
      if (!affected.has(asset.version_id) &&
          (affected.has(asset.parent_asset_version_id) || asArray(asset.reference_asset_version_ids).some((id) => affected.has(id)))) {
        affected.add(asset.version_id);
        grew = true;
      }
    }
  }
  const shots = list(data, 'storyboard').filter((shot) => asArray(shot.asset_version_ids).some((id) => affected.has(id))).map((shot) => shot.id);
  const tasks = list(data, 'production_tasks').filter((task) =>
    shots.includes(task.shot_id) || asArray(task.reference_asset_version_ids).some((id) => affected.has(id)),
  ).map((task) => task.id);
  return { asset_version_ids: [...affected], shot_ids: shots, task_ids: tasks };
}

function saveContext(context) {
  writeJson(path.join(context.root, 'project.json'), context.project);
  for (const [key, data] of Object.entries(context.data)) writeJson(context.files[key], data);
}

export function beginPhase(context, phaseId) {
  const index = context.project.phases.findIndex((phase) => phase.id === phaseId);
  if (index < 0) throw new Error(`未知阶段：${phaseId}`);
  const phase = context.project.phases[index];
  const previous = context.project.phases[index - 1];
  if (previous && !['APPROVED', 'SKIPPED'].includes(previous.status)) {
    throw new Error(`不能开始 ${phase.name}：上一阶段 ${previous.name} 尚未由用户确认。`);
  }
  if (!['NOT_STARTED', 'FAILED', 'REJECTED', 'BLOCKED', 'STALE', 'IN_PROGRESS'].includes(phase.status)) {
    throw new Error(`阶段 ${phase.name} 当前状态为 ${phase.status}，不能开始。`);
  }
  phase.status = 'IN_PROGRESS';
  phase.started_at ||= now();
  context.project.current_phase = phaseId;
  saveContext(context);
}

export function submitPhaseForReview(context, phaseId) {
  const phase = context.project.phases.find((entry) => entry.id === phaseId);
  if (!phase || phase.id !== context.project.current_phase) throw new Error('只能提交当前制作阶段。');
  if (phase.status !== 'IN_PROGRESS') throw new Error(`阶段必须为 IN_PROGRESS 才能提交，目前为 ${phase.status}。`);
  phase.status = 'VALIDATING';
  const issues = validateProject(context, { stage: phaseId, includeApprovalDrift: false });
  const failed = issues.some((entry) => entry.severity !== 'WARNING');
  context.data.quality_reports.reports.push({
    id: `gate-${phaseId}-${Date.now()}`,
    scope: phaseId,
    status: failed ? 'FAILED' : 'PENDING_REVIEW',
    created_at: now(),
    issues,
  });
  phase.status = failed ? 'FAILED' : 'PENDING_REVIEW';
  saveContext(context);
  return issues;
}

export function recordApproval(context, phaseId, action, by, note = '') {
  const phase = context.project.phases.find((entry) => entry.id === phaseId);
  if (!phase || phase.id !== context.project.current_phase) throw new Error('只能审核当前制作阶段。');
  if (phase.status !== 'PENDING_REVIEW') throw new Error(`阶段尚未通过质量门并等待审核（当前状态 ${phase.status}）。`);
  if (!isNonEmpty(by)) throw new Error('必须记录作出决定的用户或审核人。');
  if (!['APPROVED', 'REJECTED'].includes(action)) throw new Error('审核动作必须为 APPROVED 或 REJECTED。');
  const entry = {
    id: `approval-${phaseId}-${Date.now()}`,
    phase_id: phaseId,
    decision: action,
    decided_by: by,
    decided_at: now(),
    note,
    snapshot_sha256: phaseSnapshot(context, phaseId),
  };
  context.data.approvals.approvals.push(entry);
  if (action === 'APPROVED') {
    phase.status = 'APPROVED';
    phase.version += 1;
    phase.approved_at = entry.decided_at;
    phase.approved_by = by;
    phase.approval_note = note;
    phase.snapshot_sha256 = entry.snapshot_sha256;
    phase.skipped_reason = null;
    phase.skipped_by = null;
    phase.skipped_at = null;
    const index = context.project.phases.indexOf(phase);
    context.project.current_phase = context.project.phases[index + 1]?.id ?? null;
  } else {
    phase.status = 'REJECTED';
    phase.approval_note = note;
  }
  saveContext(context);
  return entry;
}

export function recordSkip(context, phaseId, by, reason) {
  const phase = context.project.phases.find((entry) => entry.id === phaseId);
  if (!phase || phase.id !== context.project.current_phase) throw new Error('只能跳过当前制作阶段。');
  if (phase.status === 'APPROVED' || phase.status === 'SKIPPED') {
    throw new Error(`阶段 ${phase.name} 当前状态为 ${phase.status}，不能跳过。`);
  }
  if (!isNonEmpty(by) || !isNonEmpty(reason)) throw new Error('跳过阶段必须记录明确授权人和原因。');
  const entry = {
    id: `approval-${phaseId}-${Date.now()}`,
    phase_id: phaseId,
    decision: 'SKIPPED',
    decided_by: by,
    decided_at: now(),
    note: reason,
    snapshot_sha256: phaseSnapshot(context, phaseId),
  };
  context.data.approvals.approvals.push(entry);
  phase.status = 'SKIPPED';
  phase.skipped_by = by;
  phase.skipped_at = entry.decided_at;
  phase.skipped_reason = reason;
  const index = context.project.phases.indexOf(phase);
  context.project.current_phase = context.project.phases[index + 1]?.id ?? null;
  saveContext(context);
  return entry;
}

export function refreshStalePhases(context) {
  const sourceDependentsChanged = markChangedSourceDependents(context);
  const changed = [];
  for (const phase of context.project.phases) {
    if (phase.status === 'APPROVED' && phase.snapshot_sha256 &&
        phaseSnapshot(context, phase.id) !== phase.snapshot_sha256) {
      phase.status = 'STALE';
      changed.push(phase.id);
    }
  }
  if (changed.length) {
    context.project.current_phase = changed[0];
  }
  if (changed.length || sourceDependentsChanged) {
    saveContext(context);
  }
  return changed;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reportAssetPath(root, file, reportFile = 'reports/review.html') {
  const resolved = safePath(root, file);
  if (!resolved || !fs.existsSync(resolved)) return null;
  const relative = path.posix.relative(
    path.posix.dirname(toPosixPath(reportFile)),
    toPosixPath(file),
  );
  return relative.split('/').map((part) => part === '..' ? part : encodeURIComponent(part)).join('/');
}

export function renderReport(context, reportFile = 'reports/review.html') {
  const { project, data, root } = context;
  const issues = validateProject(context);
  const phaseRecords = asArray(project.phases);
  const phases = phaseRecords.map((phase) => `<li class="phase ${escapeHtml(String(phase.status ?? 'unknown').toLowerCase())}"><b>${escapeHtml(phase.id)}</b><span>${escapeHtml(phase.name)}</span><strong>${escapeHtml(phase.status)}</strong></li>`).join('');
  const reviewButtons = () => `<div class="review-actions">${['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'REGENERATE'].map((status) => `<button data-review="${status}">${status}</button>`).join('')}</div>`;
  const assets = list(data, 'asset_registry').map((asset) => {
    const image = reportAssetPath(root, asset.file, reportFile);
    return `<article class="card" data-id="${escapeHtml(asset.version_id)}"><h3>${escapeHtml(asset.asset_id)} · ${escapeHtml(asset.asset_type)}</h3><p>版本 ${escapeHtml(asset.version_id)} · ${escapeHtml(asset.approval_status)}${asset.parent_asset_version_id ? ` · 父版本 ${escapeHtml(asset.parent_asset_version_id)}` : ''}${asset.view_type ? ` · 视角 ${escapeHtml(asset.view_type)}` : ''}${asset.appearance_period ? ` · 时期 ${escapeHtml(asset.appearance_period)}` : ''}${asset.verification_level ? ` · 媒体验证 ${escapeHtml(asset.verification_level)}` : ''}${asset.stale ? ' · STALE' : ''}</p>${image ? `<img loading="lazy" src="${image}" alt="${escapeHtml(asset.asset_id)}">` : '<div class="placeholder">尚无真实图片文件</div>'}<p>${escapeHtml(asset.file ?? '')}</p><p class="prompt">${escapeHtml(asset.prompt ?? '')}</p>${asset.negative_prompt ? `<p>负面提示词：${escapeHtml(asset.negative_prompt)}</p>` : ''}${reviewButtons()}</article>`;
  }).join('') || '<p class="empty">尚未登记资产。</p>';
  const entityCards = (items, label, describe) => items.map((item) =>
    `<article class="card"><h3>${escapeHtml(item.id)} · ${escapeHtml(item.name)}</h3><p>${escapeHtml(describe(item) || '暂无补充描述')}</p><p>原著出处：${escapeHtml(asArray(item.source_refs).join(', ') || '未记录')}</p>${asArray(item.claims).map((claim) => `<p>${escapeHtml(claim.provenance)} · ${escapeHtml(claim.text)}</p>`).join('')}</article>`,
  ).join('') || `<p class="empty">尚未登记${label}。</p>`;
  const characterCards = entityCards(list(data, 'characters'), '人物', (item) => `${item.identity ?? ''} ${item.identity_anchor ?? ''} · 势力 ${item.faction_id ?? '未知'}`);
  const sceneCards = entityCards(list(data, 'scenes'), '场景', (item) => `${item.era ?? ''} · ${item.location ?? ''} · ${asArray(item.visual_anchors).join('、')}`);
  const propCards = entityCards(list(data, 'props'), '道具', (item) => `${item.material ?? ''} · ${item.function ?? ''}`);
  const shots = list(data, 'storyboard').map((shot) => {
    const image = reportAssetPath(root, shot.image_file, reportFile);
    return `<article class="card" data-id="${escapeHtml(shot.id)}"><h3>${escapeHtml(shot.id)} · ${escapeHtml(shot.screenplay_scene_id)}</h3><p>${escapeHtml(shot.description ?? shot.action ?? '')} · ${escapeHtml(shot.duration_seconds)} 秒 · ${escapeHtml(shot.review_status ?? '待审核')}</p><p>资产版本：${escapeHtml(asArray(shot.asset_version_ids).join(', '))}</p>${image ? `<img loading="lazy" src="${image}" alt="${escapeHtml(shot.id)}">` : '<div class="placeholder">尚无分镜图</div>'}<p class="prompt">${escapeHtml(shot.prompt ?? '')}</p>${reviewButtons()}</article>`;
  }).join('') || '<p class="empty">尚未登记分镜。</p>';
  const screenplay = list(data, 'screenplay').map((scene) =>
    `<article class="card"><h3>${escapeHtml(scene.id)} · ${escapeHtml(scene.chapter_id)}</h3><p>原著事件：${escapeHtml(asArray(scene.event_ids).join(', '))} · 场景：${escapeHtml(scene.scene_id)} · 预计 ${escapeHtml(scene.estimated_duration_seconds ?? '')} 秒</p>${asArray(scene.segments).map((segment) => `<p><b>${escapeHtml(segment.type)}</b> ${escapeHtml(segment.speaker_id ?? '')} · ${escapeHtml(segment.duration_seconds ?? '')} 秒<br>${escapeHtml(segment.text)}</p>`).join('')}</article>`,
  ).join('') || '<p class="empty">尚未登记剧本场次。</p>';
  const videos = list(data, 'production_tasks').map((task) => {
    const video = reportAssetPath(root, task.output_file, reportFile);
    return `<article class="card"><h3>${escapeHtml(task.id)} · ${escapeHtml(task.status)}</h3><p>镜头 ${escapeHtml(task.shot_id ?? '')} · ${escapeHtml(task.model ?? '')} · ${escapeHtml(task.duration_seconds ?? '')} 秒 · 验证 ${escapeHtml(task.verification_level ?? '未记录')}</p><p>${escapeHtml(task.output_file ?? '')}</p>${video ? `<video controls preload="metadata" src="${video}"></video>` : '<div class="placeholder">尚无真实视频输出</div>'}<p>${escapeHtml(task.failure_reason ?? '')}</p></article>`;
  }).join('') || '<p class="empty">尚无视频任务。</p>';
  const audio = list(data, 'audio_timeline').map((track) => {
    const file = reportAssetPath(root, track.file, reportFile);
    return `<article class="card"><h3>${escapeHtml(track.id)} · ${escapeHtml(track.type)}</h3><p>${escapeHtml(track.start_seconds ?? '')} 秒起 · ${escapeHtml(track.duration_seconds ?? '')} 秒 · ${escapeHtml(track.status ?? '')}</p>${file ? `<audio controls preload="metadata" src="${file}"></audio>` : '<div class="placeholder">尚无真实音频文件</div>'}<p>${escapeHtml(track.notes ?? '')}</p></article>`;
  }).join('') || '<p class="empty">尚无音频时间轴。</p>';
  const events = list(data, 'story_events');
  const coverageMap = new Map(list(data, 'story_coverage').map((row) => [row.event_id, row]));
  const coverage = events.map((event) => {
    const row = coverageMap.get(event.id);
    return `<tr><td>${escapeHtml(event.id)}</td><td>${escapeHtml(event.chapter_id ?? '')}</td><td>${escapeHtml(event.summary)}</td><td>${escapeHtml(row?.status ?? 'UNCOVERED')}</td><td>${escapeHtml(asArray(row?.screenplay_scene_ids).join(', '))}</td></tr>`;
  }).join('');
  const issueRows = issues.map((item) => `<tr><td>${escapeHtml(item.rule_id)}</td><td>${escapeHtml(item.file)}</td><td>${escapeHtml(item.object_id ?? '')}</td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.suggestion)}</td></tr>`).join('');
  const approvals = asArray(data.approvals?.approvals).map((entry) => `<li>${escapeHtml(entry.phase_id)} · ${escapeHtml(entry.decision)} · ${escapeHtml(entry.decided_by)} · ${escapeHtml(entry.decided_at)}</li>`).join('') || '<li>暂无确认记录。</li>';
  const qualityReports = asArray(data.quality_reports?.reports).map((report) =>
    `<article class="card"><h3>${escapeHtml(report.scope)} · ${escapeHtml(report.status)}</h3><p>${escapeHtml(report.created_at ?? '')} · ${escapeHtml(report.checked_by ?? '')}</p>${asArray(report.checks).map((check) => `<p>${escapeHtml(check.id)} · ${escapeHtml(check.status)} · ${escapeHtml(check.note ?? '')}</p>`).join('')}${asArray(report.issues).map((entry) => `<p>${escapeHtml(entry.rule_id)} · ${escapeHtml(entry.message)}</p>`).join('')}</article>`,
  ).join('') || '<p class="empty">暂无质量报告。</p>';
  const factionCards = list(data, 'factions').map((faction) => {
    const rules = list(data, 'costume_rules').filter((rule) => rule.faction_id === faction.id);
    return `<article class="card"><h3>${escapeHtml(faction.name)} · ${escapeHtml(faction.id)}</h3><p>等级：${escapeHtml(asArray(faction.class_system).join(' → ') || 'UNKNOWN · 待用户确认')}</p><p>视觉识别：${escapeHtml(faction.visual_identity?.main_color ?? '')} · ${escapeHtml(faction.visual_identity?.pattern ?? '')}</p><table><thead><tr><th>等级/场景</th><th>面料</th><th>工艺</th><th>纹样</th><th>标识</th><th>配饰</th><th>正式度</th><th>华丽度</th><th>来源/例外</th></tr></thead><tbody>${rules.map((rule) => `<tr><td>${escapeHtml(rule.rank)} · ${escapeHtml(rule.costume_context)}</td><td>${escapeHtml(rule.material)} (${escapeHtml(rule.material_grade ?? 'UNKNOWN')})</td><td>${escapeHtml(rule.craftsmanship_grade ?? 'UNKNOWN')}</td><td>${escapeHtml(rule.pattern)}</td><td>${escapeHtml(rule.insignia)} (${escapeHtml(rule.insignia_grade ?? 'UNKNOWN')})</td><td>${escapeHtml(rule.accessories)} (${escapeHtml(rule.accessory_grade ?? 'UNKNOWN')})</td><td>${escapeHtml(rule.garment_formality)}</td><td>${escapeHtml(rule.ornament_score)}</td><td>${escapeHtml(asArray(rule.source_refs).join(', '))} ${escapeHtml(rule.exception_reason ?? '')}</td></tr>`).join('')}</tbody></table></article>`;
  }).join('') || '<p class="empty">尚未登记势力或服饰等级。</p>';
  const stylePanel = `<p>${escapeHtml(data.visual_style.visual_style ?? '')} · ${escapeHtml(data.visual_style.aspect_ratio ?? '')}</p><p>色彩：${escapeHtml(asArray(data.visual_style.color_palette).join('、'))}</p><p>光线：${escapeHtml(asArray(data.visual_style.lighting_rules).join('；'))}</p><p>允许元素：${escapeHtml(asArray(data.visual_style.era_constraints?.allowed_elements).join('、'))}</p><p>禁止元素：${escapeHtml(asArray(data.visual_style.era_constraints?.forbidden_elements).join('、'))}</p>`;
  const payload = JSON.stringify({ project_id: project.project_id, approvals: asArray(data.approvals?.approvals) }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(project.title)} · 制作审核报告</title>
<style>
:root{color-scheme:light;--ink:#202a35;--muted:#667482;--line:#dce3e8;--paper:#f6f7f5;--green:#246b59;--gold:#b78333}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,sans-serif}header{padding:28px 5vw;background:#172b32;color:#fff}header h1{margin:0;font-size:26px}header p{margin:5px 0;color:#d4dfdc}.layout{max-width:1440px;margin:auto;padding:24px;display:grid;grid-template-columns:260px 1fr;gap:24px}nav{position:sticky;top:20px;align-self:start;padding:18px;background:white;border:1px solid var(--line);border-radius:12px}nav a{display:block;color:var(--green);padding:4px 0;text-decoration:none}main section{margin-bottom:24px;padding:22px;background:#fff;border:1px solid var(--line);border-radius:12px}h2{margin-top:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top}.phase-list{list-style:none;padding:0}.phase{display:grid;grid-template-columns:150px 1fr 140px;gap:10px;padding:8px;border-bottom:1px solid var(--line)}.phase strong{color:var(--green)}.phase.stale,.phase.failed,.phase.rejected{color:#a7352c}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:10px;padding:14px;overflow:hidden}.card h3{margin:0 0 6px}.card img,.card video,.card audio{width:100%;max-height:300px;object-fit:contain;background:#edf0ee}.placeholder{height:130px;display:grid;place-items:center;background:#edf0ee;color:var(--muted)}.prompt{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted)}button{margin:3px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer}.active{background:#d9ece6!important;border-color:var(--green)!important}.actions{display:flex;gap:8px;flex-wrap:wrap}.notice{padding:10px;background:#f7f0df;border-radius:8px}.empty{color:var(--muted)}@media(max-width:850px){.layout{grid-template-columns:1fr}nav{position:static}.phase{grid-template-columns:1fr}}@media print{nav,.review-actions,.actions{display:none}.layout{display:block}main section{break-inside:avoid}}
</style></head><body><header><h1>${escapeHtml(project.title)} · 漫剧制作审核</h1><p>当前阶段：${escapeHtml(project.current_phase ?? '全部阶段已完成或尚未开始')} · 原著忠实模式：${project.source_fidelity ? '开启' : '关闭'}</p></header>
<div class="layout"><nav><b>审核导航</b><a href="#progress">阶段进度</a><a href="#art-direction">视觉体系与势力服饰</a><a href="#characters">人物</a><a href="#scenes">场景</a><a href="#props">道具</a><a href="#assets">资产与版本</a><a href="#story">原著事件对账</a><a href="#screenplay">剧本</a><a href="#storyboard">分镜</a><a href="#videos">视频任务</a><a href="#audio">音频时间轴</a><a href="#quality">质检结果</a><a href="#approvals">阶段确认</a><div class="actions"><button id="export-review">导出本地审核选择</button></div></nav><main>
<section id="progress"><h2>阶段进度</h2><p>${phaseRecords.filter((phase) => phase.status === 'APPROVED').length} / ${phaseRecords.length} 阶段已确认</p><ol class="phase-list">${phases}</ol><p class="notice">阶段确认必须由用户明确作出。报告内的图片审核按钮只保存浏览器本地选择，不会更改项目 JSON；请将导出结果交给 Agent 并通过 CLI 记录。</p></section>
<section id="art-direction"><h2>视觉体系与势力服饰等级对照</h2>${stylePanel}<div class="grid">${factionCards}</div></section>
<section id="characters"><h2>人物档案</h2><div class="grid">${characterCards}</div></section>
<section id="scenes"><h2>场景档案</h2><div class="grid">${sceneCards}</div></section>
<section id="props"><h2>道具档案</h2><div class="grid">${propCards}</div></section>
<section id="assets"><h2>资产、版本与审核</h2><div class="grid">${assets}</div></section>
<section id="story"><h2>原著事件覆盖</h2><table><thead><tr><th>事件</th><th>章节</th><th>摘要</th><th>状态</th><th>剧本场次</th></tr></thead><tbody>${coverage || '<tr><td colspan="5">暂无原著事件。</td></tr>'}</tbody></table></section>
<section id="screenplay"><h2>剧本内容</h2><div class="grid">${screenplay}</div></section>
<section id="storyboard"><h2>分镜审核</h2><div class="grid">${shots}</div></section>
<section id="videos"><h2>视频任务与失败记录</h2><div class="grid">${videos}</div></section>
<section id="audio"><h2>独立音频时间轴</h2><div class="grid">${audio}</div></section>
<section id="quality-reports"><h2>质检记录</h2><div class="grid">${qualityReports}</div></section>
<section id="quality"><h2>质量门结果 · ${issues.length ? `${issues.length} 项待处理` : '通过'}</h2><table><thead><tr><th>规则</th><th>文件</th><th>对象</th><th>问题</th><th>建议</th></tr></thead><tbody>${issueRows || '<tr><td colspan="5">当前没有确定性质量门错误。</td></tr>'}</tbody></table></section>
<section id="approvals"><h2>阶段确认记录</h2><ul>${approvals}</ul></section>
</main></div><script>
const reviewState=new Map();document.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',()=>{const card=button.closest('[data-id]');const id=card?.dataset.id;if(!id)return;reviewState.set(id,button.dataset.review);card.querySelectorAll('[data-review]').forEach(item=>item.classList.remove('active'));button.classList.add('active')}));
document.getElementById('export-review').addEventListener('click',()=>{const payload=${payload};payload.asset_decisions=Object.fromEntries(reviewState);const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='review-decisions.json';link.click();URL.revokeObjectURL(link.href)});
</script></body></html>`;
}

function printIssues(issues) {
  if (!issues.length) {
    console.log('质量门通过：没有发现确定性问题。');
    return;
  }
  for (const item of issues) {
    console.log(`[${item.severity}] ${item.rule_id} | ${item.file}${item.object_id ? ` | ${item.object_id}` : ''}`);
    console.log(`  问题：${item.message}`);
    console.log(`  建议：${item.suggestion}`);
  }
}

function usage() {
  console.log(`原著忠实型 AI 漫剧制作总监

命令：
  node scripts/manhua.mjs init <项目名> <项目目录>
  node scripts/manhua.mjs validate <项目目录> [--stage <阶段ID>]
  node scripts/manhua.mjs report <项目目录> [报告路径]
  node scripts/manhua.mjs status <项目目录>
  node scripts/manhua.mjs prompt <项目目录> <任务类型> <parts.json>
  node scripts/manhua.mjs impact <项目目录> <资产版本ID>
  node scripts/manhua.mjs begin <项目目录> <阶段ID>
  node scripts/manhua.mjs submit <项目目录> <阶段ID>
  node scripts/manhua.mjs approve <项目目录> <阶段ID> --by <确认人> [--note <备注>]
  node scripts/manhua.mjs reject <项目目录> <阶段ID> --by <确认人> --note <原因>
  node scripts/manhua.mjs skip <项目目录> <阶段ID> --by <授权人> --note <授权原因>
  node scripts/manhua.mjs refresh-stale <项目目录>`);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1] ?? null;
}

export function main(argv) {
  const [command, ...args] = argv;
  try {
    if (command === 'init') {
      const [title, directory] = args;
      if (!title || !directory) return usage();
      console.log(`已创建项目：${initializeProject(title, directory)}`);
      return;
    }
    if (command === 'validate') {
      const context = loadProject(args[0]);
      const stageIndex = args.indexOf('--stage');
      const stageId = stageIndex >= 0 ? args[stageIndex + 1] : null;
      const issues = validateProject(context, { stage: stageId });
      printIssues(issues);
      if (issues.some((entry) => entry.severity !== 'WARNING')) process.exitCode = 1;
      return;
    }
    if (command === 'report') {
      const context = loadProject(args[0]);
      const output = args[1] ?? 'reports/review.html';
      const file = safePath(context.root, output);
      if (!file) throw new Error('报告路径必须位于项目目录内。');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderReport(context, toPosixPath(output)), 'utf8');
      console.log(`已生成审核报告：${path.relative(context.root, file)}`);
      return;
    }
    if (command === 'status') {
      const context = loadProject(args[0]);
      console.log(`${context.project.title} · 当前阶段：${context.project.current_phase ?? '无'}`);
      for (const phase of context.project.phases) console.log(`${phase.id} | ${phase.status} | ${phase.name}`);
      return;
    }
    if (command === 'prompt') {
      const context = loadProject(args[0]);
      const file = safePath(context.root, args[2]);
      if (!file || !fs.existsSync(file)) throw new Error(`找不到项目内的提示词片段 JSON：${args[2]}`);
      console.log(JSON.stringify(
        buildPromptForProject(context, readJson(file), String(args[1] ?? '').toUpperCase()),
        null,
        2,
      ));
      return;
    }
    if (command === 'impact') {
      const context = loadProject(args[0]);
      console.log(JSON.stringify(affectedAssetVersions(context.data, args[1]), null, 2));
      return;
    }
    if (command === 'begin') {
      const context = loadProject(args[0]);
      beginPhase(context, args[1]);
      console.log(`阶段已进入 IN_PROGRESS：${args[1]}`);
      return;
    }
    if (command === 'submit') {
      const context = loadProject(args[0]);
      const issues = submitPhaseForReview(context, args[1]);
      printIssues(issues);
      if (issues.some((entry) => entry.severity !== 'WARNING')) process.exitCode = 1;
      else console.log('质量门通过，阶段进入 PENDING_REVIEW；等待用户明确确认。');
      return;
    }
    if (command === 'approve' || command === 'reject') {
      const context = loadProject(args[0]);
      const phaseId = args[1];
      const by = option(args, '--by');
      const note = option(args, '--note') ?? '';
      const action = command === 'approve' ? 'APPROVED' : 'REJECTED';
      const entry = recordApproval(context, phaseId, action, by, note);
      console.log(`${action} 已记录：${entry.phase_id} · ${entry.decided_by} · ${entry.decided_at}`);
      return;
    }
    if (command === 'skip') {
      const context = loadProject(args[0]);
      const entry = recordSkip(context, args[1], option(args, '--by'), option(args, '--note'));
      console.log(`SKIPPED 已记录：${entry.phase_id} · ${entry.decided_by} · ${entry.note}`);
      return;
    }
    if (command === 'refresh-stale') {
      const context = loadProject(args[0]);
      const changed = refreshStalePhases(context);
      console.log(changed.length ? `已标记 STALE：${changed.join('、')}` : '没有发现确认后变更的阶段成果。');
      return;
    }
    usage();
  } catch (error) {
    console.error(`错误：${error.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main(process.argv.slice(2));
