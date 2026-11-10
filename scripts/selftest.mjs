#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PHASES,
  affectedAssetVersions,
  beginPhase,
  buildImagePrompt,
  calculateSpeechDuration,
  initializeProject,
  loadProject,
  recordApproval,
  recordSkip,
  refreshStalePhases,
  renderReport,
  submitPhaseForReview,
  validateProject,
} from './manhua.mjs';

let count = 0;
const test = (name, action) => {
  action();
  count++;
  console.log(`  ✓ ${name}`);
};
const makePng = (marker = 0, width = 4, height = 4) => {
  const file = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(file);
  file.write('IHDR', 12, 'ascii');
  file.writeUInt32BE(width, 16);
  file.writeUInt32BE(height, 20);
  file[24] = marker;
  return file;
};

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'manhua-skill-'));
const root = path.join(temp, 'project');
try {
  console.log('== 项目结构与流程 ==');
  test('初始化创建八阶段、数据骨架与平铺素材目录', () => {
    initializeProject('测试作品', root);
    const context = loadProject(root);
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
    const context = loadProject(root);
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

  const context = loadProject(root);
  context.project.source_scope = '虚构短篇第 1 章';
  fs.writeFileSync(path.join(root, 'source/chapter-001.txt'), '虚构原著示例。\n', 'utf8');
  context.data.source_index.chapters = [{
    id: 'chapter-001', title: '纸灯', source_file: 'source/chapter-001.txt', reading_status: 'READ',
  }];
  context.data.story_events.events = [{
    id: 'event-001', chapter_id: 'chapter-001', summary: '阿禾在渡口捡到一盏纸灯。',
    source_refs: ['chapter-001'], character_ids: ['character-001'], location_ids: ['location-001'],
  }];
  context.data.characters.characters = [{
    id: 'character-001', name: '阿禾', faction_id: 'faction-001', source_refs: ['chapter-001'],
    claims: [{ text: '阿禾是渡口摆渡人的女儿。', provenance: 'SOURCE_FACT', source_refs: ['chapter-001'] }],
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
    context.data.characters.characters[0].claims[0].source_refs = [];
    assert.ok(validateProject(context).some((item) => item.rule_id === 'FACT-SOURCE-CITATION'));
    context.data.characters.characters[0].claims[0].source_refs = ['chapter-001'];
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
  });

  console.log('== 提示词、版本和文件检查 ==');
  const style = {
    visual_style: '水墨动画',
    quality_constraints: ['线条清晰'],
    era_constraints: { allowed_elements: ['纸灯'], forbidden_elements: ['电灯'] },
  };
  test('提示词注入本项目世界观，资产/分镜模式分离', () => {
    const prompt = buildImagePrompt(style, {
      subject: '一盏旧纸灯', details: '竹骨和旧纸', view: '正面近景',
      atmosphere: '柔和月光', action: '渡口人物正在奔跑',
    }, 'STORYBOARD');
    assert.match(prompt, /水墨动画.*一盏旧纸灯/);
    assert.match(prompt, /渡口人物正在奔跑/);
    assert.match(prompt, /禁止元素：电灯/);
    assert.throws(() => buildImagePrompt(style, { subject: '灯', action: '剧情动作' }, 'ASSET'), /禁止混入剧情动作/);
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
    era_constraints: { allowed_elements: ['纸灯', '木船'], forbidden_elements: ['电灯', '汽车'] },
  };
  context.data.costume_rules.rules = [{
    id: 'costume-001', faction_id: 'faction-001', rank: '摆渡人家',
    color: '灰蓝', material: '粗布', structure: '窄袖短袄', pattern: '无',
    accessories: '布绳', weapon: '无', insignia: '身份木牌',
    ornament_level: '朴素', ornament_score: 1, rank_order: 1,
  }];

  const imageFiles = [
    ['character-001-v001.png', 1, 'character', 'character-001'],
    ['location-001-v001.png', 2, 'scene', 'location-001'],
    ['prop-001-v001.png', 3, 'prop', 'prop-001'],
  ];
  context.data.asset_registry.assets = imageFiles.map(([name, marker, type, assetId]) => {
    const directory = type === 'character' ? 'images/角色' : type === 'scene' ? 'images/场景' : 'images/道具';
    fs.writeFileSync(path.join(root, directory, name), makePng(marker));
    const versionId = `${assetId}-v001`;
    return {
      id: versionId, asset_id: assetId, version_id: versionId, version: 1,
      asset_type: type, file: `${directory}/${name}`, approval_status: 'APPROVED',
      prompt: `${style.visual_style} 主体 ${assetId}`, prompt_version: 'prompt-v1',
    };
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
      source_version: parent.version_id, prompt_version: 'prompt-v1', approval_status: 'APPROVED',
    });
    assert.ok(!validateProject(context).some((item) => item.rule_id === 'ASSET-PARENT-UNAPPROVED'));
    const derived = context.data.asset_registry.assets.at(-1);
    derived.parent_asset_version_id = 'missing-version';
    assert.ok(validateProject(context).some((item) => item.rule_id === 'ASSET-PARENT-REF'));
    derived.parent_asset_version_id = parent.version_id;
    assert.deepEqual(submitPhaseForReview(context, '04-derived-assets'), []);
    recordApproval(context, '04-derived-assets', 'APPROVED', '测试用户', '确认衍生资产');
    beginPhase(context, '05-screenplay');
  });
  test('阶段 05 要求结构化剧本并逐事件覆盖', () => {
    assert.deepEqual(submitPhaseForReview(context, '05-screenplay'), []);
    recordApproval(context, '05-screenplay', 'APPROVED', '测试用户', '确认剧本');
    beginPhase(context, '06-storyboard');
  });
  test('分镜引用剧本和资产，并要求真实图像与人工审核', () => {
    const shotFile = 'images/分镜/shot-001-v001.png';
    fs.writeFileSync(path.join(root, shotFile), makePng(4, 16, 9));
    context.data.storyboard.shots = [{
      id: 'shot-001', screenplay_scene_id: 'screenplay-001', event_id: 'event-001',
      scene_id: 'location-001', character_ids: ['character-001'], prop_ids: ['prop-001'],
      asset_version_ids: [context.data.asset_registry.assets[0].version_id],
      duration_seconds: 3.5, image_file: shotFile, review_status: 'APPROVED',
    }];
    assert.deepEqual(submitPhaseForReview(context, '06-storyboard'), []);
    recordApproval(context, '06-storyboard', 'APPROVED', '测试用户', '确认分镜图');
    beginPhase(context, '07-video');
  });
  test('视频任务必须成功且真实输出文件存在', () => {
    const output = 'videos/shot-001.mp4';
    fs.writeFileSync(path.join(root, output), Buffer.from('fake video output'));
    context.data.production_tasks.tasks = [{
      id: 'video-001', kind: 'VIDEO', shot_id: 'shot-001', status: 'COMPLETED',
      model: 'test-model', prompt: '无声视频', output_file: output, duration_seconds: 5, background_music: false,
      resolution: '1280x720', aspect_ratio: '16:9',
      reference_asset_version_ids: ['character-001-v001'],
    }];
    assert.deepEqual(submitPhaseForReview(context, '07-video'), []);
    recordApproval(context, '07-video', 'APPROVED', '测试用户', '确认视频');
    beginPhase(context, '08-audio-qc');
    const finalOutput = 'videos/final.mp4';
    fs.writeFileSync(path.join(root, finalOutput), Buffer.from('final video'));
    context.data.production_tasks.tasks.push({
      id: 'final-render-001', kind: 'FINAL_RENDER', status: 'COMPLETED', output_file: finalOutput,
    });
  });
  test('阶段 08 要求独立音频时间轴和最终质检', () => {
    const audio = 'audio/narration.wav';
    fs.writeFileSync(path.join(root, audio), Buffer.from('test audio'));
    context.data.audio_timeline.tracks = [{
      id: 'track-001', type: 'NARRATION', start_seconds: 0, duration_seconds: 2,
      file: audio, screenplay_scene_id: 'screenplay-001', status: 'COMPLETED',
    }];
    context.data.quality_reports.reports.push({
      id: 'final-qc', scope: 'FINAL', status: 'APPROVED', checked_by: '测试用户',
      checks: [{ id: 'story-coverage', status: 'PASS' }],
    });
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
    assert.deepEqual(changed, ['05-screenplay', '06-storyboard', '07-video', '08-audio-qc']);
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
