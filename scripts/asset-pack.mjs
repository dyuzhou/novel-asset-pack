#!/usr/bin/env node
/**
 * novel-asset-pack —— 把小说/原著文本整理成 AI 漫剧资产包
 *
 * 职责：世界观 / 势力 / 角色（含多时期）/ 场景 / 道具 / 提示词库 的确定性工程。
 * 原则（与 shuohao-skills 同源）：
 *   - 零依赖，Node >= 18，只用标准库
 *   - 事实搬运交给 seed，理解与归纳交给模型，结构校验交给质量门（纯代码）
 *   - 风格锚点 / 质量词 / 负面词 / 图生图前缀全部由本脚本注入，模型只写 prompt_body 五段
 *   - 生成服务不由脚本直接调用；报告读取项目目录中的图像与音频产物
 *
 * CLI:
 *   node asset-pack.mjs init [剧名]
 *   node asset-pack.mjs seed <outline.json> [剧名]
 *   node asset-pack.mjs validate <assets.json>
 *   node asset-pack.mjs checkup <assets.json>
 *   node asset-pack.mjs render  <assets.json> --html|--md
 */

import fs from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ============================ 常量 ============================ */

const MODE_FRESH = 'fresh_generation'; // 首图 / 原著明确描写的幻化变形
const MODE_I2I = 'reference_img2img'; // 以参考图生图（衍生时期默认）

const STATUSES = new Set(['pending', 'in_progress', 'done']);
const PIPELINE_STEPS = [
  ['config', '项目配置与风格锚点'],
  ['fulltext', '阅读全文：世界观与势力统计'],
  ['inventory', '资产整理：角色、种族、场景与时期'],
  ['script_storyboard', '剧情事件、对白提取与分镜设计'],
  ['art_plan', '美工规划：势力阶级与种族设计'],
  ['art_review', '美工图检验：世界观与时代一致性'],
  ['asset_images', '资产图生成：角色、场景与道具'],
  ['asset_review', '资产图检验：一致性与质量'],
  ['audio', '分轨音频制作与配音'],
  ['shot_images', '批量镜头图：复用资产并控制成本'],
  ['postproduction', '连续性剪辑与统一混音'],
  ['quality_check', '剧情、画面与音频质量检查'],
  ['validate', '最终质量门校验'],
  ['report', 'HTML 报告输出'],
];

const VIDEO_TRACKS = ['V1', 'V2', 'V3'];
const AUDIO_TRACKS = ['A1', 'A2', 'A3', 'A4', 'A5'];
const GENERIC_SHOT_COPY = ['关键事件推进', '人物反应', '动作展开', '氛围细节', '人物入场'];
const SHOT_TYPES = new Set(['全景', '中景', '近景', '特写']);
const NARRATION_TYPES = new Set(['narrator', 'inner_monologue']);
const QUALITY_DOMAINS = ['story', 'visual', 'audio'];

const CAMERA_WORDS = [
  '中景', '近景', '远景', '全景', '特写', '平视', '俯视', '仰视',
  '鸟瞰', '侧视', '过肩', '跟拍', '推镜', '低角', '高角',
];

// 这些词属于"注入段"：风格锚点、质量词、负面词、图生图前缀都由脚本拼接，
// prompt_body 里出现即为重复，校验打回。
const QUALITY_BLACKLIST = ['8K', '8k', '超清', '超高细节', '稳定构图', '无畸形'];
const INJECT_BLACKLIST = ['以参考图', '负面'];

export const DEFAULT_QUALITY = '8K 超清，超高细节，稳定构图，无畸形肢体';
export const DEFAULT_NEGATIVE = '畸形、多指、模糊、水印、画风突变、比例失调、Q 版、卡通渲染、过度美颜';

const WORLD_FIELDS = [
  ['background', '世界背景'],
  ['power_system', '修炼/社会体系'],
  ['social_structure', '社会结构'],
  ['architecture', '建筑风格'],
  ['costume_rules', '服饰规则'],
  ['color_system', '色彩体系'],
];

/* ============================ 小工具 ============================ */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const segSplit = (s) => String(s ?? '').split(/[；;]/).map((x) => x.trim()).filter(Boolean);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 从风格锚点提取"指纹词"：拉丁词（≥2 字符）与中文分句（≥3 字）。 */
export function styleTokens(anchor) {
  const a = String(anchor ?? '');
  const toks = new Set();
  for (const m of a.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) if (m.length >= 2) toks.add(m);
  for (const seg of a.split(/[，,；;。、\s]+/)) {
    const s = seg.trim();
    if (s.length >= 3) toks.add(s);
  }
  return [...toks];
}

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 图片路径 → 相对 json 的 URL；文件存在才返回，否则 null（报告里渲染占位框）。 */
function resolveImage(jsonDir, rel) {
  if (!nonEmpty(rel)) return null;
  const parts = String(rel).split(/[\\/]/).filter((part) => part && part !== '.');
  if (parts[0] === 'images') parts.shift();
  if (parts.includes('..')) return null;
  const abs = path.join(jsonDir, 'images', ...parts);
  if (!fs.existsSync(abs)) return null;
  return 'images/' + parts.map(encodeURIComponent).join('/');
}

/* ============================ 提示词拼装 ============================ */

/**
 * 最终提示词 = [图生图前缀] + 风格锚点 + prompt_body(五段) + 质量词 + 统一负面词
 * 模型只负责 prompt_body；其余全部由这里注入，保证"风格锚点出现在每条提示词里"是结构保证而非口头约定。
 */
export function assemblePrompt(anchor, body, quality, negative, opts = {}) {
  const parts = [];
  if (opts.img2img) {
    parts.push(`以参考图为基础，保持面部特征与体型不变，仅调整：${opts.reason ?? ''}`);
  }
  parts.push(anchor, body, quality);
  const head = parts.filter(nonEmpty).map((s) => s.trim().replace(/[；;]+$/, '')).join('；');
  return `${head}；负面提示词：${negative ?? ''}`;
}

/* ============================ 质量门 ============================ */

/**
 * prompt_body 五段检查：视角；主体；背景；细节；光影。
 * 返回 gate 数组（每条含 id/label/ok/detail）。
 */
function promptGates(label, body, styleToks) {
  const gates = [];
  const add = (id, ok, detail = '') =>
    gates.push({ id, label: `${label} · ${id === 'E1' ? '五段结构' : id === 'E2' ? '首段视角词' : '禁注入词'}`, ok: !!ok, detail });

  if (!nonEmpty(body)) {
    add('E1', false, 'prompt_body 为空');
    return gates;
  }
  const segs = segSplit(body);
  add('E1', segs.length >= 5, `需按“视角；主体；背景；细节；光影”至少 5 段，当前 ${segs.length} 段`);

  const first = segs[0] ?? '';
  add('E2', CAMERA_WORDS.some((w) => first.includes(w)), `首段需含镜头视角词（中景/全景/特写/平视…），当前首段：“${first.slice(0, 20)}”`);

  const hits = [];
  for (const t of styleToks) if (body.includes(t)) hits.push(t);
  for (const q of QUALITY_BLACKLIST) if (body.includes(q)) hits.push(q);
  for (const n of INJECT_BLACKLIST) if (body.includes(n)) hits.push(n);
  add('E3', hits.length === 0, hits.length ? `风格/质量/负面/图生图前缀由脚本注入，prompt_body 里出现重复词：${[...new Set(hits)].join('、')}` : '');

  return gates;
}

function missingFields(obj, pairs) {
  return pairs.filter(([k]) => !nonEmpty(obj?.[k])).map(([, label]) => label);
}

/** 全部质量门。每门 = {id,label,ok,detail}；validate 取 !ok 的，checkup 全量打印。 */
export function gateList(doc) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok: !!ok, detail });
  const d = doc ?? {};
  const proj = d.project ?? {};
  const styleToks = styleTokens(proj.style_anchor);

  /* ---- P 组：项目配置 ---- */
  const anchor = String(proj.style_anchor ?? '').trim();
  add('P1', '风格锚点 ≥16 字', anchor.length >= 16, anchor ? `当前 ${anchor.length} 字` : '未填写');
  add('P2', '画幅比例格式（如 16:9）', /^\d{1,2}:\d{1,2}$/.test(String(proj.aspect_ratio ?? '').trim()), `当前值：“${proj.aspect_ratio ?? ''}”`);
  add('P3', '质量词与统一负面提示词非空', nonEmpty(proj.quality_common) && nonEmpty(proj.negative_common),
    [!nonEmpty(proj.quality_common) ? 'quality_common 为空' : '', !nonEmpty(proj.negative_common) ? 'negative_common 为空' : ''].filter(Boolean).join('；'));
  add('P4', '忠实原著（本 skill 不做改编）', proj.faithful !== false, 'faithful=false 说明要走改编流程，请改用 shuohao novel-outline');

  /* ---- W 组：世界观 ---- */
  const w = d.world ?? {};
  const wMissing = WORLD_FIELDS.filter(([k]) => !nonEmpty(w[k])).map(([, label]) => label);
  add('W1', '世界观六项完整（背景/体系/社会/建筑/服饰/色彩）', wMissing.length === 0, wMissing.length ? `缺：${wMissing.join('、')}` : '');

  /* ---- G 组：结构 ---- */
  const ids = [];
  for (const key of ['factions', 'characters', 'scenes', 'props']) {
    for (const it of Array.isArray(d[key]) ? d[key] : []) {
      if (nonEmpty(it?.id)) ids.push(it.id);
    }
  }
  const dup = ids.find((x, i) => ids.indexOf(x) !== i);
  add('G1', '资产 id 无重复', !dup, dup ? `重复 id：${dup}` : '');

  const steps = Array.isArray(d.pipeline?.steps) ? d.pipeline.steps : [];
  const badStep = steps.find((s) => !isObj(s) || !nonEmpty(s.id) || !nonEmpty(s.label) || !STATUSES.has(s.status));
  let flowError = '';
  if (steps.length !== PIPELINE_STEPS.length || steps.some((s, i) => s?.id !== PIPELINE_STEPS[i]?.[0] || s?.label !== PIPELINE_STEPS[i]?.[1])) {
    flowError = '步骤必须完整且按 SKILL.md 的 12 步固定顺序';
  } else {
    const firstOpen = steps.findIndex((s) => s.status !== 'done');
    const doneAfterOpen = firstOpen >= 0 && steps.slice(firstOpen + 1).some((s) => s.status === 'done');
    const active = steps.map((s, i) => s.status === 'in_progress' ? i : -1).filter((i) => i >= 0);
    if (doneAfterOpen) flowError = '前置步骤未完成，不能将后续步骤标记为完成';
    else if (active.length > 1 || (active.length === 1 && active[0] !== firstOpen)) flowError = '只能将当前第一个未完成步骤标记为进行中';
  }
  add('G2', 'pipeline 固定 12 步且不可跳关', steps.length > 0 && !badStep && !flowError,
    steps.length === 0 ? 'pipeline.steps 为空' : badStep ? `非法步骤：${badStep.id ?? '(无 id)'}` : flowError);

  const completed = (id) => steps.find((s) => s.id === id)?.status === 'done';
  const artPlans = Array.isArray(d.art_plans) ? d.art_plans : [];
  const imageReviews = Array.isArray(d.image_reviews) ? d.image_reviews : [];
  const audioAssets = Array.isArray(d.audio_assets) ? d.audio_assets : [];
  const production = d.production ?? {};
  const shots = Array.isArray(production.shots) ? production.shots : [];
  const generatedImages = [
    ...(Array.isArray(d.races) ? d.races : []),
    ...(Array.isArray(d.factions) ? d.factions : []),
    ...(Array.isArray(d.characters) ? d.characters : []).flatMap((c) => c.periods ?? []),
    ...(Array.isArray(d.scenes) ? d.scenes : []),
    ...(Array.isArray(d.props) ? d.props : []),
  ];
  const missingImages = generatedImages.filter((it) => !nonEmpty(it?.image));
  const imagePaths = generatedImages.map((it) => it.image).filter(nonEmpty);
  const imageReviewPaths = new Set(imageReviews.filter((r) => r.status === 'approved').map((r) => r.image));
  const checks = [
    ['fulltext', 'source_analysis.scope + chapters_read + statistics',
      nonEmpty(d.source_analysis?.scope) && Number(d.source_analysis?.chapters_read) > 0 && isObj(d.source_analysis?.statistics) && Object.keys(d.source_analysis.statistics).length > 0],
    ['script_storyboard', 'production.story_events、dialogues、narration 与完整分镜',
      productionDeliverablesComplete(production)],
    ['art_plan', '至少一份 art_plans 设计方案', artPlans.length > 0],
    ['art_review', '所有美工方案均通过世界观/时代/语言检查', artPlans.length > 0 && artPlans.every((p) => p.review?.status === 'approved' && p.review?.worldview === true && p.review?.anachronism === true && p.review?.language === true)],
    ['asset_images', '所有种族/势力/角色时期/场景/道具均有 image 路径', generatedImages.length > 0 && missingImages.length === 0],
    ['asset_review', '所有资产图均有 approved image_reviews 记录', imagePaths.length > 0 && imagePaths.every((image) => imageReviewPaths.has(image))],
    ['audio', '分轨计划、角色固定音色与音频文件完整', audioPlanComplete(production, audioAssets)],
    ['shot_images', '每个 production.shots 项均有 image', shots.length > 0 && shots.every((it) => nonEmpty(it.image))],
    ['postproduction', '时间轴、单次混音及最终成片输出已记录', postproductionComplete(production)],
    ['quality_check', '剧情、画面、音频检查均通过且有记录', qualityChecksComplete(production)],
  ];
  for (const [stepId, requirement, ok] of checks) {
    if (completed(stepId)) add('G3', `步骤「${stepId}」交付物完整`, ok, ok ? '' : `缺少：${requirement}`);
  }
  if (completed('report')) {
    const reportStep = steps.find((s) => s.id === 'report');
    add('G3', 'HTML 报告完成步骤需记录输出路径', nonEmpty(reportStep?.note), '请在 note 填写报告文件路径');
  }

  /* ---- F 组：势力 ---- */
  const factions = Array.isArray(d.factions) ? d.factions : [];
  for (const f of factions) {
    const label = `势力「${f?.name ?? f?.id ?? '?'}」`;
    const miss = missingFields(f, [['positioning', '定位'], ['costume_rule', '服饰规则'], ['main_color', '主色'], ['pattern', '纹样']]);
    const cs = f?.class_system;
    if (!(Array.isArray(cs) ? cs.filter(nonEmpty).length >= 1 : nonEmpty(cs))) miss.push('阶级体系');
    add('F1', `${label} 必填字段`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
    gates.push(...promptGates(label, f?.prompt_body, styleToks));
  }
  let f2fail = '';
  for (let i = 0; i < factions.length && !f2fail; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i], b = factions[j];
      if (a?.main_color === b?.main_color && a?.pattern === b?.pattern) {
        f2fail = `「${a.name}」与「${b.name}」主色与纹样完全相同，跨势力服饰无法区分`;
        break;
      }
    }
  }
  add('F2', '势力间服饰可区分（主色+纹样不全同）', !f2fail, f2fail);

  /* ---- C 组：角色 ---- */
  const factionIds = new Set(factions.map((f) => f?.id).filter(nonEmpty));
  const chars = Array.isArray(d.characters) ? d.characters : [];
  for (const c of chars) {
    const label = `角色「${c?.name ?? c?.id ?? '?'}」`;
    const miss = missingFields(c, [['gender', '性别'], ['age', '年龄'], ['identity', '身份'], ['class', '阶级'], ['identity_anchor', '固定主体锚点'], ['personality', '性格']]);
    if (!nonEmpty(c?.faction_id)) miss.push('faction_id（散修/无势力也请写明归属）');
    add('C1', `${label} 必填字段`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
    if (nonEmpty(c?.faction_id) && !factionIds.has(c.faction_id)) {
      add('F3', `${label} 势力引用存在`, false, `faction_id "${c.faction_id}" 在 factions 中不存在`);
    }

    const ia = String(c?.identity_anchor ?? '').trim();
    add('C2', `${label} 固定主体锚点 ≥8 字`, ia.length >= 8, ia ? `当前 ${ia.length} 字` : '未填写');

    const periods = Array.isArray(c?.periods) ? c.periods : [];
    const baseCount = periods.filter((p) => p?.is_base).length;
    add('C3', `${label} 恰好一个基准时期（is_base）`, periods.length >= 1 && baseCount === 1,
      periods.length === 0 ? 'periods 为空' : baseCount === 0 ? '未标记 is_base 基准期' : baseCount > 1 ? `${baseCount} 个 is_base，只允许一个` : '');

    periods.forEach((p, i) => {
      const pl = `角色「${c?.name ?? '?'}」·时期「${p?.period_name ?? i + 1}」`;
      const pmiss = missingFields(p, [['period_name', '时期名'], ['appearance', '外貌'], ['costume', '服饰']]);
      add('C4', `${pl} 必填字段`, pmiss.length === 0, pmiss.length ? `缺：${pmiss.join('、')}` : '');

      const mode = p?.generation_mode ?? (p?.is_base ? MODE_FRESH : MODE_I2I);
      if (p?.is_base) {
        add('C5', `${pl} 基准期应为 fresh_generation`, mode === MODE_FRESH, `基准期是全角色参考图的源头，generation_mode 应为 ${MODE_FRESH}`);
      } else if (mode === MODE_I2I) {
        add('C5', `${pl} 图生图需参考图与变化依据`,
          nonEmpty(p?.reference_image) && nonEmpty(p?.variation_reason),
          [!nonEmpty(p?.reference_image) ? '缺 reference_image（指向基准期或任一已生成时期图）' : '', !nonEmpty(p?.variation_reason) ? '缺 variation_reason' : ''].filter(Boolean).join('；'));
      } else if (mode === MODE_FRESH) {
        add('C5', `${pl} 非基准期重开新图仅限原著明确描写`,
          p?.source_described === true && nonEmpty(p?.variation_reason),
          !p?.source_described
            ? '衍生时期默认 reference_img2img；仅当原著明确描写幻化/易容/变形等情节才可 fresh_generation，并置 source_described=true'
            : 'source_described=true 但缺 variation_reason');
      } else {
        add('C5', `${pl} generation_mode 非法`, false, `只能是 ${MODE_FRESH} / ${MODE_I2I}，当前 "${mode}"`);
      }

      gates.push(...promptGates(pl, p?.prompt_body, styleToks));

      // 固定特征必须延续：断臂、刀疤这类原著硬特征，每个时期的 prompt_body 都要带着
      if (nonEmpty(c?.fixed_features)) {
        const phrases = c.fixed_features.split(/[,，、；;。]/).map((s) => s.trim()).filter((s) => s.length >= 2);
        const gone = phrases.filter((ph) => !String(p?.prompt_body ?? '').includes(ph));
        add('C6', `${pl} 固定特征延续`, gone.length === 0, gone.length ? `原著特征 ${gone.map((x) => `“${x}”`).join('、')} 未写进该时期 prompt_body 主体段（原著幻化消除的除外，需在 variation_reason 说明）` : '');
      }
    });
  }

  /* ---- S 组：场景 ---- */
  const scenes = Array.isArray(d.scenes) ? d.scenes : [];
  for (const s of scenes) {
    const label = `场景「${s?.name ?? s?.id ?? '?'}」`;
    const miss = missingFields(s, [['era', '时代'], ['location', '地点'], ['atmosphere', '氛围'], ['lighting', '光照']]);
    if (!Array.isArray(s?.key_elements) || s.key_elements.filter(nonEmpty).length < 2) miss.push('key_elements（≥2 个关键元素）');
    add('S1', `${label} 必填字段`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
    gates.push(...promptGates(label, s?.prompt_body, styleToks));
  }

  /* ---- R 组：道具 ---- */
  const props = Array.isArray(d.props) ? d.props : [];
  for (const p of props) {
    const label = `道具「${p?.name ?? p?.id ?? '?'}」`;
    const miss = missingFields(p, [['owner', '归属'], ['material', '材质'], ['usage', '用途']]);
    add('R1', `${label} 必填字段`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
    gates.push(...promptGates(label, p?.prompt_body, styleToks));
  }

  gates.push(...productionGates(d));

  return gates;
}

function productionDeliverablesComplete(production) {
  const events = production.story_events;
  const dialogues = production.dialogues;
  const narration = production.narration;
  const shots = production.shots;
  return Array.isArray(production.scripts) && production.scripts.length > 0
    && Array.isArray(events) && events.length > 0
    && Array.isArray(dialogues) && Array.isArray(narration)
    && Array.isArray(shots) && shots.length > 0;
}

function audioPlanComplete(production, audioAssets) {
  const plan = production.audio_plan;
  return isObj(plan)
    && Array.isArray(plan.voice_profiles)
    && Array.isArray(plan.tracks) && plan.tracks.length > 0
    && plan.exclude_video_bgm === true
    && isObj(plan.mix) && plan.mix.dialogue_ducking === true
    && audioAssets.length > 0 && audioAssets.every((it) => nonEmpty(it.file));
}

function postproductionComplete(production) {
  const timeline = production.timeline;
  return isObj(timeline)
    && VIDEO_TRACKS.every((track) => timeline.video_tracks?.includes(track))
    && AUDIO_TRACKS.every((track) => timeline.audio_tracks?.includes(track))
    && timeline.final_mix_count === 1
    && timeline.exclude_video_bgm === true
    && nonEmpty(timeline.final_video_file);
}

function qualityChecksComplete(production) {
  const checks = production.quality_checks;
  return isObj(checks) && QUALITY_DOMAINS.every((domain) =>
    Array.isArray(checks[domain]) && checks[domain].length > 0
      && checks[domain].every((item) => item?.status === 'passed' && nonEmpty(item?.scope_ref) && nonEmpty(item?.notes)));
}

function productionGates(doc) {
  const production = doc.production ?? {};
  const events = Array.isArray(production.story_events) ? production.story_events : [];
  const dialogues = Array.isArray(production.dialogues) ? production.dialogues : [];
  const narration = Array.isArray(production.narration) ? production.narration : [];
  const shots = Array.isArray(production.shots) ? production.shots : [];
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok: !!ok, detail });
  const required = (obj, fields) => fields.filter((field) => !nonEmpty(obj?.[field]));
  const uniqueIds = new Set();
  const registerId = (id, label) => {
    const valid = nonEmpty(id) && !uniqueIds.has(id);
    if (valid) uniqueIds.add(id);
    add('PR1', `${label} id 唯一`, valid, !nonEmpty(id) ? '缺少 id' : uniqueIds.has(id) && !valid ? `重复 id：${id}` : '');
  };

  for (const event of events) {
    const label = `剧情事件「${event?.event_id ?? '?'}」`;
    registerId(event?.event_id, label);
    const miss = required(event, ['source_chapter', 'source_text_position', 'source_quote', 'location_ref', 'cause', 'progression', 'result', 'importance']);
    if (!Array.isArray(event?.participants) || event.participants.length === 0) miss.push('participants');
    if (!Array.isArray(event?.prop_refs)) miss.push('prop_refs（无道具时填空数组）');
    add('PR2', `${label} 原文依据与事件结构`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
  }
  for (const dialogue of dialogues) {
    const label = `对白「${dialogue?.dialogue_id ?? '?'}」`;
    registerId(dialogue?.dialogue_id, label);
    const miss = required(dialogue, ['speaker_ref', 'original_text', 'emotion', 'delivery_style', 'target_listener', 'source_chapter', 'source_text_position']);
    add('PR3', `${label} 说话人、表演与出处`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
  }
  for (const item of narration) {
    const label = `叙述文本「${item?.narration_id ?? '?'}」`;
    registerId(item?.narration_id, label);
    const miss = required(item, ['original_text', 'source_chapter', 'source_text_position']);
    if (!NARRATION_TYPES.has(item?.type)) miss.push('type（narrator / inner_monologue）');
    if (item?.type === 'inner_monologue' && !nonEmpty(item?.speaker_ref)) miss.push('inner_monologue 的 speaker_ref');
    add('PR4', `${label} 类型区分与原文出处`, miss.length === 0, miss.length ? `缺：${miss.join('、')}` : '');
  }

  const sceneIds = new Set((doc.scenes ?? []).map((scene) => scene?.id).filter(nonEmpty));
  const characterIds = new Set((doc.characters ?? []).map((character) => character?.id).filter(nonEmpty));
  const propIds = new Set((doc.props ?? []).map((prop) => prop?.id).filter(nonEmpty));
  const eventIds = new Set(events.map((event) => event?.event_id).filter(nonEmpty));
  const dialogueIds = new Set(dialogues.map((dialogue) => dialogue?.dialogue_id).filter(nonEmpty));
  const narrationIds = new Set(narration.map((item) => item?.narration_id).filter(nonEmpty));
  const genericCopy = (value) => GENERIC_SHOT_COPY.find((phrase) => String(value ?? '').includes(phrase));

  for (const shot of shots) {
    const label = `镜头「${shot?.shot_id ?? shot?.id ?? '?'}」`;
    const id = shot?.shot_id ?? shot?.id;
    registerId(id, label);
    const miss = required(shot, [
      'scene_ref', 'beat_id', 'camera', 'camera_movement', 'action', 'character_action',
      'expression', 'emotion', 'shot_purpose', 'transition', 'continuity', 'visual_anchor',
    ]);
    if (!SHOT_TYPES.has(shot?.shot_type)) miss.push('shot_type（全景/中景/近景/特写）');
    if (!Number.isFinite(shot?.duration_s) || shot.duration_s <= 0) miss.push('duration_s（正数）');
    if (!Array.isArray(shot?.char_refs) || !Array.isArray(shot?.prop_refs)
      || !Array.isArray(shot?.dialogue_refs) || !Array.isArray(shot?.narration_refs)
      || !Array.isArray(shot?.event_refs) || !Array.isArray(shot?.sound_cues)) {
      miss.push('char_refs/prop_refs/dialogue_refs/narration_refs/event_refs/sound_cues 数组');
    }
    const continuityFields = ['character_positions', 'prop_positions', 'eyelines', 'action_handoff', 'lighting_time'];
    const continuityMissing = continuityFields.filter((field) => !nonEmpty(shot?.continuity?.[field]));
    if (continuityMissing.length) miss.push(`continuity.${continuityMissing.join('/')}`);
    if (shot?.generation_duration_s != null && (!Number.isFinite(shot.generation_duration_s) || shot.generation_duration_s <= 0)) {
      miss.push('generation_duration_s（正数素材时长）');
    }
    const dialogueRefs = Array.isArray(shot?.dialogue_refs) ? shot.dialogue_refs : [];
    if (dialogueRefs.length && !isObj(shot?.lip_sync)) miss.push('lip_sync（对白镜头须记录状态）');
    if (shot?.lip_sync?.status === 'unavailable' && !nonEmpty(shot.lip_sync.notes)) miss.push('lip_sync.notes（能力不可用原因）');
    if (shot?.lip_sync?.status && !['not_required', 'pending', 'synced', 'unavailable'].includes(shot.lip_sync.status)) miss.push('lip_sync.status 非法');
    if (genericCopy(shot?.action) || genericCopy(shot?.character_action) || genericCopy(shot?.shot_purpose)) {
      miss.push(`具体化通用描述「${genericCopy(shot?.action) || genericCopy(shot?.character_action) || genericCopy(shot?.shot_purpose)}」`);
    }
    add('PR5', `${label} 叙事动作、机位及时长完整`, miss.length === 0, miss.length ? `缺或无效：${miss.join('、')}` : '');

    const refs = [
      ...(Array.isArray(shot?.char_refs) ? shot.char_refs.map((ref) => [ref, characterIds, '角色']) : []),
      ...(Array.isArray(shot?.prop_refs) ? shot.prop_refs.map((ref) => [ref, propIds, '道具']) : []),
      ...(Array.isArray(shot?.event_refs) ? shot.event_refs.map((ref) => [ref, eventIds, '事件']) : []),
      ...dialogueRefs.map((ref) => [ref, dialogueIds, '对白']),
      ...(Array.isArray(shot?.narration_refs) ? shot.narration_refs.map((ref) => [ref, narrationIds, '旁白/独白']) : []),
    ];
    const brokenRefs = refs.filter(([ref, ids]) => !ids.has(ref));
    add('PR6', `${label} 事件与资产引用有效`, eventIds.size > 0 && Array.isArray(shot?.event_refs) && shot.event_refs.length > 0
      && sceneIds.has(shot?.scene_ref) && brokenRefs.length === 0,
    eventIds.size === 0 ? '尚无剧情事件' : brokenRefs.length ? `无效引用：${brokenRefs.map(([ref, , type]) => `${type} ${ref}`).join('、')}` : '镜头必须引用有效场景和至少一个剧情事件');
  }

  const shotsById = new Map(shots.map((shot) => [shot?.shot_id ?? shot?.id, shot]));
  for (const [index, shot] of shots.entries()) {
    const id = shot?.shot_id ?? shot?.id;
    const expectedPrevious = index > 0 ? shots[index - 1]?.shot_id ?? shots[index - 1]?.id : null;
    const expectedNext = index < shots.length - 1 ? shots[index + 1]?.shot_id ?? shots[index + 1]?.id : null;
    const linksOk = (shot?.previous_shot ?? null) === expectedPrevious && (shot?.next_shot ?? null) === expectedNext
      && (!shot?.previous_shot || shotsById.has(shot.previous_shot))
      && (!shot?.next_shot || shotsById.has(shot.next_shot));
    add('PR7', `镜头「${id ?? '?'}」前后衔接引用`, linksOk,
      'previous_shot / next_shot 应指向分镜顺序中的相邻镜头，首尾使用 null');
  }

  const plan = production.audio_plan;
  if (isObj(plan)) {
    const profiles = Array.isArray(plan.voice_profiles) ? plan.voice_profiles : [];
    const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
    const voiceIds = new Set();
    for (const profile of profiles) {
      const label = `角色音色「${profile?.character_ref ?? '?'}」`;
      const miss = required(profile, ['character_ref', 'voice_id', 'voice_description', 'emotion']);
      if (!Number.isFinite(profile?.speaking_rate) || profile.speaking_rate <= 0) miss.push('speaking_rate');
      if (!Number.isFinite(profile?.pitch)) miss.push('pitch');
      if (!isObj(profile?.pronunciation_settings)) miss.push('pronunciation_settings');
      if (!characterIds.has(profile?.character_ref)) miss.push('character_ref 不存在');
      if (voiceIds.has(profile?.character_ref)) miss.push('同一角色只能有一份固定音色配置');
      voiceIds.add(profile?.character_ref);
      add('PR8', `${label} 固定声音配置`, miss.length === 0, miss.length ? `缺或无效：${miss.join('、')}` : '');
    }
    const trackIds = new Set();
    for (const track of tracks) {
      const label = `音轨事件「${track?.track_id ?? '?'}」`;
      const miss = required(track, ['track_id', 'track', 'type', 'asset_ref', 'transition']);
      if (!AUDIO_TRACKS.includes(track?.track)) miss.push('track（A1-A5）');
      if (!Number.isFinite(track?.start_time) || track.start_time < 0
        || !Number.isFinite(track?.end_time) || track.end_time <= track.start_time) miss.push('start_time/end_time');
      if (!Number.isFinite(track?.volume) || track.volume < 0 || track.volume > 1) miss.push('volume（0-1）');
      if (!Number.isFinite(track?.fade_in) || track.fade_in < 0
        || !Number.isFinite(track?.fade_out) || track.fade_out < 0) miss.push('fade_in/fade_out');
      if (track?.track === 'A5' && track?.ducking !== true) miss.push('BGM ducking（对白期间必须启用）');
      if (trackIds.has(track?.track_id)) miss.push(`track_id 重复：${track.track_id}`);
      trackIds.add(track?.track_id);
      add('PR9', `${label} 时间与混音参数`, miss.length === 0, miss.length ? `缺或无效：${miss.join('、')}` : '');
    }
    add('PR10', '音频计划禁止直接混入视频自带 BGM', plan.exclude_video_bgm === true, 'exclude_video_bgm 必须为 true；视频片段自带 BGM 默认静音');
    add('PR10', '对白期间启用 BGM 自动闪避', plan.mix?.dialogue_ducking === true, 'audio_plan.mix.dialogue_ducking 必须为 true');
    for (const dialogue of dialogues) {
      if (nonEmpty(dialogue?.speaker_ref) && characterIds.has(dialogue.speaker_ref)) {
        add('PR8', `对白「${dialogue.dialogue_id}」使用固定角色音色`,
          voiceIds.has(dialogue.speaker_ref), voiceIds.has(dialogue.speaker_ref) ? '' : `缺少角色「${dialogue.speaker_ref}」的 voice_profiles 配置`);
      }
    }
  }

  const timeline = production.timeline;
  if (isObj(timeline)) {
    add('PR11', '后期视频轨道 V1/V2/V3', VIDEO_TRACKS.every((track) => timeline.video_tracks?.includes(track)),
      '须配置 V1 主画面、V2 辅助画面、V3 字幕');
    add('PR11', '后期音频轨道 A1-A5', AUDIO_TRACKS.every((track) => timeline.audio_tracks?.includes(track)),
      '须配置 A1 对白、A2 旁白、A3 环境音、A4 音效、A5 BGM');
    add('PR11', '最终成片仅执行一次统一混音', timeline.final_mix_count === 1 && timeline.exclude_video_bgm === true,
      'final_mix_count 必须为 1，且排除视频自带 BGM');
  }

  const quality = production.quality_checks;
  if (isObj(quality)) {
    for (const domain of QUALITY_DOMAINS) {
      const items = Array.isArray(quality[domain]) ? quality[domain] : [];
      add('PR12', `质量检查「${domain}」有可追溯结果`,
        items.length > 0 && items.every((item) => nonEmpty(item?.scope_ref) && nonEmpty(item?.notes)
          && ['passed', 'failed', 'needs_regeneration'].includes(item?.status)),
        items.length === 0 ? '至少记录一项检查，未检查不能标记通过' : '检查项须记录 scope_ref、notes 与有效 status');
    }
  }

  return gates;
}

/** validate 用：返回违规清单（带 gate id 前缀的字符串数组）。 */
export function validateAssets(doc) {
  return gateList(doc).filter((g) => !g.ok).map((g) => `${g.id} ${g.label}${g.detail ? ` — ${g.detail}` : ''}`);
}

/* ============================ 骨架与 seed ============================ */

function defaultProject() {
  return {
    aspect_ratio: '16:9',
    style_anchor: '',
    faithful: true,
    quality_common: DEFAULT_QUALITY,
    negative_common: DEFAULT_NEGATIVE,
  };
}

function defaultPipeline() {
  return {
    steps: PIPELINE_STEPS.map(([id, label]) => ({ id, label, status: 'pending', note: '' })),
  };
}

/** init：给一个确定性的空骨架。style_anchor 留空——那是 Step 1 和用户聊完才填的。 */
export function initSkeleton(drama = '未命名项目', source = '') {
  return {
    meta: { drama, source, created: today(), generator: 'novel-asset-pack' },
    project: defaultProject(),
    world: {
      background: '', power_system: '', social_structure: '',
      architecture: '', costume_rules: '', color_system: '',
    },
    races: [],
    factions: [],
    characters: [],
    scenes: [],
    props: [],
    source_analysis: { scope: '', chapters_read: 0, total_chapters: null, statistics: {}, notes: '' },
    art_plans: [],
    audio_assets: [],
    production: {
      scripts: [],
      story_events: [],
      dialogues: [],
      narration: [],
      shots: [],
      audio_plan: {
        voice_profiles: [],
        tracks: [],
        exclude_video_bgm: true,
        mix: { dialogue_ducking: true },
      },
      timeline: {
        video_tracks: [...VIDEO_TRACKS],
        audio_tracks: [...AUDIO_TRACKS],
        final_mix_count: 1,
        exclude_video_bgm: true,
      },
      quality_checks: { story: [], visual: [], audio: [] },
    },
    pipeline: defaultPipeline(),
  };
}

/** seed：确定性搬运 shuohao novel-outline 的 outline.json（characters/scenes/props 三块）。 */
export function seedFromOutline(outline, drama = '未命名项目') {
  const doc = initSkeleton(drama, outline?.source?.title ?? outline?.title ?? '');
  const chars = Array.isArray(outline?.characters) ? outline.characters : [];
  const scenes = Array.isArray(outline?.scenes) ? outline.scenes : [];
  const props = Array.isArray(outline?.props) ? outline.props : [];

  doc.characters = chars.map((c) => ({
    id: c.id ?? `char_${c.name}`,
    name: c.name ?? '',
    gender: '', age: '',
    identity: c.role ?? '',
    class: c.tier ?? '',
    faction_id: '',
    personality: '',
    identity_anchor: '',
    fixed_features: '',
    seedNote: c.arc ? `大纲弧线：${c.arc}` : null,
    periods: [{
      period_name: '基准期',
      is_base: true,
      generation_mode: MODE_FRESH,
      appearance: '',
      costume: '',
      prompt_body: '',
    }],
  }));

  doc.scenes = scenes.map((s) => ({
    id: s.id ?? `scene_${s.name}`,
    name: s.name ?? '',
    era: '', location: '', atmosphere: '', lighting: '',
    key_elements: [],
    seedNote: s.primary ? '大纲标记的主场景' : null,
    prompt_body: '',
  }));

  doc.props = props.map((p) => ({
    id: p.id ?? `prop_${p.name}`,
    name: p.name ?? '',
    owner: '', material: '',
    usage: p.function ?? '',
    source_ref: null,
    seedNote: p.beatIds?.length ? `出现于节拍：${p.beatIds.join('、')}` : null,
    prompt_body: '',
  }));

  if (doc.characters.length || doc.scenes.length || doc.props.length) {
    const step = doc.pipeline.steps.find((s) => s.id === 'config');
    if (step) step.note = 'seed 自 outline.json：事实已搬运，理解字段（锚点/外貌/服饰/提示词）由模型填写';
  }
  return doc;
}

/* ============================ 计数与拼装 ============================ */

function countsOf(doc) {
  const chars = Array.isArray(doc.characters) ? doc.characters : [];
  const production = doc.production ?? {};
  return {
    characters: chars.length,
    periods: chars.reduce((n, c) => n + (Array.isArray(c.periods) ? c.periods.length : 0), 0),
    factions: (Array.isArray(doc.factions) ? doc.factions : []).length,
    scenes: (Array.isArray(doc.scenes) ? doc.scenes : []).length,
    props: (Array.isArray(doc.props) ? doc.props : []).length,
    races: (Array.isArray(doc.races) ? doc.races : []).length,
    artPlans: (Array.isArray(doc.art_plans) ? doc.art_plans : []).length,
    audio: (Array.isArray(doc.audio_assets) ? doc.audio_assets : []).length,
    scripts: (Array.isArray(production.scripts) ? production.scripts : []).length,
    shots: (Array.isArray(production.shots) ? production.shots : []).length,
    stepsDone: (doc.pipeline?.steps ?? []).filter((s) => s.status === 'done').length,
    stepsTotal: (doc.pipeline?.steps ?? []).length,
  };
}

function buildPayload(doc, jsonDir) {
  const proj = doc.project ?? {};
  const chars = Array.isArray(doc.characters) ? doc.characters : [];
  const fullById = {};

  chars.forEach((c) => {
    (Array.isArray(c.periods) ? c.periods : []).forEach((p, i) => {
      const mode = p.generation_mode ?? (p.is_base ? MODE_FRESH : MODE_I2I);
      const full = assemblePrompt(proj.style_anchor, p.prompt_body, proj.quality_common, proj.negative_common, {
        img2img: !p.is_base && mode === MODE_I2I,
        reason: p.variation_reason,
      });
      fullById[`period:${c.id}:${i}`] = {
        full,
        img: resolveImage(jsonDir, p.image),
        reference: p.reference_image ?? null,
      };
    });
  });
  for (const [key, arr, field] of [
    ['faction', Array.isArray(doc.factions) ? doc.factions : [], 'factions'],
    ['scene', Array.isArray(doc.scenes) ? doc.scenes : [], 'scenes'],
    ['prop', Array.isArray(doc.props) ? doc.props : [], 'props'],
  ]) {
    void field;
    for (const it of arr) {
      fullById[`${key}:${it.id}`] = {
        full: assemblePrompt(proj.style_anchor, it.prompt_body, proj.quality_common, proj.negative_common),
        img: resolveImage(jsonDir, it.image),
        reference: null,
      };
    }
  }

  for (const it of Array.isArray(doc.art_plans) ? doc.art_plans : []) {
    fullById[`art:${it.id}`] = {
      full: assemblePrompt(proj.style_anchor, it.prompt_body, proj.quality_common, proj.negative_common),
      img: resolveImage(jsonDir, it.image),
      reference: null,
    };
  }
  for (const it of Array.isArray(doc.races) ? doc.races : []) {
    fullById[`race:${it.id}`] = {
      full: assemblePrompt(proj.style_anchor, it.prompt_body, proj.quality_common, proj.negative_common),
      img: resolveImage(jsonDir, it.image),
      reference: null,
    };
  }
  for (const it of Array.isArray(doc.production?.shots) ? doc.production.shots : []) {
    fullById[`shot:${it.id}`] = {
      full: assemblePrompt(proj.style_anchor, it.prompt_body, proj.quality_common, proj.negative_common),
      img: resolveImage(jsonDir, it.image),
      reference: null,
    };
  }

  return {
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    doc,
    counts: countsOf(doc),
    quality: gateList(doc),
    assembled: { fullById },
  };
}

/* ============================ HTML 渲染 ============================ */

const PAGE_CSS = `
:root{--paper:#f5f1e8;--card:#fffdf8;--ink:#2b2620;--ink2:#6b6157;--line:#e4dcc9;--accent:#8b2f2f;--gold:#a8834f;--green:#3e6b4f;--amber:#b07b2e;--side:#221f1a}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65}
.layout{display:flex;min-height:100vh}
aside{width:248px;flex:0 0 248px;background:var(--side);color:#d8d2c4;padding:22px 0 90px;position:sticky;top:0;height:100vh;overflow-y:auto}
aside h1{font-size:17px;color:#f2ede0;padding:0 20px 4px;letter-spacing:1px}
aside .sub{font-size:12px;color:#9a917e;padding:0 20px 14px;border-bottom:1px solid #3a352c}
aside nav a{display:flex;justify-content:space-between;align-items:center;padding:9px 20px;color:#c9c2b2;text-decoration:none;font-size:14px;border-left:3px solid transparent}
aside nav a:hover{background:#2c2820;color:#f2ede0}
aside nav a.active{border-left-color:var(--accent);background:#2c2820;color:#fff}
aside nav a .n{font-size:11px;color:#877e6b;background:#332e25;border-radius:9px;padding:1px 8px}
aside .tools{position:fixed;bottom:0;left:0;width:248px;padding:12px 20px;background:#1a1712;border-top:1px solid #3a352c;display:flex;gap:8px}
main{flex:1;padding:28px 34px 80px;max-width:1120px}
header.top{margin-bottom:22px}
header.top h2{font-size:24px}
header.top .meta{color:var(--ink2);font-size:13px;margin-top:4px}
section{margin-bottom:44px;scroll-margin-top:16px}
section>h3{font-size:19px;padding-bottom:8px;border-bottom:2px solid var(--line);margin-bottom:16px;display:flex;align-items:center;gap:10px}
section>h3 .en{font-size:12px;color:var(--gold);font-weight:400;letter-spacing:2px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;box-shadow:0 1px 3px rgba(60,50,30,.06)}
.card h4{font-size:16px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.card .row{font-size:13.5px;margin:5px 0;color:var(--ink)}
.card .row b{color:var(--ink2);font-weight:600;margin-right:6px;flex:0 0 auto}
.kv{display:flex;gap:6px;font-size:13.5px;margin:5px 0}
.chip{display:inline-block;font-size:11.5px;background:#efe8d8;border:1px solid var(--line);border-radius:20px;padding:1px 9px;color:var(--ink2)}
.chip.red{background:#f7e5e0;border-color:#e5c0b5;color:var(--accent)}
.chip.green{background:#e2eee6;border-color:#c2d8c9;color:var(--green)}
.chip.amber{background:#f5ead5;border-color:#e3cfa4;color:var(--amber)}
.swatch{display:inline-block;width:13px;height:13px;border-radius:3px;border:1px solid rgba(0,0,0,.18);vertical-align:-2px;margin-right:5px}
.anchor-box{background:#f2eee2;border:1px solid var(--gold);border-left:4px solid var(--gold);border-radius:8px;padding:10px 14px;font-size:14px;margin:10px 0}
.warn-box{background:#f9ece8;border:1px solid #e0b8ab;border-left:4px solid var(--accent);border-radius:8px;padding:10px 14px;font-size:14px;margin:10px 0}
.prompt{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px}
.p-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink2);margin-bottom:4px}
.prompt pre{white-space:pre-wrap;word-break:break-all;background:#2f2b24;color:#e8e2d2;border-radius:8px;padding:10px 12px;font-size:12.5px;font-family:Consolas,Menlo,monospace}
.copy{font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:3px 12px;cursor:pointer}
.copy:hover{background:#a13b3b}
.copy.ok{background:var(--green)}
table.periods{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13.5px;margin-bottom:18px}
table.periods th{background:#efe9da;text-align:left;padding:8px 12px;font-weight:600;white-space:nowrap}
table.periods td{padding:8px 12px;border-top:1px solid var(--line);vertical-align:top}
table.periods td.mono{font-family:Consolas,Menlo,monospace;font-size:12px;color:var(--ink2)}
.img-box{margin-top:10px}
.img-box img{max-width:100%;border-radius:8px;border:1px solid var(--line)}
.img-ph{border:1.5px dashed #cfc5ab;border-radius:8px;color:#a2987f;font-size:12px;text-align:center;padding:18px 8px}
.progress{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:14px}
.bar{height:10px;background:#e8e1cf;border-radius:6px;overflow:hidden;margin:8px 0 12px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--green),#5d8f6f)}
.steps{list-style:none}
.steps li{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:14px}
.steps li:last-child{border-bottom:none}
.steps .note{color:var(--ink2);font-size:12.5px;margin-left:auto;text-align:right;max-width:46%}
.counts{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.counts .card{flex:1;min-width:130px;text-align:center;padding:12px}
.counts .num{font-size:24px;font-weight:700;color:var(--accent)}
.counts .lbl{font-size:12px;color:var(--ink2)}
dl.defs{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px}
dl.defs dt{font-weight:600;color:var(--ink2);font-size:13px;margin-top:10px}
dl.defs dt:first-child{margin-top:0}
dl.defs dd{font-size:14px;margin-top:2px}
.lib-group{margin-bottom:22px}
.lib-group>h4{font-size:15px;color:var(--gold);margin-bottom:8px}
.lib-item{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:8px}
.lib-item .t{display:flex;justify-content:space-between;align-items:center;font-size:13.5px;font-weight:600;margin-bottom:4px}
@media print{aside{display:none}.layout{display:block}}
`;

function pageScript() {
  // 页内脚本刻意不用模板字符串/箭头函数里的 ${}，避免与本文件的模板字面量冲突。
  return `
(function () {
  var R = window.__ASSET_REPORT__;
  var D = R.doc, A = R.assembled.fullById, C = R.counts;
  var copyTexts = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function copyBtn(text) {
    var i = copyTexts.push(text) - 1;
    return '<button class="copy" data-copy="' + i + '">复制</button>';
  }
  function chip(t, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(t) + '</span>'; }
  function promptBox(key, tag) {
    var ref = A[key];
    if (!ref) return '';
    var img = '';
    if (ref.img) img = '<div class="img-box"><img src="' + ref.img + '" alt=""></div>';
    else img = '<div class="img-box"><div class="img-ph">出图后放入 images/ 目录即可显示</div></div>';
    return '<div class="prompt"><div class="p-head"><span>' + esc(tag || '完整提示词（风格锚点已注入）') + '</span>' + copyBtn(ref.full) + '</div><pre>' + esc(ref.full) + '</pre>' + img + '</div>';
  }
  function modeChip(p) {
    if (p.is_base) return chip('基准期 · 首图', 'green');
    if ((p.generation_mode || 'reference_img2img') === 'reference_img2img') return chip('衍生期 · 图生图', 'amber');
    return chip('衍生期 · 原著幻化重开', 'red');
  }

  function sec(id, zh, en, body, count) {
    return '<section id="' + id + '"><h3>' + esc(zh) + ' <span class="en">' + esc(en) + '</span>' + (count != null ? '<span class="chip">' + count + '</span>' : '') + '</h3>' + body + '</section>';
  }

  var P = D.project || {}, W = D.world || {};

  /* ---- 进度总览 ---- */
  var stepsHtml = (D.pipeline && D.pipeline.steps || []).map(function (s) {
    var cls = s.status === 'done' ? 'green' : s.status === 'in_progress' ? 'amber' : '';
    var txt = s.status === 'done' ? '完成' : s.status === 'in_progress' ? '进行中' : '待开始';
    return '<li>' + chip(txt, cls) + '<span>' + esc(s.label) + '</span>' + (s.note ? '<span class="note">' + esc(s.note) + '</span>' : '') + '</li>';
  }).join('');
  var pct = C.stepsTotal ? Math.round(C.stepsDone / C.stepsTotal * 100) : 0;
  var failed = (R.quality || []).filter(function (g) { return !g.ok; });
  var qualityHtml = failed.length
    ? '<div class="warn-box"><b>当前质量门未通过：' + failed.length + ' 项</b><ul>' + failed.slice(0, 6).map(function (g) { return '<li>' + esc(g.id + ' ' + g.label + (g.detail ? '：' + g.detail : '')) + '</li>'; }).join('') + (failed.length > 6 ? '<li>其余 ' + (failed.length - 6) + ' 项请运行 checkup 查看</li>' : '') + '</ul></div>'
    : '<div class="anchor-box">当前质量门全部通过</div>';
  var overview = '<div class="progress"><b>总进度</b>（' + C.stepsDone + '/' + C.stepsTotal + ' 步）'
    + '<div class="bar"><i style="width:' + pct + '%"></i></div>'
    + '<ul class="steps">' + stepsHtml + '</ul></div>' + qualityHtml
    + '<div class="counts">'
    + '<div class="card"><div class="num">' + C.characters + '</div><div class="lbl">角色 · ' + C.periods + ' 个时期</div></div>'
    + '<div class="card"><div class="num">' + C.factions + '</div><div class="lbl">势力</div></div>'
    + '<div class="card"><div class="num">' + C.races + '</div><div class="lbl">种族</div></div>'
    + '<div class="card"><div class="num">' + C.scenes + '</div><div class="lbl">场景</div></div>'
    + '<div class="card"><div class="num">' + C.props + '</div><div class="lbl">道具</div></div>'
    + '<div class="card"><div class="num">' + C.artPlans + '</div><div class="lbl">美工设计</div></div>'
    + '<div class="card"><div class="num">' + C.audio + '</div><div class="lbl">音频</div></div>'
    + '<div class="card"><div class="num">' + C.scripts + '</div><div class="lbl">剧本</div></div>'
    + '<div class="card"><div class="num">' + C.shots + '</div><div class="lbl">镜头</div></div>'
    + '</div>';

  /* ---- 项目配置 ---- */
  var faithful = P.faithful === false ? chip('改编模式（异常：本报告不应存在）', 'red') : chip('忠实原著 · 不改写/不删减/不加钩子', 'green');
  var config = '<div class="cards">'
    + '<div class="card"><h4>画幅与模式</h4><div class="kv"><b>画幅</b>' + chip(P.aspect_ratio || '16:9') + '</div><div class="kv"><b>策略</b>' + faithful + '</div></div>'
    + '<div class="card"><h4>全局风格锚点（注入每条提示词）</h4><div class="anchor-box">' + esc(P.style_anchor || '（未填写）') + '</div></div>'
    + '<div class="card"><h4>统一质量词</h4><div class="anchor-box">' + esc(P.quality_common || '') + '</div></div>'
    + '<div class="card"><h4>统一负面提示词</h4><div class="warn-box">' + esc(P.negative_common || '') + '</div></div>'
    + '</div>';

  /* ---- 世界观 ---- */
  var world = '<dl class="defs">'
    + '<dt>世界背景</dt><dd>' + esc(W.background) + '</dd>'
    + '<dt>修炼 / 社会体系</dt><dd>' + esc(W.power_system) + '</dd>'
    + '<dt>社会结构</dt><dd>' + esc(W.social_structure) + '</dd>'
    + '<dt>建筑风格</dt><dd>' + esc(W.architecture) + '</dd>'
    + '<dt>服饰规则</dt><dd>' + esc(W.costume_rules) + '</dd>'
    + '<dt>色彩体系</dt><dd>' + esc(W.color_system) + '</dd>'
    + '</dl>';

  /* ---- 势力与阶级 ---- */
  var factions = (D.factions || []).map(function (f) {
    var ref = A['faction:' + f.id] || {};
    return '<div class="card"><h4>' + esc(f.name) + (f.main_color ? '<span class="chip"><i class="swatch" style="background:' + esc(f.main_color) + '"></i>主色 ' + esc(f.main_color) + '</span>' : '') + '</h4>'
      + '<div class="kv"><b>定位</b>' + esc(f.positioning) + '</div>'
      + '<div class="kv"><b>阶级体系</b>' + (Array.isArray(f.class_system) ? f.class_system.map(function (x) { return chip(x); }).join(' ') : esc(f.class_system)) + '</div>'
      + '<div class="kv"><b>服饰规则</b>' + esc(f.costume_rule) + '</div>'
      + '<div class="kv"><b>纹样</b>' + esc(f.pattern) + '</div>'
      + promptBox('faction:' + f.id, '势力提示词（风格锚点已注入）') + '</div>';
  }).join('');

  var races = (D.races || []).map(function (it) {
    return '<div class="card"><h4>' + esc(it.name || it.id) + '</h4>'
      + '<div class="row"><b>外观与特征</b>' + esc(it.description || '') + '</div>'
      + promptBox('race:' + it.id, '种族设定提示词') + '</div>';
  }).join('');

  /* ---- 角色资产 ---- */
  var factionName = {};
  (D.factions || []).forEach(function (f) { factionName[f.id] = f.name; });
  var characters = (D.characters || []).map(function (c) {
    var head = '<h4>' + esc(c.name)
      + chip(c.gender || '?') + chip(c.age || '?')
      + (c.faction_id && factionName[c.faction_id] ? chip(factionName[c.faction_id]) : chip('散修/无势力', 'amber'))
      + chip(c.class || '') + '</h4>'
      + '<div class="kv"><b>身份</b>' + esc(c.identity) + '</div>'
      + '<div class="kv"><b>性格</b>' + esc(c.personality) + '</div>'
      + '<div class="kv"><b>固定主体锚点</b><span style="color:var(--accent)">' + esc(c.identity_anchor) + '</span></div>'
      + (c.fixed_features ? '<div class="warn-box"><b>原著固定特征（每时期必须延续）：</b>' + esc(c.fixed_features) + '</div>' : '')
      + (c.periods || []).map(function (p, i) {
        return '<div class="card" style="margin-top:10px;background:#faf7ee"><h4 style="font-size:14px">' + esc(p.period_name) + ' ' + modeChip(p) + '</h4>'
          + '<div class="kv"><b>外貌</b>' + esc(p.appearance) + '</div>'
          + '<div class="kv"><b>服饰</b>' + esc(p.costume) + '</div>'
          + (p.variation_reason ? '<div class="kv"><b>变化依据</b>' + esc(p.variation_reason) + (p.reference_image ? ' <span class="chip">参考 ' + esc(p.reference_image) + '</span>' : '') + '</div>' : '')
          + promptBox('period:' + c.id + ':' + i, '时期提示词（' + (p.is_base ? '首图' : '以参考图生图，脚本已注入一致性前缀') + '）')
          + '</div>';
      }).join('');
    return '<div class="card">' + head + '</div>';
  }).join('');

  /* ---- 角色时期变化 ---- */
  var periodTables = (D.characters || []).map(function (c) {
    var rows = (c.periods || []).map(function (p, i) {
      var ref = A['period:' + c.id + ':' + i] || {};
      var mode = p.is_base ? '首图（基准）' : (p.generation_mode === 'fresh_generation' ? '原著幻化 · 重开' : '图生图');
      return '<tr><td>' + esc(p.period_name) + (p.is_base ? ' ' + chip('基准', 'green') : '') + '</td>'
        + '<td>' + esc(mode) + '</td>'
        + '<td>' + esc(p.appearance) + '</td>'
        + '<td>' + esc(p.costume) + '</td>'
        + '<td>' + esc(p.variation_reason || '—') + '</td>'
        + '<td class="mono">' + esc(ref.reference || p.reference_image || '—') + '</td></tr>';
    }).join('');
    return '<h4 style="margin:14px 0 6px">' + esc(c.name) + '（' + esc(c.identity || '') + '）</h4>'
      + '<table class="periods"><tr><th>时期</th><th>生成方式</th><th>外貌</th><th>服饰</th><th>变化依据</th><th>参考图</th></tr>' + rows + '</table>';
  }).join('');

  /* ---- 场景 / 道具 ---- */
  var scenes = (D.scenes || []).map(function (s) {
    return '<div class="card"><h4>' + esc(s.name) + '</h4>'
      + '<div class="kv"><b>时代</b>' + esc(s.era) + '<b style="margin-left:10px">地点</b>' + esc(s.location) + '</div>'
      + '<div class="kv"><b>氛围</b>' + esc(s.atmosphere) + '</div>'
      + '<div class="kv"><b>光照</b>' + esc(s.lighting) + '</div>'
      + '<div class="kv"><b>关键元素</b>' + (s.key_elements || []).map(function (x) { return chip(x); }).join(' ') + '</div>'
      + promptBox('scene:' + s.id, '场景提示词（风格锚点已注入）') + '</div>';
  }).join('');

  var props = (D.props || []).map(function (p) {
    var src = p.source_ref && (p.source_ref.chapter || p.source_ref.quote)
      ? '<div class="kv"><b>出处</b>' + esc(p.source_ref.chapter ? '第' + p.source_ref.chapter + '章 ' : '') + esc(p.source_ref.quote || '') + '</div>' : '';
    return '<div class="card"><h4>' + esc(p.name) + '</h4>'
      + '<div class="kv"><b>归属</b>' + esc(p.owner) + '</div>'
      + '<div class="kv"><b>材质</b>' + esc(p.material) + '<b style="margin-left:10px">用途</b>' + esc(p.usage) + '</div>'
      + src
      + promptBox('prop:' + p.id, '道具提示词（风格锚点已注入）') + '</div>';
  }).join('');

  /* ---- 美工规划与设计图 ---- */
  var artPlans = (D.art_plans || []).map(function (it) {
    var review = it.review || {};
    var reviewLabel = review.status === 'approved' ? chip('检验通过', 'green') : chip(review.status || '待检验', 'amber');
    return '<div class="card"><h4>' + esc(it.title || it.name || it.id) + ' ' + reviewLabel + '</h4>'
      + '<div class="kv"><b>类别 / 对象</b>' + esc(it.category || '') + ' · ' + esc(it.target || '') + '</div>'
      + (it.tier ? '<div class="kv"><b>阶级 / 时期</b>' + esc(it.tier) + '</div>' : '')
      + '<div class="row"><b>设计说明</b>' + esc(it.description || '') + '</div>'
      + (review.notes ? '<div class="row"><b>检验记录</b>' + esc(review.notes) + '</div>' : '')
      + promptBox('art:' + it.id, '美工设计提示词') + '</div>';
  }).join('');
  var imageReviews = (D.image_reviews || []).map(function (it) {
    var status = it.status === 'approved' ? chip('检验通过', 'green') : chip(it.status || '待检验', 'amber');
    return '<div class="lib-item"><div class="t"><span>' + esc(it.asset_id || it.image || '未关联资产') + '</span>' + status + '</div>'
      + '<div class="row"><b>图片</b>' + esc(it.image || '') + '</div>'
      + '<div class="row"><b>检验记录</b>' + esc(it.notes || '') + '</div></div>';
  }).join('');

  /* ---- 音频 ---- */
  var audioAssets = (D.audio_assets || []).map(function (it) {
    var player = it.file ? '<audio controls preload="none" src="' + esc(it.file) + '"></audio>' : '<div class="img-ph">音频待生成</div>';
    return '<div class="card"><h4>' + esc(it.title || it.name || it.id) + '</h4>'
      + '<div class="kv"><b>类型</b>' + esc(it.type || '') + '</div>'
      + '<div class="row"><b>说明</b>' + esc(it.description || '') + '</div>' + player + '</div>';
  }).join('');

  /* ---- 剧本 / 分镜 / 镜头图 ---- */
  var production = D.production || {};
  var scripts = (production.scripts || []).map(function (it) {
    return '<div class="card"><h4>' + esc(it.title || it.episode || it.id) + '</h4>'
      + '<div class="row">' + esc(it.summary || '') + '</div>'
      + (it.file ? '<div class="row"><b>文件</b><a href="' + esc(it.file) + '">' + esc(it.file) + '</a></div>' : '') + '</div>';
  }).join('');
  var shots = (production.shots || []).map(function (it) {
    return '<div class="card"><h4>' + esc(it.title || it.id) + '</h4>'
      + '<div class="kv"><b>剧集 / 场景</b>' + esc(it.episode || '') + ' · ' + esc(it.scene || '') + '</div>'
      + '<div class="row"><b>资产引用</b>' + esc((it.asset_refs || []).join('、')) + '</div>'
      + '<div class="row"><b>成本控制</b>' + esc(it.reuse_note || '') + '</div>'
      + promptBox('shot:' + it.id, '镜头图提示词') + '</div>';
  }).join('');

  /* ---- 提示词库 ---- */
  function libItem(title, key) {
    var ref = A[key];
    if (!ref) return '';
    return '<div class="lib-item"><div class="t"><span>' + esc(title) + '</span>' + copyBtn(ref.full) + '</div><pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;color:#544c3f;font-family:Consolas,Menlo,monospace">' + esc(ref.full) + '</pre></div>';
  }
  var lib = '<div class="lib-group"><h4>通用段（注入每条提示词）</h4>'
    + '<div class="lib-item"><div class="t"><span>全局风格锚点 + 质量词</span>' + copyBtn((P.style_anchor || '') + '；' + (P.quality_common || '')) + '</div><pre style="white-space:pre-wrap;font-size:12px;color:#544c3f;font-family:Consolas,Menlo,monospace">' + esc((P.style_anchor || '') + '；' + (P.quality_common || '')) + '</pre></div>'
    + '<div class="lib-item"><div class="t"><span>统一负面提示词</span>' + copyBtn(P.negative_common || '') + '</div><pre style="white-space:pre-wrap;font-size:12px;color:#544c3f;font-family:Consolas,Menlo,monospace">' + esc(P.negative_common || '') + '</pre></div>'
    + '</div>';
  lib += '<div class="lib-group"><h4>角色 · 按时期</h4>' + (D.characters || []).map(function (c) {
    return (c.periods || []).map(function (p, i) { return libItem(c.name + ' · ' + p.period_name, 'period:' + c.id + ':' + i); }).join('');
  }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>势力</h4>' + (D.factions || []).map(function (f) { return libItem(f.name, 'faction:' + f.id); }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>场景</h4>' + (D.scenes || []).map(function (s) { return libItem(s.name, 'scene:' + s.id); }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>道具</h4>' + (D.props || []).map(function (p) { return libItem(p.name, 'prop:' + p.id); }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>种族</h4>' + (D.races || []).map(function (it) { return libItem(it.name, 'race:' + it.id); }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>美工设计</h4>' + (D.art_plans || []).map(function (it) { return libItem(it.title || it.name || it.id, 'art:' + it.id); }).join('') + '</div>';
  lib += '<div class="lib-group"><h4>镜头图</h4>' + ((D.production && D.production.shots) || []).map(function (it) { return libItem(it.title || it.id, 'shot:' + it.id); }).join('') + '</div>';

  /* ---- 组装页面 ---- */
  var drama = (D.meta && D.meta.drama) || '漫剧资产包';
  var nav = [
    ['overview', '进度总览', null],
    ['config', '项目配置', null],
    ['world', '世界观', null],
    ['races', '种族设定', C.races],
    ['factions', '势力与阶级', C.factions],
    ['characters', '角色资产', C.characters],
    ['periods', '角色时期变化', C.periods],
    ['scenes', '场景资产', C.scenes],
    ['props', '道具资产', C.props],
    ['art', '美工规划与检验', C.artPlans],
    ['audio', '音频资产', C.audio],
    ['production', '剧本与分镜', C.scripts],
    ['shots', '镜头图', C.shots],
    ['library', '提示词库', null],
  ];
  document.getElementById('nav').innerHTML = nav.map(function (n) {
    return '<a href="#' + n[0] + '" data-sec="' + n[0] + '"><span>' + n[1] + '</span>' + (n[2] != null ? '<span class="n">' + n[2] + '</span>' : '') + '</a>';
  }).join('');

  document.getElementById('panels').innerHTML =
    '<header class="top"><h2>' + esc(drama) + ' · AI 漫剧资产报告</h2><div class="meta">生成时间 ' + esc(R.generatedAt) + ' · 数据来自 ' + esc(R.sourceFile || 'assets json') + ' · 所有提示词均为「风格锚点 + prompt_body + 质量词 + 统一负面词」脚本拼装</div></header>'
    + sec('overview', '进度总览', 'PROGRESS', overview)
    + sec('config', '项目配置', 'PROJECT', config)
    + sec('world', '世界观', 'WORLD', world)
    + sec('races', '种族设定', 'SPECIES', '<div class="cards">' + races + '</div>', C.races)
    + sec('factions', '势力与阶级', 'FACTIONS', '<div class="cards">' + factions + '</div>', C.factions)
    + sec('characters', '角色资产', 'CHARACTERS', '<div class="cards" style="grid-template-columns:1fr">' + characters + '</div>', C.characters)
    + sec('periods', '角色时期变化', 'PERIODS', periodTables, C.periods)
    + sec('scenes', '场景资产', 'SCENES', '<div class="cards">' + scenes + '</div>', C.scenes)
    + sec('props', '道具资产', 'PROPS', '<div class="cards">' + props + '</div>', C.props)
    + sec('art', '美工规划与检验', 'ART DIRECTION', '<h4>设计规划与美工图检验</h4><div class="cards">' + artPlans + '</div><h4 style="margin-top:18px">资产图审核记录</h4>' + (imageReviews || '<div class="img-ph">尚无资产图审核记录</div>'), C.artPlans)
    + sec('audio', '音频资产', 'AUDIO', '<div class="cards">' + audioAssets + '</div>', C.audio)
    + sec('production', '项目剧本与分镜', 'SCRIPT & STORYBOARD', '<div class="cards">' + scripts + '</div>', C.scripts)
    + sec('shots', '镜头图', 'SHOT IMAGES', '<div class="cards">' + shots + '</div>', C.shots)
    + sec('library', '提示词库', 'PROMPT LIBRARY', lib);

  /* ---- 复制与高亮 ---- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var text = copyTexts[+btn.getAttribute('data-copy')] || '';
    function done() { btn.textContent = '已复制'; btn.classList.add('ok'); setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('ok'); }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  });
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  var links = [].slice.call(document.querySelectorAll('#nav a'));
  window.addEventListener('hashchange', mark);
  function mark() {
    var h = (location.hash || '#overview').slice(1);
    links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-sec') === h); });
    var el = document.getElementById(h);
    if (el) el.scrollIntoView();
  }
  mark();

  document.getElementById('export-btn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ((D.meta && D.meta.drama) || 'assets') + '-assets.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
`;
}

export function renderHtml(doc, opts = {}) {
  const payload = buildPayload(doc, opts.jsonDir ?? '.');
  if (opts.sourceFile) payload.sourceFile = opts.sourceFile;
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const drama = escHtml(doc?.meta?.drama ?? '漫剧资产包');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${drama} · AI 漫剧资产报告</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="layout">
  <aside>
    <h1>${drama}</h1>
    <div class="sub">novel-asset-pack · 资产报告</div>
    <nav id="nav"></nav>
    <div class="tools"><button class="copy" id="export-btn" style="flex:1">导出 JSON</button></div>
  </aside>
  <main id="panels"></main>
</div>
<script>window.__ASSET_REPORT__ = ${json};</script>
<script>${pageScript()}</script>
</body>
</html>
`;
}

/* ============================ Markdown 渲染 ============================ */

export function renderMarkdown(doc) {
  const P = doc.project ?? {};
  const W = doc.world ?? {};
  const c = countsOf(doc);
  const L = [];
  const drama = doc?.meta?.drama ?? '漫剧资产包';
  L.push(`# ${drama} · AI 漫剧资产包`);
  L.push('');
  L.push(`> 生成于 ${new Date().toISOString().slice(0, 10)} · 角色 ${c.characters}（${c.periods} 个时期）· 势力 ${c.factions} · 场景 ${c.scenes} · 道具 ${c.props}`);
  L.push('');
  L.push('## 项目配置');
  L.push('');
  L.push(`- 画幅：${P.aspect_ratio ?? ''}`);
  L.push(`- 忠实原著：${P.faithful === false ? '否（异常）' : '是 · 不改写/不删减/不加钩子'}`);
  L.push(`- 风格锚点：${P.style_anchor ?? ''}`);
  L.push(`- 质量词：${P.quality_common ?? ''}`);
  L.push(`- 统一负面提示词：${P.negative_common ?? ''}`);
  L.push('');
  L.push('## 世界观');
  L.push('');
  for (const [k, label] of WORLD_FIELDS) L.push(`- **${label}**：${W[k] ?? ''}`);
  L.push('');

  const promptLine = (body, opts = {}) =>
    `\n  > 完整提示词：${assemblePrompt(P.style_anchor, body, P.quality_common, P.negative_common, opts)}`;

  L.push('## 势力与阶级');
  for (const f of doc.factions ?? []) {
    L.push('');
    L.push(`### ${f.name}（主色 ${f.main_color} · 纹样 ${f.pattern}）`);
    L.push(`- 定位：${f.positioning}`);
    L.push(`- 阶级体系：${Array.isArray(f.class_system) ? f.class_system.join(' / ') : f.class_system}`);
    L.push(`- 服饰规则：${f.costume_rule}`);
    L.push(promptLine(f.prompt_body));
  }
  L.push('');
  L.push('## 角色资产');
  for (const ch of doc.characters ?? []) {
    L.push('');
    L.push(`### ${ch.name}（${ch.gender ?? ''} / ${ch.age ?? ''} · ${ch.faction_id ?? '散修'} · ${ch.class ?? ''}）`);
    L.push(`- 身份：${ch.identity ?? ''}`);
    L.push(`- 性格：${ch.personality ?? ''}`);
    L.push(`- 固定主体锚点：${ch.identity_anchor ?? ''}`);
    if (ch.fixed_features) L.push(`- 原著固定特征：${ch.fixed_features}`);
    for (const [i, p] of (ch.periods ?? []).entries()) {
      L.push('');
      L.push(`#### 时期：${p.period_name}${p.is_base ? '（基准期）' : '（衍生期 · 图生图）'}`);
      L.push(`- 外貌：${p.appearance ?? ''}`);
      L.push(`- 服饰：${p.costume ?? ''}`);
      if (p.variation_reason) L.push(`- 变化依据：${p.variation_reason}${p.reference_image ? `（参考 ${p.reference_image}）` : ''}`);
      L.push(promptLine(p.prompt_body, { img2img: !p.is_base, reason: p.variation_reason }));
      void i;
    }
  }
  L.push('');
  L.push('## 场景资产');
  for (const s of doc.scenes ?? []) {
    L.push('');
    L.push(`### ${s.name}（${s.era ?? ''} · ${s.location ?? ''}）`);
    L.push(`- 氛围：${s.atmosphere ?? ''} · 光照：${s.lighting ?? ''}`);
    L.push(`- 关键元素：${(s.key_elements ?? []).join('、')}`);
    L.push(promptLine(s.prompt_body));
  }
  L.push('');
  L.push('## 道具资产');
  for (const p of doc.props ?? []) {
    L.push('');
    L.push(`### ${p.name}（${p.owner ?? ''} · ${p.material ?? ''}）`);
    L.push(`- 用途：${p.usage ?? ''}${p.source_ref?.chapter ? ` · 出现章节：第 ${p.source_ref.chapter} 章` : ''}`);
    L.push(promptLine(p.prompt_body));
  }
  L.push('');
  L.push('## 统一负面提示词');
  L.push('');
  L.push(P.negative_common ?? '');
  L.push('');
  return L.join('\n');
}

/* ============================ CLI ============================ */

const USAGE = `novel-asset-pack —— 小说/原著 → AI 漫剧资产包（角色/势力/场景/道具/时期/提示词库）

用法：
  node asset-pack.mjs init [剧名]                          输出空骨架 assets json
  node asset-pack.mjs seed <outline.json> [剧名]           从 shuohao novel-outline 的 outline.json 搬运事实
  node asset-pack.mjs validate <assets.json>               质量门校验（违规则 exit 1）
  node asset-pack.mjs checkup <assets.json>                逐门报告（✓/✗ 明细）
  node asset-pack.mjs render <assets.json> --html|--md     渲染报告到 stdout（--html 为离线单页）

提示词结构：风格锚点 + 视角 + 主体 + 背景 + 细节 + 光影 + 质量词 + 统一负面词
风格锚点/质量词/负面词/图生图前缀由本脚本注入，模型只写 prompt_body 五段。
`;

function printValidate(doc) {
  const problems = validateAssets(doc);
  if (problems.length) {
    console.error(`✗ ${problems.length} 处违规：\n`);
    for (const x of problems) console.error('  ' + x);
    process.exit(1);
  }
  const c = countsOf(doc);
  console.log(`✓ 全部质量门通过：角色 ${c.characters}（${c.periods} 个时期）· 势力 ${c.factions} · 场景 ${c.scenes} · 道具 ${c.props}`);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  const flag = (args, name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  if (cmd === 'init') {
    const drama = rest.find((x) => !x.startsWith('--')) ?? '未命名项目';
    console.log(JSON.stringify(initSkeleton(drama), null, 2));
    return;
  }

  if (cmd === 'seed') {
    const src = rest.find((x) => !x.startsWith('--'));
    if (!src) throw new Error('用法：seed <outline.json> [剧名]');
    const drama = rest.filter((x) => !x.startsWith('--'))[1] ?? '未命名项目';
    console.log(JSON.stringify(seedFromOutline(readJson(src), drama), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const p = rest.find((x) => !x.startsWith('--'));
    if (!p) throw new Error(`用法：${cmd} <assets.json>`);
    const doc = readJson(p);
    if (cmd === 'validate') return printValidate(doc);
    const gates = gateList(doc);
    for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.id} ${g.label}${!g.ok && g.detail ? ` — ${g.detail}` : ''}`);
    const failed = gates.filter((g) => !g.ok).length;
    console.log(failed ? `\n✗ ${failed} 项未过` : '\n✓ 全部通过');
    if (failed) process.exit(1);
    return;
  }

  if (cmd === 'render') {
    const p = rest.find((x) => !x.startsWith('--'));
    if (!p) throw new Error('用法：render <assets.json> --html|--md');
    const doc = readJson(p);
    if (rest.includes('--md')) {
      process.stdout.write(renderMarkdown(doc));
    } else {
      process.stdout.write(renderHtml(doc, { jsonDir: path.dirname(path.resolve(p)), sourceFile: path.basename(p) }));
    }
    return;
  }

  console.error(`未知命令：${cmd}\n` + USAGE);
  process.exit(1);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) main(process.argv.slice(2));
