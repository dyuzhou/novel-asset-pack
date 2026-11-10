#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import {
  PHASES,
  affectedAssetVersions,
  beginPhase,
  buildImagePrompt,
  buildPromptForProject,
  calculateSpeechDuration,
  estimateSpeechDuration,
  initializeProject,
  loadProject,
  recordApproval,
  recordSkip,
  refreshStalePhases,
  renderReport,
  submitPhaseForReview,
  validateProject,
  validateSchemas,
} from './manhua.mjs';
import { buildPrompt } from './prompt-builder.mjs';
import { writeTestMedia } from './test-media.mjs';

let count = 0;
const test = (name, action) => {
  action();
  count++;
  console.log(`  ✓ ${name}`);
};
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (name, data) => {
  const type = Buffer.from(name);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return chunk;
};
const makePng = (marker = 0, width = 4, height = 4) => {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      raw[offset] = marker;
      raw[offset + 1] = 128;
      raw[offset + 2] = 255 - marker;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'manhua-skill-'));
const root = path.join(temp, 'project');
try {
  console.log('== 项目结构与流程 ==');
  test('初始化创建八阶段、数据骨架与平铺素材目录', () => {
    initializeProject('测试作品', root);
    let context = loadProject(root);
    assert.equal(context.project.phases.length, 8);
    assert.deepEqual(context.project.phases.map((phase) => phase.id), PHASES.map(([id]) => id));
    for (const dir of ['images/角色', 'images/场景', 'images/道具', 'images/分镜', 'images/质检']) {
      assert.ok(fs.statSync(path.join(root, dir)).isDirectory());
    }
  });
  test('初始化拒绝覆盖非空目录', () => {
    assert.throws(() => initializeProject('另一个作品', root), /拒绝覆盖/);
  });
  test('前一阶段未批准时不能开始下一阶段', () => {
    let context = loadProject(root);
    assert.throws(() => beginPhase(context, PHASES[1][0]), /上一阶段/);
  });
  test('跳过阶段必须记录授权人和原因，并可继续后续阶段', () => {
    const skipRoot = path.join(temp, 'skip-project');
    initializeProject('跳过测试', skipRoot);
    const skipContext = loadProject(skipRoot);
    beginPhase(skipContext, PHASES[0][0]);
    const entry = recordSkip(skipContext, PHASES[0][0], '测试用户', '用户明确授权跳过');
    assert.equal(entry.decision, 'SKIPPED');
    assert.equal(skipContext.project.phases[0].skipped_by, '测试用户');
    assert.equal(skipContext.project.current_phase, PHASES[1][0]);
    beginPhase(skipContext, PHASES[1][0]);
    assert.throws(() => recordSkip(skipContext, PHASES[0][0], '测试用户', '重复跳过'), /当前制作阶段/);
    skipContext.project.phases[0].status = 'NOT_STARTED';
    skipContext.project.phases[1].status = 'SKIPPED';
    skipContext.project.phases[1].skipped_by = '测试用户';
    skipContext.project.phases[1].skipped_at = '2025-01-01T00:00:00.000Z';
    skipContext.project.phases[1].skipped_reason = '乱序测试';
    assert.ok(validateProject(skipContext).some((item) => item.rule_id === 'PHASE-APPROVAL-ORDER'));
  });

  let context = loadProject(root);
  context.project.source_scope = '虚构短篇第 1 章';
  const sourceText = '虚构原著示例。\n';
  const sourceFile = path.join(root, 'source/chapter-001.txt');
  fs.writeFileSync(sourceFile, sourceText, 'utf8');
  const sourceFileHash = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
  const evidenceText = '虚构原著示例。';
  const evidenceHash = crypto.createHash('sha256').update(evidenceText).digest('hex');
  context.project.source_files = [{ path: 'source/chapter-001.txt', sha256: sourceFileHash }];
  context.data.source_index.chapters = [{
    id: 'chapter-001', title: '纸灯', source_file: 'source/chapter-001.txt',
    source_file_hash: sourceFileHash, reading_status: 'READ',
  }];
  context.data.source_evidence.evidence = [{
    source_id: 'evidence-001', chapter_id: 'chapter-001', paragraph_id: 'chapter-001:p0001',
    start_offset: 0, end_offset: evidenceText.length, evidence_text: evidenceText,
    evidence_hash: evidenceHash, source_file: 'source/chapter-001.txt', source_file_hash: sourceFileHash,
  }];
  context.data.story_events.events = [{
    id: 'event-001', chapter_id: 'chapter-001', summary: '阿禾在渡口捡到一盏纸灯。',
    source_refs: ['chapter-001'], evidence_refs: ['evidence-001'],
    character_ids: ['character-001'], location_ids: ['location-001'], importance: 'IMPORTANT',
  }];
  context.data.characters.characters = [{
    id: 'character-001', name: '阿禾', faction_id: 'faction-001', source_refs: ['chapter-001'],
    identity_anchor: '面部识别特征待用户确认', identity_anchor_id: 'identity-character-001',
    required_views: ['FRONT', 'SIDE'],
    claims: [{
      text: '阿禾是渡口摆渡人的女儿。', provenance: 'SOURCE_FACT',
      source_refs: ['chapter-001'], evidence_refs: ['evidence-001'],
    }],
  }];
  context.data.factions.factions = [{
    id: 'faction-001', name: '渡口人家', class_system: ['摆渡人家'],
    visual_identity: { main_color: '灰蓝', pattern: '绳结纹' }, source_refs: ['chapter-001'], claims: [],
  }];
  context.data.scenes.scenes = [{
    id: 'location-001', name: '旧渡口', faction_id: 'faction-001', source_refs: ['chapter-001'],
  }];
  context.data.props.props = [{
    id: 'prop-001', name: '纸灯', source_refs: ['chapter-001'], claims: [],
  }];
  context.data.continuity.chapters = [{
    id: 'continuity-001', chapter_id: 'chapter-001', read_status: 'READ', inherited_from_chapter_id: null,
    confirmed_event_ids: ['event-001'],
    character_states: [{
      character_id: 'character-001', appearance_period: '时期未知，待确认',
      costume_variant: '日常服待确认', injuries: [], held_prop_ids: ['prop-001'],
      current_scene_id: 'location-001',
    }],
    unresolved_questions: [{ id: 'question-001', question: '人物年龄待确认', status: 'OPEN' }],
  }];
  context.data.timeline.events = [{
    id: 'timeline-001', story_event_id: 'event-001', order: 1,
  }];
  fs.writeFileSync(context.worldBible, '# 世界观\n\n故事发生在虚构的河湾渡口。\n', 'utf8');

  console.log('== 原著事实与数据质量门 ==');
  test('无错误原著出处的首阶段草稿被阻止', () => {
    context.data.story_events.events[0].source_refs = ['missing-chapter'];
    const found = validateProject(context).map((item) => item.rule_id);
    assert.ok(found.includes('SOURCE-CHAPTER-REF'));
    context.data.story_events.events[0].source_refs = ['chapter-001'];
  });
  test('SOURCE_FACT 缺少原文出处会失败', () => {
    context.data.characters.characters[0].claims[0].evidence_refs = [];
    assert.ok(validateProject(context).some((item) => item.rule_id === 'FACT-EVIDENCE-REQUIRED'));
    context.data.characters.characters[0].claims[0].evidence_refs = ['evidence-001'];
  });
  test('段落证据短摘录、偏移、段落 ID 和文件哈希必须匹配原文', () => {
    const evidence = context.data.source_evidence.evidence[0];
    evidence.start_offset = 1;
    assert.ok(validateProject(context).some((item) => item.rule_id === 'SOURCE-EVIDENCE-INVALID'));
    evidence.start_offset = 0;
    const original = fs.readFileSync(sourceFile);
    fs.writeFileSync(sourceFile, Buffer.concat([original, Buffer.from('后续修订')]));
    const found = validateProject(context).map((item) => item.rule_id);
    assert.ok(found.includes('SOURCE-FILE-CHANGED'));
    assert.ok(found.includes('SOURCE-EVIDENCE-FILE-CHANGED'));
    fs.writeFileSync(sourceFile, original);
  });
  test('未知来源标签会失败', () => {
    context.data.props.props[0].claims = [{ text: '视觉猜测', provenance: 'CANON' }];
    assert.ok(validateProject(context).some((item) => item.rule_id === 'FACT-PROVENANCE'));
    context.data.props.props[0].claims = [];
  });
  test('事件缺少覆盖或标记遗漏时失败', () => {
    context.data.story_coverage.coverage = [{
      id: 'coverage-001', event_id: 'event-001', status: 'OMITTED', reason: '测试',
    }];
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'STORY-EVENT-OMITTED'));
    context.data.story_coverage.coverage = [];
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'STORY-EVENT-UNCOVERED'));
  });
  test('事件、人物和资产 ID 重复会报告规则明细', () => {
    context.data.characters.characters.push({ id: 'event-001', name: '重复 ID' });
    assert.ok(validateProject(context).some((item) => item.rule_id === 'DATA-ID-DUPLICATE'));
    context.data.characters.characters.pop();
  });
  test('对白与旁白时长按内容计算，不依赖固定视频长度', () => {
    assert.equal(calculateSpeechDuration('甲'.repeat(240), 'NARRATION'), 60);
    assert.ok(calculateSpeechDuration('长句。', 'DIALOGUE') > calculateSpeechDuration('短', 'DIALOGUE'));
    assert.ok(calculateSpeechDuration('甲'.repeat(240), 'DIALOGUE', {
      speakers: { 'speaker-fast': { chineseCharactersPerMinute: 360 } }, speaker_id: 'speaker-fast',
    }) < 60);
    const range = estimateSpeechDuration('甲乙。', 'INNER_MONOLOGUE');
    assert.ok(range.duration_min < range.duration_estimated);
    assert.ok(range.duration_estimated < range.duration_max);
  });

  console.log('== 提示词、版本和文件检查 ==');
  const style = {
    visual_style: '水墨动画',
    quality_constraints: ['线条清晰'],
    negative_constraints: ['现代电灯', '错误手指'],
    era_constraints: { allowed_elements: ['纸灯'], forbidden_elements: ['电灯'] },
  };
  test('提示词注入本项目世界观，资产/分镜模式分离', () => {
    const prompt = buildImagePrompt(style, {
      subject: '一盏旧纸灯', details: '竹骨和旧纸', view: '正面近景',
    }, 'PROP_ASSET');
    assert.match(prompt, /全局画风：水墨动画/);
    assert.match(prompt, /一盏旧纸灯/);
    assert.match(prompt, /禁止：电灯/);
    assert.match(prompt, /负面提示词：现代电灯；错误手指/);
    const layered = buildPrompt(style, {
      subject: '阿禾', identity_anchor_id: 'identity-001', identity_anchor: '短发、眼角痣',
      appearance_period: '成年期', costume_variant: '冬装', task_description: '人物立绘',
      references: [{
        role: 'master', asset_type: 'character', version_id: 'character-v1',
        approval_status: 'APPROVED',
      }],
    }, 'CHARACTER_DERIVATIVE');
    assert.match(layered.prompt, /身份锚点：锚点 identity-001；短发、眼角痣/);
    assert.match(layered.prompt, /时期 成年期/);
    assert.equal(layered.prompt_version, 'layered-v1');
    assert.deepEqual(layered.reference_asset_version_ids, ['character-v1']);
    assert.throws(() => buildImagePrompt(style, { subject: '灯', action: '剧情动作' }, 'ASSET'), /资产图禁止带入剧情动作/);
    assert.throws(() => buildPrompt(style, {
      subject: '古代场景', scene_id: 'scene-001', characters: ['人物'],
    }, 'SCENE_MASTER'), /不能自动带入剧情人物/);
  });

  context.data.story_coverage.coverage = [{
    id: 'coverage-001', event_id: 'event-001', status: 'COVERED',
    screenplay_scene_ids: ['screenplay-001'],
  }];
  context.data.screenplay.scenes = [{
    id: 'screenplay-001', chapter_id: 'chapter-001', event_ids: ['event-001'],
    scene_id: 'location-001', character_ids: ['character-001'],
    segments: [{
      id: 'segment-001', type: 'NARRATION', text: '河面飘着雾。',
      duration_seconds: calculateSpeechDuration('河面飘着雾。', 'NARRATION'),
    }],
    estimated_duration_seconds: calculateSpeechDuration('河面飘着雾。', 'NARRATION'),
  }];
  context.data.visual_style = {
    visual_style: '水墨动画', aspect_ratio: '16:9', color_palette: ['月白', '墨青'],
    lighting_rules: ['月光从画面左侧进入'], quality_constraints: ['保持线条稳定'],
    negative_constraints: ['现代物品'],
    era_constraints: { allowed_elements: ['纸灯', '木船'], forbidden_elements: ['电灯', '汽车'] },
  };
  context.data.costume_rules.rules = [{
    id: 'costume-001', faction_id: 'faction-001', rank: '摆渡人家',
    color: '灰蓝', material: '粗布', structure: '窄袖短袄', pattern: '无',
    accessories: '布绳', weapon: '无', insignia: '身份木牌',
    ornament_level: '朴素', ornament_score: 1, rank_order: 1,
    material_grade: 1, craftsmanship_grade: 1, insignia_grade: 1, accessory_grade: 1,
    garment_formality: '日常', costume_context: '日常服', source_refs: ['chapter-001'],
  }];

  console.log('== JSON Schema 合约 ==');
  test('初始化项目、模板数据和示例数据均通过 Draft 2020-12 Schema', () => {
    const initialized = loadProject(root);
    assert.deepEqual(validateSchemas(initialized), []);
    const templateContext = {
      ...initialized,
      project: JSON.parse(fs.readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8')),
      data: {
        ...initialized.data,
        continuity: JSON.parse(fs.readFileSync(new URL('../templates/continuity.json', import.meta.url), 'utf8')),
        screenplay: JSON.parse(fs.readFileSync(new URL('../templates/screenplay.json', import.meta.url), 'utf8')),
        storyboard: JSON.parse(fs.readFileSync(new URL('../templates/storyboard.json', import.meta.url), 'utf8')),
        source_evidence: JSON.parse(fs.readFileSync(new URL('../templates/source-evidence.json', import.meta.url), 'utf8')),
        event_beats: JSON.parse(fs.readFileSync(new URL('../templates/event-beats.json', import.meta.url), 'utf8')),
      },
    };
    assert.deepEqual(validateSchemas(templateContext), []);
    const sampleRoot = new URL('../examples/demo-project/', import.meta.url);
    const sampleProject = JSON.parse(fs.readFileSync(new URL('project.json', sampleRoot), 'utf8'));
    const sampleData = Object.fromEntries(Object.entries(sampleProject.data_files).map(([key, file]) => [
      key, JSON.parse(fs.readFileSync(new URL(file, sampleRoot), 'utf8')),
    ]));
    assert.deepEqual(validateSchemas({ project: sampleProject, data: sampleData }), []);
  });
  test('Schema 校验报告缺少字段、类型错误和无效枚举及 JSON Pointer', () => {
    const invalid = structuredClone(context);
    delete invalid.project.title;
    invalid.data.asset_registry.assets = [{
      id: 'bad', asset_id: 'bad', version_id: 'bad-v1', version: '1',
      asset_type: 'creature', approval_status: 'MAYBE',
    }];
    const errors = validateSchemas(invalid);
    assert.ok(errors.some((item) => item.file === 'project.json' && item.object_id === '/' && item.message.includes('required')));
    assert.ok(errors.some((item) => item.file === 'data/asset_registry.json' && item.object_id === '/assets/0/version'));
    assert.ok(errors.some((item) => item.file === 'data/asset_registry.json' && item.message.includes('must be equal to one of the allowed values')));
  });

  const imageFiles = [
    ['阿 禾 #主参考.png', 1, 'character', 'character-001', 'FRONT'],
    ['location-001-v001.png', 2, 'scene', 'location-001', null],
    ['prop-001-v001.png', 3, 'prop', 'prop-001', null],
  ];
  context.data.asset_registry.assets = imageFiles.map(([name, marker, type, assetId, viewType]) => {
    const directory = type === 'character' ? 'images/角色' : type === 'scene' ? 'images/场景' : 'images/道具';
    fs.writeFileSync(path.join(root, directory, name), makePng(marker));
    const versionId = `${assetId}-v001`;
    return {
      id: versionId, asset_id: assetId, version_id: versionId, version: 1,
      asset_type: type,
      file: type === 'character' ? `${directory}\\${name}` : `${directory}/${name}`,
      character_id: type === 'character' ? assetId : undefined,
      identity_anchor_id: type === 'character' ? 'identity-character-001' : undefined,
      view_type: viewType ?? undefined,
      approval_status: 'APPROVED',
      prompt: `${style.visual_style} 主体 ${assetId}`, negative_prompt: '现代物品',
      prompt_version: 'layered-v1', reference_asset_version_ids: [],
    };
  });
  const media = writeTestMedia(path.join(root, 'test-media'));

  test('初始化的 PNG 需要完整块、CRC 和可解压像素数据', () => {
    assert.ok(validateProject(context).every((item) => item.rule_id !== 'IMAGE-FILE-INVALID'));
    const invalidFile = path.join(root, 'images/角色/invalid.png');
    fs.writeFileSync(invalidFile, Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('IHDR'),
    ]));
    context.data.asset_registry.assets.push({
      id: 'invalid-png', asset_id: 'invalid-png', version_id: 'invalid-png-v001', version: 1,
      asset_type: 'character', file: 'images/角色/invalid.png', approval_status: 'PENDING',
    });
    assert.ok(validateProject(context).some((item) => item.rule_id === 'IMAGE-FILE-INVALID'));
    context.data.asset_registry.assets.pop();
  });
  test('Windows 反斜线、macOS POSIX 路径和中文/空格/特殊字符报告 URL', () => {
    for (const [key, data] of Object.entries(context.data)) {
      fs.writeFileSync(context.files[key], JSON.stringify(data), 'utf8');
    }
    fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify(context.project), 'utf8');
    context = loadProject(root);
    assert.equal(context.data.asset_registry.assets[0].file, 'images/角色/阿 禾 #主参考.png');
    const html = renderReport(context);
    assert.ok(html.includes('../images/%E8%A7%92%E8%89%B2/%E9%98%BF%20%E7%A6%BE%20%23%E4%B8%BB%E5%8F%82%E8%80%83.png'));
    const nested = renderReport(context, 'reports/custom/review.html');
    assert.ok(nested.includes('../../images/%E8%A7%92%E8%89%B2/%E9%98%BF%20%E7%A6%BE%20%23%E4%B8%BB%E5%8F%82%E8%80%83.png'));
    assert.ok(context.data.asset_registry.assets[0].file.includes('/'));
  });
  test('图片路径越界和符号链接越界仍被拒绝', () => {
    const outside = path.join(temp, 'outside.png');
    fs.writeFileSync(outside, makePng(11));
    const linkPath = path.join(root, 'images/角色/external-link.png');
    fs.symlinkSync(outside, linkPath);
    context.data.asset_registry.assets.push(
      { id: 'traversal', asset_id: 'traversal', version_id: 'traversal-v1', version: 1, asset_type: 'character', file: '../../outside.png', approval_status: 'PENDING' },
      { id: 'symlink', asset_id: 'symlink', version_id: 'symlink-v1', version: 1, asset_type: 'character', file: 'images/角色/external-link.png', approval_status: 'PENDING' },
    );
    const rules = validateProject(context).map((item) => item.rule_id);
    assert.ok(rules.filter((id) => id === 'ASSET-FILE-PATH').length >= 2);
    context.data.asset_registry.assets.splice(-2);
    fs.unlinkSync(linkPath);
  });

  console.log('== 八阶段质量门与人工确认 ==');
  test('阶段 01 检查出处并等待人工确认，未确认不能前进', () => {
    beginPhase(context, '01-source-analysis');
    assert.deepEqual(submitPhaseForReview(context, '01-source-analysis'), []);
    assert.equal(context.project.phases[0].status, 'PENDING_REVIEW');
    assert.throws(() => beginPhase(context, '02-art-direction'), /上一阶段/);
    recordApproval(context, '01-source-analysis', 'APPROVED', '测试用户', '确认虚构样例');
    beginPhase(context, '02-art-direction');
    assert.equal(context.project.current_phase, '02-art-direction');
  });
  test('阶段 02 执行世界观、风格与逐势力服饰门', () => {
    const baseRank = context.data.costume_rules.rules[0];
    const originalGrades = {
      material_grade: baseRank.material_grade,
      craftsmanship_grade: baseRank.craftsmanship_grade,
      insignia_grade: baseRank.insignia_grade,
      accessory_grade: baseRank.accessory_grade,
      ornament_score: baseRank.ornament_score,
    };
    Object.assign(baseRank, {
      material_grade: 3, craftsmanship_grade: 3, insignia_grade: 3, accessory_grade: 3,
      ornament_score: 3,
    });
    const highRank = {
      ...baseRank,
      id: 'costume-high', rank: '高阶', rank_order: 2,
      material_grade: 1, craftsmanship_grade: 1, insignia_grade: 1, accessory_grade: 1,
      ornament_score: 1,
    };
    context.data.factions.factions[0].class_system.push('高阶');
    context.data.costume_rules.rules.push(highRank);
    assert.ok(validateProject(context, { stage: '02-art-direction' }).some((item) => item.rule_id === 'STAGE-02-COSTUME-GRADE-ORDER'));
    highRank.exception_reason = '原著明确的特殊服装';
    assert.ok(validateProject(context, { stage: '02-art-direction' }).some((item) => item.rule_id === 'STAGE-02-COSTUME-EXCEPTION'));
    highRank.exception_approved_by = '测试用户';
    assert.ok(!validateProject(context, { stage: '02-art-direction' }).some((item) => item.rule_id === 'STAGE-02-COSTUME-GRADE-ORDER'));
    context.data.costume_rules.rules.pop();
    context.data.factions.factions[0].class_system.pop();
    Object.assign(baseRank, originalGrades);
    assert.deepEqual(submitPhaseForReview(context, '02-art-direction'), []);
    recordApproval(context, '02-art-direction', 'APPROVED', '测试用户', '确认美术体系');
    beginPhase(context, '03-master-assets');
  });
  test('阶段 03 要求真实图像文件和人工通过的主资产', () => {
    assert.deepEqual(submitPhaseForReview(context, '03-master-assets'), []);
    recordApproval(context, '03-master-assets', 'APPROVED', '测试用户', '确认主资产');
    beginPhase(context, '04-derived-assets');
  });
  test('衍生资产必须引用已批准主资产版本', () => {
    const parent = context.data.asset_registry.assets[0];
    const derivedFile = 'images/角色/character-001-v002.png';
    fs.writeFileSync(path.join(root, derivedFile), makePng(5));
    context.data.asset_registry.assets.push({
      id: 'character-001-v002', asset_id: 'character-001', version_id: 'character-001-v002', version: 2,
      asset_type: 'character', file: derivedFile, prompt: '成年期衍生资产', parent_asset_version_id: parent.version_id,
      reference_asset_version_ids: [parent.version_id], variant_type: '成年期',
      source_version: parent.version_id, prompt_version: 'layered-v1', approval_status: 'APPROVED',
      identity_anchor_id: 'identity-character-001', appearance_period: '成年期',
      costume_variant: '成年日常服', transformation_type: 'COSTUME_CHANGE', view_type: 'SIDE',
    });
    const derived = context.data.asset_registry.assets.at(-1);
    derived.transformation_type = 'DISGUISE';
    assert.ok(validateProject(context, { stage: '04-derived-assets' }).some((item) => item.rule_id === 'CHARACTER-IDENTITY-CHANGE-EVIDENCE'));
    derived.transformation_type = 'COSTUME_CHANGE';
    assert.ok(!validateProject(context).some((item) => item.rule_id === 'ASSET-PARENT-UNAPPROVED'));
    assert.ok(!validateProject(context, { stage: '04-derived-assets' }).some((item) => item.rule_id === 'CHARACTER-REQUIRED-VIEW'));
    derived.parent_asset_version_id = 'missing-version';
    assert.ok(validateProject(context).some((item) => item.rule_id === 'ASSET-PARENT-REF'));
    derived.parent_asset_version_id = parent.version_id;
    assert.deepEqual(submitPhaseForReview(context, '04-derived-assets'), []);
    recordApproval(context, '04-derived-assets', 'APPROVED', '测试用户', '确认衍生资产');
    beginPhase(context, '05-screenplay');
  });
  test('阶段 05 要求结构化剧本并逐事件覆盖', () => {
    const requiredBeatTypes = ['CAUSE', 'PROCESS', 'KEY_ACTION', 'REACTION', 'RESULT', 'CONSEQUENCE'];
    const beats = requiredBeatTypes.map((beat_type, index) => ({
      id: `beat-${String(index + 1).padStart(3, '0')}`,
      event_id: 'event-001', beat_type, text: `原著事实单元 ${beat_type}`,
      evidence_refs: ['evidence-001'], screenplay_scene_ids: ['screenplay-001'],
      screenplay_segment_ids: ['segment-001'], shot_ids: [],
    }));
    context.data.event_beats.beats = [];
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'EVENT-BEATS-MISSING'));
    context.data.event_beats.beats = beats.slice(1);
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'EVENT-BEAT-TYPE-MISSING'));
    context.data.event_beats.beats = beats;
    assert.ok(!validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'EVENT-BEAT-SCREENPLAY-COVERAGE'));
    const characterState = context.data.continuity.chapters[0].character_states.pop();
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'STAGE-05-CONTINUITY-CHARACTER'));
    context.data.continuity.chapters[0].character_states.push(characterState);
    const nextSource = 'source/chapter-002.txt';
    const nextSourceText = '第二章。';
    fs.writeFileSync(path.join(root, nextSource), nextSourceText);
    const nextHash = crypto.createHash('sha256').update(nextSourceText).digest('hex');
    context.project.source_files.push({ path: nextSource, sha256: nextHash });
    context.data.source_index.chapters.push({
      id: 'chapter-002', source_file: nextSource, source_file_hash: nextHash, reading_status: 'READ',
    });
    context.data.continuity.chapters.push({
      id: 'continuity-002', chapter_id: 'chapter-002', read_status: 'READ',
      confirmed_event_ids: [], character_states: [characterState], unresolved_questions: [],
    });
    context.data.screenplay.scenes.push({
      id: 'screenplay-002', chapter_id: 'chapter-002', event_ids: ['event-001'],
      character_ids: ['character-001'], segments: [{
        id: 'segment-002', type: 'ACTION', text: '继承前章状态。', duration_seconds: 1,
      }], estimated_duration_seconds: 1,
    });
    assert.ok(validateProject(context, { stage: '05-screenplay' }).some((item) => item.rule_id === 'STAGE-05-CONTINUITY-INHERITANCE'));
    context.data.screenplay.scenes.pop();
    context.data.continuity.chapters.pop();
    context.data.source_index.chapters.pop();
    context.project.source_files.pop();
    fs.unlinkSync(path.join(root, nextSource));
    assert.deepEqual(submitPhaseForReview(context, '05-screenplay'), []);
    recordApproval(context, '05-screenplay', 'APPROVED', '测试用户', '确认剧本');
    beginPhase(context, '06-storyboard');
  });
  test('图片预检要求批准参考资产、继承身份锚点并拼装势力服饰等级', () => {
    const prompt = buildPromptForProject(context, {
      character_id: 'character-001',
      reference_asset_version_ids: ['character-001-v001'],
      faction_rank: '摆渡人家',
      costume_context: '日常服',
      appearance_period: '成年期',
      costume_variant: '成年日常服',
    }, 'CHARACTER_DERIVATIVE');
    assert.equal(prompt.identity_anchor_id, 'identity-character-001');
    assert.equal(prompt.reference_asset_version_ids[0], 'character-001-v001');
    assert.match(prompt.prompt, /身份锚点/);
    assert.match(prompt.prompt, /面料等级 1/);
    assert.throws(() => buildPromptForProject(context, {
      character_id: 'character-001', reference_asset_version_ids: ['missing-v1'],
      faction_rank: '摆渡人家', costume_context: '日常服',
    }, 'CHARACTER_DERIVATIVE'), /参考资产版本不存在/);
    assert.throws(() => buildPromptForProject(context, {
      character_id: 'character-001', reference_asset_version_ids: ['character-001-v001'],
      faction_rank: '摆渡人家', costume_context: '日常服', costume_variant: '成年日常服',
    }, 'CHARACTER_DERIVATIVE'), /当前时期未明确/);
    assert.throws(() => buildPromptForProject(context, {
      character_id: 'character-001', reference_asset_version_ids: ['character-001-v001'],
      faction_rank: '摆渡人家', costume_context: '日常服',
      appearance_period: '成年期', costume_variant: '幻化形态',
      transformation_type: 'TRANSFORMATION', identity_change_allowed: true,
    }, 'CHARACTER_DERIVATIVE'), /特殊身份变化缺少明确授权或有效原文证据/);
  });
  test('分镜引用剧本和资产，并要求真实图像与人工审核', () => {
    context.data.storyboard.shots = context.data.event_beats.beats.map((beat, index) => {
      const id = `shot-${String(index + 1).padStart(3, '0')}`;
      const image_file = `images/分镜/${id}-v001.png`;
      fs.writeFileSync(path.join(root, image_file), makePng(index + 4, 16, 9));
      beat.shot_ids = [id];
      return {
        id, screenplay_scene_id: 'screenplay-001', event_id: beat.event_id,
        scene_id: 'location-001', character_ids: ['character-001'], prop_ids: ['prop-001'],
        asset_version_ids: [context.data.asset_registry.assets[0].version_id],
        duration_seconds: 3.5, image_file, review_status: 'APPROVED',
      };
    });
    assert.deepEqual(submitPhaseForReview(context, '06-storyboard'), []);
    recordApproval(context, '06-storyboard', 'APPROVED', '测试用户', '确认分镜图');
    beginPhase(context, '07-video');
  });
  test('视频任务必须成功且真实输出文件存在', () => {
    const output = media.video;
    context.data.production_tasks.tasks = [{
      id: 'video-001', kind: 'VIDEO', shot_id: 'shot-001', status: 'COMPLETED',
      model: 'test-model', prompt: '无声视频', output_file: output, duration_seconds: 1, background_music: false,
      resolution: '1280x720', aspect_ratio: '16:9',
      reference_asset_version_ids: ['character-001-v001'],
      verification_level: 'FFPROBE',
    }];
    const task = context.data.production_tasks.tasks[0];
    task.output_file = media.fakeVideo;
    assert.ok(validateProject(context).some((item) => item.rule_id === 'MEDIA-FILE-INVALID'));
    task.output_file = media.video;
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = '';
      task.verification_level = 'BASIC';
      const basicIssues = validateProject(context);
      assert.ok(basicIssues.some((item) => item.rule_id === 'MEDIA-BASIC-VERIFICATION'));
      assert.ok(!basicIssues.some((item) => item.rule_id === 'MEDIA-FILE-INVALID' || item.rule_id === 'MEDIA-STREAM-MISSING'));
    } finally {
      process.env.PATH = originalPath;
      task.verification_level = 'FFPROBE';
    }
    assert.deepEqual(submitPhaseForReview(context, '07-video'), []);
    recordApproval(context, '07-video', 'APPROVED', '测试用户', '确认视频');
    beginPhase(context, '08-audio-qc');
    const finalOutput = media.finalVideo;
    context.data.production_tasks.tasks.push({
      id: 'final-render-001', kind: 'FINAL_RENDER', status: 'COMPLETED', output_file: finalOutput,
      verification_level: 'FFPROBE',
    });
  });
  test('阶段 08 要求独立音频时间轴和最终质检', () => {
    const audio = media.audio;
    context.data.audio_timeline.tracks = [{
      id: 'track-001', type: 'NARRATION', start_seconds: 0, duration_seconds: 0.25,
      file: audio, screenplay_scene_id: 'screenplay-001', status: 'COMPLETED',
      verification_level: 'FFPROBE',
    }];
    context.data.audio_timeline.tracks.push({
      id: 'track-002', type: 'SFX', status: 'NOT_APPLICABLE', reason: '本场无独立特效音。',
    });
    context.data.quality_reports.reports.push({
      id: 'final-qc', scope: 'FINAL', status: 'APPROVED', checked_by: '测试用户',
      checks: [
        { id: 'story-coverage', status: 'PASS' },
        { id: 'unexpected_bgm', status: 'PASS' },
        { id: 'stream_separation', status: 'PASS' },
        { id: 'voice_consistency', status: 'PASS' },
        { id: 'lip_sync', status: 'NOT_APPLICABLE', reason: '本段没有人物对白。' },
        { id: 'environment_sound_repetition', status: 'PASS' },
        { id: 'final_audio_integrity', status: 'PASS' },
      ],
    });
    const fakeTrack = { ...context.data.audio_timeline.tracks[0], id: 'fake-track', file: media.fakeAudio };
    context.data.audio_timeline.tracks.push(fakeTrack);
    assert.ok(validateProject(context).some((item) => item.rule_id === 'MEDIA-FILE-INVALID'));
    context.data.audio_timeline.tracks.pop();
    assert.deepEqual(submitPhaseForReview(context, '08-audio-qc'), []);
    recordApproval(context, '08-audio-qc', 'APPROVED', '测试用户', '确认终检');
    assert.equal(context.project.current_phase, null);
    assert.equal(context.project.phases[7].status, 'APPROVED');
  });
  test('主资产变更会追踪衍生资产、分镜和视频任务', () => {
    const rootAsset = context.data.asset_registry.assets[0].version_id;
    const impact = affectedAssetVersions(context.data, rootAsset);
    assert.ok(impact.asset_version_ids.includes('character-001-v002'));
    assert.ok(impact.shot_ids.includes('shot-001'));
    assert.ok(impact.task_ids.includes('video-001'));
  });
  test('审批快照变化被报告并只标记受影响阶段及后续为 STALE', () => {
    context.data.story_coverage.coverage[0].note = '确认后变更';
    fs.writeFileSync(context.files.story_coverage, JSON.stringify(context.data.story_coverage), 'utf8');
    assert.ok(validateProject(context).some((item) => item.rule_id === 'PHASE-APPROVAL-STALE'));
    const changed = refreshStalePhases(context);
    assert.deepEqual(changed, ['05-screenplay']);
    assert.equal(context.project.current_phase, '05-screenplay');
  });

  console.log('== 静态审核报告 ==');
  test('报告展示审批、事件对账、资产、分镜、质量门且安全转义', () => {
    context.project.title = '<script>alert(1)</script>';
    const html = renderReport(context);
    assert.match(html, /阶段进度/);
    assert.match(html, /原著事件覆盖/);
    assert.match(html, /资产、版本与审核/);
    assert.match(html, /分镜审核/);
    assert.match(html, /阶段确认记录/);
    assert.ok(!html.includes('<h1><script>alert(1)</script>'));
    assert.ok(html.includes('导出本地审核选择'));
  });
  test('HTML 中的数据脚本不会被 </script> 注入', () => {
    context.data.story_events.events[0].summary = '</script><script>alert(1)</script>';
    const html = renderReport(context);
    assert.ok(!html.includes('</script><script>alert(1)</script>'));
  });

  console.log(`\nselftest passed：${count} 项断言`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
