#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  story_events: 'data/story_events.json',
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
  story_events: 'events',
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
  '01-source-analysis': ['source_index', 'story_events', 'characters', 'factions', 'scenes', 'props', 'timeline'],
  '02-art-direction': ['visual_style', 'costume_rules'],
  '03-master-assets': ['asset_registry'],
  '04-derived-assets': ['asset_registry'],
  '05-screenplay': ['screenplay', 'story_coverage'],
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

const isNonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const asArray = (value) => Array.isArray(value) ? value : [];
const now = () => new Date().toISOString();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function safePath(root, relativePath) {
  if (!isNonEmpty(relativePath) || path.isAbsolute(relativePath)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
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
    story_events: { events: [] },
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
  return { root, project, data, files, worldBible };
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

function isImageFile(file) {
  if (file.length < 12) return false;
  return (
    (file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file[0] === 0xff && file[1] === 0xd8 && file[file.length - 2] === 0xff && file[file.length - 1] === 0xd9) ||
    (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP')
  );
}

function imageDimensions(file) {
  if (file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && file.length >= 24) {
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
  }
  if (file[0] === 0xff && file[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < file.length) {
      if (file[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (file[offset] === 0xff) offset++;
      const marker = file[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > file.length) break;
      const length = file.readUInt16BE(offset);
      if (length < 2 || offset + length > file.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: file.readUInt16BE(offset + 3), width: file.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
  }
  if (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP') {
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
      const id = item?.id;
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
  }
  for (const rule of list(data, 'costume_rules')) {
    if (!factions.has(rule.faction_id)) {
      issues.push(issue('COSTUME-FACTION-REF', fileFor('costume_rules'), rule.id, `服饰规则引用的势力不存在：${rule.faction_id ?? '缺失'}。`, '引用 factions.json 中的稳定势力 ID。'));
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
  for (const scene of list(data, 'screenplay')) {
    if (scene.chapter_id && !chapters.has(scene.chapter_id)) {
      issues.push(issue('SCREENPLAY-CHAPTER-REF', fileFor('screenplay'), scene.id, `原著章节不存在：${scene.chapter_id}。`, '修正章节引用。'));
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
    if (task.status !== 'COMPLETED' || !isNonEmpty(task.output_file)) continue;
    const file = safePath(root, task.output_file);
    if (!file || !fs.existsSync(file)) {
      issues.push(issue('TASK-OUTPUT-FILE', DATA_FILES.production_tasks, task.id, `已完成任务的实际输出文件不存在或路径无效：${task.output_file}。`, '检查真实输出位置；不要只凭任务启动状态标记成功。'));
    } else if (fs.statSync(file).size === 0) {
      issues.push(issue('TASK-OUTPUT-EMPTY', DATA_FILES.production_tasks, task.id, `已完成任务的输出文件为空：${task.output_file}。`, '检查真实媒体文件并确认可读取后再标记完成。'));
    }
  }
  for (const track of list(data, 'audio_timeline')) {
    if (!isNonEmpty(track.file)) continue;
    const file = safePath(root, track.file);
    if (!file || !fs.existsSync(file)) {
      issues.push(issue('AUDIO-FILE-MISSING', DATA_FILES.audio_timeline, track.id, `登记的音频文件不存在或路径无效：${track.file}。`, '只记录已落盘的音频产物。'));
    } else if (fs.statSync(file).size === 0) {
      issues.push(issue('AUDIO-FILE-EMPTY', DATA_FILES.audio_timeline, track.id, `登记的音频文件为空：${track.file}。`, '检查真实音频文件并确认可读取。'));
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
  const files = new Set([...asArray(context.project.source_files)]);
  for (const chapter of list(context.data, 'source_index')) {
    if (isNonEmpty(chapter.source_file)) files.add(chapter.source_file);
  }
  for (const relativePath of files) {
    const file = safePath(context.root, relativePath);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      issues.push(issue('SOURCE-FILE-MISSING', 'project.json', relativePath, `原著来源文件不存在或路径无效：${relativePath}。`, '将原著文件放入项目目录或修正相对路径；不能伪造已读来源。'));
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
  const chineseRate = rates.chineseCharactersPerMinute ?? 240;
  const englishRate = rates.englishWordsPerMinute ?? 150;
  if (!(chineseRate > 0) || !(englishRate > 0)) throw new Error('语速必须大于 0。');
  const chineseChars = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const englishWords = (content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const pauseSeconds = (content.match(/[，。！？；：,.!?;:]/g) ?? []).length * 0.12;
  const chineseSeconds = chineseChars ? chineseChars * 60 / chineseRate : 0;
  const englishSeconds = englishWords ? englishWords * 60 / englishRate : 0;
  const seconds = chineseSeconds + englishSeconds + pauseSeconds;
  return Math.round(seconds * 10) / 10;
}

export function estimateSegmentDuration(segment, rates) {
  if (Number.isFinite(segment?.duration_seconds)) return segment.duration_seconds;
  if (['DIALOGUE', 'NARRATION', 'INNER_MONOLOGUE'].includes(segment?.type)) {
    return calculateSpeechDuration(segment.text, segment.type, rates);
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
          add('STAGE-02-RANKS', DATA_FILES.factions, faction.id, '势力没有原著依据的等级体系。', '提取原著中出现的等级；原文没有等级时明确记录 UNKNOWN 并由用户确认。');
        } else if (ranks.length !== factionRules.length || ranks.some((rank) => !factionRules.some((rule) => rule.rank === rank))) {
          add('STAGE-02-RANK-COVERAGE', DATA_FILES.costume_rules, faction.id, '服饰等级规则未覆盖该势力的全部等级。', '每个原著等级分别设计服装规则，不得合并层级。');
        }
        if (!factionRules.length) {
          add('STAGE-02-COSTUME-FACTION', DATA_FILES.costume_rules, faction.id, '势力缺少服饰等级规则。', '逐等级定义颜色、面料、结构、纹样、配饰、武器或身份标识和华丽度。');
        }
        for (const rule of factionRules) {
          for (const field of ['rank', 'color', 'material', 'structure', 'pattern', 'accessories', 'weapon', 'insignia', 'ornament_level']) {
            if (!isNonEmpty(rule[field])) add('STAGE-02-COSTUME-FIELDS', DATA_FILES.costume_rules, rule.id, `服饰等级规则缺少 ${field}。`, '补齐可执行的等级视觉差异；未知内容标记为推断或待确认。');
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
          if (sortedRules[index].ornament_score < sortedRules[index - 1].ornament_score) {
            add('STAGE-02-ORNAMENT-ORDER', DATA_FILES.costume_rules, sortedRules[index].id, '低等级服饰华丽度高于前一级。', '使华丽度随等级上升或保持一致，特殊例外需原著依据并人工确认。');
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
      }
      break;
    }
    case '05-screenplay': {
      issues.push(...checkCoverage(data));
      if (!list(data, 'screenplay').length) add('STAGE-05-SCREENPLAY', DATA_FILES.screenplay, null, '剧本没有场次。', '按原著事件写场次，结构化区分对白、旁白、内心独白、动作和环境。');
      for (const scene of list(data, 'screenplay')) {
        if (!asArray(scene.event_ids).length) add('STAGE-05-SCENE-EVENTS', DATA_FILES.screenplay, scene.id, '剧本场次没有绑定原著事件。', '将每场戏映射到一条或多条原著事件。');
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
        if (track.status !== 'COMPLETED' || !isNonEmpty(track.file)) {
          add('STAGE-08-AUDIO-FILE', DATA_FILES.audio_timeline, track.id, '音频时间轴条目尚无已完成的真实音频文件。', '确认实际文件和时间轴同步后再提交终检。');
        }
        if (!Number.isFinite(track.start_seconds) || track.start_seconds < 0 ||
            !Number.isFinite(track.duration_seconds) || track.duration_seconds <= 0) {
          add('STAGE-08-AUDIO-TIMING', DATA_FILES.audio_timeline, track.id, '音频轨道缺少有效时间范围。', '提供非负起始时间和正的实际时长。');
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
    addMediaDigest(asArray(context.project.source_files).map((file) => ({ file })));
  }
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function validateProject(context, options = {}) {
  const { root, project, data } = context;
  const issues = [
    ...checkProjectStructure(project),
    ...checkApprovals(project, data),
    ...checkCollectionIds(data),
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
  if (!['ASSET', 'STORYBOARD'].includes(mode)) throw new Error('图片提示词模式必须是 ASSET 或 STORYBOARD。');
  const core = [
    style?.visual_style,
    parts?.subject,
    parts?.details,
    parts?.view,
    mode === 'STORYBOARD' ? parts?.atmosphere : '',
    ...(asArray(style?.quality_constraints)),
    `世界观约束：${asArray(style?.era_constraints?.allowed_elements).join('、')}`,
    `禁止元素：${asArray(style?.era_constraints?.forbidden_elements).join('、')}`,
  ].filter(isNonEmpty);
  if (mode === 'STORYBOARD' && isNonEmpty(parts?.action)) core.splice(2, 0, parts.action);
  if (mode === 'ASSET' && parts?.action) throw new Error('ASSET 模式禁止混入剧情动作；剧情内容请使用 STORYBOARD 模式。');
  return core.join('；');
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
  context.data.quality_reports.reports.push({
    id: `gate-${phaseId}-${Date.now()}`,
    scope: phaseId,
    status: issues.length ? 'FAILED' : 'PENDING_REVIEW',
    created_at: now(),
    issues,
  });
  phase.status = issues.length ? 'FAILED' : 'PENDING_REVIEW';
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
  const changed = [];
  let staleSeen = false;
  for (const phase of context.project.phases) {
    if (phase.status === 'APPROVED' && phase.snapshot_sha256 &&
        phaseSnapshot(context, phase.id) !== phase.snapshot_sha256) {
      staleSeen = true;
      phase.status = 'STALE';
      changed.push(phase.id);
    } else if (staleSeen && ['APPROVED', 'PENDING_REVIEW', 'IN_PROGRESS'].includes(phase.status)) {
      phase.status = 'STALE';
      changed.push(phase.id);
    }
  }
  if (changed.length) {
    context.project.current_phase = changed[0];
    saveContext(context);
  }
  return changed;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reportAssetPath(root, file) {
  const resolved = safePath(root, file);
  if (!resolved || !fs.existsSync(resolved)) return null;
  return `../${String(file).split(path.sep).join('/')}`.split('/').map((part, index) => index ? encodeURIComponent(part) : part).join('/');
}

export function renderReport(context) {
  const { project, data, root } = context;
  const issues = validateProject(context);
  const phaseRecords = asArray(project.phases);
  const phases = phaseRecords.map((phase) => `<li class="phase ${escapeHtml(String(phase.status ?? 'unknown').toLowerCase())}"><b>${escapeHtml(phase.id)}</b><span>${escapeHtml(phase.name)}</span><strong>${escapeHtml(phase.status)}</strong></li>`).join('');
  const reviewButtons = () => `<div class="review-actions">${['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'REGENERATE'].map((status) => `<button data-review="${status}">${status}</button>`).join('')}</div>`;
  const assets = list(data, 'asset_registry').map((asset) => {
    const image = reportAssetPath(root, asset.file);
    return `<article class="card" data-id="${escapeHtml(asset.version_id)}"><h3>${escapeHtml(asset.asset_id)} · ${escapeHtml(asset.asset_type)}</h3><p>版本 ${escapeHtml(asset.version_id)} · ${escapeHtml(asset.approval_status)}${asset.parent_asset_version_id ? ` · 父版本 ${escapeHtml(asset.parent_asset_version_id)}` : ''}${asset.stale ? ' · STALE' : ''}</p>${image ? `<img loading="lazy" src="${image}" alt="${escapeHtml(asset.asset_id)}">` : '<div class="placeholder">尚无真实图片文件</div>'}<p>${escapeHtml(asset.file ?? '')}</p><p class="prompt">${escapeHtml(asset.prompt ?? '')}</p>${reviewButtons()}</article>`;
  }).join('') || '<p class="empty">尚未登记资产。</p>';
  const entityCards = (items, label, describe) => items.map((item) =>
    `<article class="card"><h3>${escapeHtml(item.id)} · ${escapeHtml(item.name)}</h3><p>${escapeHtml(describe(item) || '暂无补充描述')}</p><p>原著出处：${escapeHtml(asArray(item.source_refs).join(', ') || '未记录')}</p>${asArray(item.claims).map((claim) => `<p>${escapeHtml(claim.provenance)} · ${escapeHtml(claim.text)}</p>`).join('')}</article>`,
  ).join('') || `<p class="empty">尚未登记${label}。</p>`;
  const characterCards = entityCards(list(data, 'characters'), '人物', (item) => `${item.identity ?? ''} ${item.identity_anchor ?? ''} · 势力 ${item.faction_id ?? '未知'}`);
  const sceneCards = entityCards(list(data, 'scenes'), '场景', (item) => `${item.era ?? ''} · ${item.location ?? ''} · ${asArray(item.visual_anchors).join('、')}`);
  const propCards = entityCards(list(data, 'props'), '道具', (item) => `${item.material ?? ''} · ${item.function ?? ''}`);
  const shots = list(data, 'storyboard').map((shot) => {
    const image = reportAssetPath(root, shot.image_file);
    return `<article class="card" data-id="${escapeHtml(shot.id)}"><h3>${escapeHtml(shot.id)} · ${escapeHtml(shot.screenplay_scene_id)}</h3><p>${escapeHtml(shot.description ?? shot.action ?? '')} · ${escapeHtml(shot.duration_seconds)} 秒 · ${escapeHtml(shot.review_status ?? '待审核')}</p><p>资产版本：${escapeHtml(asArray(shot.asset_version_ids).join(', '))}</p>${image ? `<img loading="lazy" src="${image}" alt="${escapeHtml(shot.id)}">` : '<div class="placeholder">尚无分镜图</div>'}<p class="prompt">${escapeHtml(shot.prompt ?? '')}</p>${reviewButtons()}</article>`;
  }).join('') || '<p class="empty">尚未登记分镜。</p>';
  const screenplay = list(data, 'screenplay').map((scene) =>
    `<article class="card"><h3>${escapeHtml(scene.id)} · ${escapeHtml(scene.chapter_id)}</h3><p>原著事件：${escapeHtml(asArray(scene.event_ids).join(', '))} · 场景：${escapeHtml(scene.scene_id)} · 预计 ${escapeHtml(scene.estimated_duration_seconds ?? '')} 秒</p>${asArray(scene.segments).map((segment) => `<p><b>${escapeHtml(segment.type)}</b> ${escapeHtml(segment.speaker_id ?? '')} · ${escapeHtml(segment.duration_seconds ?? '')} 秒<br>${escapeHtml(segment.text)}</p>`).join('')}</article>`,
  ).join('') || '<p class="empty">尚未登记剧本场次。</p>';
  const videos = list(data, 'production_tasks').map((task) => {
    const video = reportAssetPath(root, task.output_file);
    return `<article class="card"><h3>${escapeHtml(task.id)} · ${escapeHtml(task.status)}</h3><p>镜头 ${escapeHtml(task.shot_id ?? '')} · ${escapeHtml(task.model ?? '')} · ${escapeHtml(task.duration_seconds ?? '')} 秒</p><p>${escapeHtml(task.output_file ?? '')}</p>${video ? `<video controls preload="metadata" src="${video}"></video>` : '<div class="placeholder">尚无真实视频输出</div>'}<p>${escapeHtml(task.failure_reason ?? '')}</p></article>`;
  }).join('') || '<p class="empty">尚无视频任务。</p>';
  const audio = list(data, 'audio_timeline').map((track) => {
    const file = reportAssetPath(root, track.file);
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
    return `<article class="card"><h3>${escapeHtml(faction.name)} · ${escapeHtml(faction.id)}</h3><p>等级：${escapeHtml(asArray(faction.class_system).join(' → '))}</p><p>视觉识别：${escapeHtml(faction.visual_identity?.main_color ?? '')} · ${escapeHtml(faction.visual_identity?.pattern ?? '')}</p>${rules.map((rule) => `<p>${escapeHtml(rule.rank)} · ${escapeHtml(rule.color)} · ${escapeHtml(rule.material)} · ${escapeHtml(rule.structure)} · ${escapeHtml(rule.pattern)} · ${escapeHtml(rule.accessories)} · 华丽度 ${escapeHtml(rule.ornament_score)}</p>`).join('')}</article>`;
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
<section id="art-direction"><h2>视觉体系与势力服饰</h2>${stylePanel}<div class="grid">${factionCards}</div></section>
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
  node scripts/manhua.mjs prompt <项目目录> <ASSET|STORYBOARD> <parts.json>
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
      if (issues.length) process.exitCode = 1;
      return;
    }
    if (command === 'report') {
      const context = loadProject(args[0]);
      const output = args[1] ?? 'reports/review.html';
      const file = safePath(context.root, output);
      if (!file) throw new Error('报告路径必须位于项目目录内。');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderReport(context), 'utf8');
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
      console.log(buildImagePrompt(context.data.visual_style, readJson(file), String(args[1] ?? '').toUpperCase()));
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
      if (issues.length) process.exitCode = 1;
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
