export const PROMPT_VERSION = 'layered-v1';

const TASK_TYPES = new Set([
  'CHARACTER_ASSET',
  'CHARACTER_VIEWS',
  'CHARACTER_EXPRESSION',
  'CHARACTER_DERIVATIVE',
  'SCENE_MASTER',
  'SCENE_VARIANT',
  'PROP_ASSET',
  'STORYBOARD',
]);

const lines = (values) => (Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim());
const text = (value) => typeof value === 'string' ? value.trim() : '';

function assertApprovedReferences(taskType, parts) {
  const references = Array.isArray(parts.references) ? parts.references : [];
  const requireReference = (predicate, description) => {
    const ref = references.find(predicate);
    if (!ref || ref.approval_status !== 'APPROVED' || ref.stale) {
      throw new Error(`${description}必须引用已批准且未过期的参考资产版本。`);
    }
    return ref;
  };

  if (taskType === 'CHARACTER_VIEWS' || taskType === 'CHARACTER_EXPRESSION' || taskType === 'CHARACTER_DERIVATIVE') {
    requireReference((ref) => ref.asset_type === 'character' && ref.role === 'master', '人物衍生图');
  }
  if (taskType === 'SCENE_VARIANT') {
    requireReference((ref) => ref.asset_type === 'scene' && ref.role === 'master', '场景状态变体');
  }
  if (taskType === 'STORYBOARD') {
    const requiredTypes = new Set(parts.required_reference_types ?? ['scene']);
    if (parts.scene_id) requiredTypes.add('scene');
    if (parts.character_ids?.length || parts.characters?.length) requiredTypes.add('character');
    if (parts.prop_ids?.length || parts.props?.length) requiredTypes.add('prop');
    for (const type of requiredTypes) {
      requireReference((ref) => ref.asset_type === type, `分镜的 ${type} 资产`);
    }
    if (!references.length) throw new Error('分镜图必须引用已审核的人物、场景或道具资产。');
  }
  return references;
}

export function buildPrompt(style = {}, parts = {}, requestedType = parts.task_type ?? 'CHARACTER_ASSET') {
  const taskType = requestedType === 'ASSET'
    ? ({ scene: 'SCENE_MASTER', prop: 'PROP_ASSET' }[parts.asset_type] ?? 'CHARACTER_ASSET')
    : requestedType === 'STORYBOARD' ? 'STORYBOARD' : requestedType;
  if (!TASK_TYPES.has(taskType)) throw new Error(`不支持的图片任务类型：${taskType}`);
  if (taskType !== 'STORYBOARD' && (parts.action || parts.plot_context || parts.story_context)) {
    throw new Error('资产图禁止带入剧情动作或剧情背景；剧情内容请使用 STORYBOARD 模式。');
  }
  if (taskType === 'SCENE_MASTER' && (parts.character_ids?.length || parts.characters?.length)) {
    throw new Error('场景标准图不能自动带入剧情人物。');
  }
  const references = assertApprovedReferences(taskType, parts);
  const referenceVersionIds = references.map((ref) => ref.version_id).filter(Boolean);
  const factionRule = parts.faction_costume_rule;
  const sections = [
    ['全局画风', style.visual_style],
    ['世界观和时代约束', [
      ...lines(style.era_constraints?.allowed_elements).map((value) => `允许：${value}`),
      ...lines(style.era_constraints?.forbidden_elements).map((value) => `禁止：${value}`),
    ].join('；')],
    ['势力视觉约束', [parts.faction_visual_constraints, factionRule && [
      `势力等级 ${factionRule.rank ?? ''}`,
      `面料等级 ${factionRule.material_grade ?? 'UNKNOWN'}`,
      `工艺等级 ${factionRule.craftsmanship_grade ?? 'UNKNOWN'}`,
      `纹样 ${factionRule.pattern ?? ''}`,
      `身份标识等级 ${factionRule.insignia_grade ?? 'UNKNOWN'}`,
      `配饰等级 ${factionRule.accessory_grade ?? 'UNKNOWN'}`,
      `正式程度 ${factionRule.garment_formality ?? ''}`,
      `服装场景 ${factionRule.costume_context ?? ''}`,
    ].filter(Boolean).join('；')].filter(Boolean).join('；')],
    ['人物身份锚点', [
      parts.identity_anchor_id && `锚点 ${parts.identity_anchor_id}`,
      parts.identity_anchor,
      parts.identity_features,
    ].filter(Boolean).join('；')],
    ['人物时期和服装状态', [
      parts.appearance_period && `时期 ${parts.appearance_period}`,
      parts.costume_variant && `服装变体 ${parts.costume_variant}`,
      parts.costume_state,
      parts.transformation_type && `变化类型 ${parts.transformation_type}`,
    ].filter(Boolean).join('；')],
    ['场景/道具约束', [parts.scene_constraints, parts.prop_constraints].filter(Boolean).join('；')],
    ['当前生成任务', [
      `类型 ${taskType}`,
      parts.subject,
      parts.details,
      parts.task_description,
      taskType === 'CHARACTER_DERIVATIVE' ? '保持主参考图人物身份、脸型及核心识别特征；普通换装不改变身份。' : '',
      taskType === 'SCENE_MASTER' ? '只生成场景标准资产，不加入剧情人物、剧情动作或叙事事件。' : '',
      taskType === 'CHARACTER_VIEWS' ? '基于已批准人物主参考图生成一致的多视角，不重新设计身份。' : '',
    ].filter(Boolean).join('；')],
    ['视图和构图', [parts.view_type, parts.view, parts.composition].filter(Boolean).join('；')],
    ['氛围光影', [parts.atmosphere, ...lines(style.lighting_rules)].filter(Boolean).join('；')],
    ['质量约束', lines(style.quality_constraints).join('；')],
    ['已批准参考版本', referenceVersionIds.join('、')],
  ].filter(([, value]) => text(value));
  const negativePrompt = [...lines(style.negative_constraints), ...lines(parts.negative_constraints)].join('；');
  const fullPrompt = [
    ...sections.map(([label, value]) => `${label}：${value}`),
    negativePrompt ? `负面提示词：${negativePrompt}` : '',
  ].filter(Boolean).join('\n');

  return {
    task_type: taskType,
    task_id: parts.task_id ?? null,
    entity_ids: {
      character_ids: parts.character_ids ?? (parts.character_id ? [parts.character_id] : []),
      scene_id: parts.scene_id ?? null,
      prop_ids: parts.prop_ids ?? [],
    },
    identity_anchor_id: parts.identity_anchor_id ?? null,
    appearance_period: parts.appearance_period ?? null,
    costume_variant: parts.costume_variant ?? null,
    faction_rank: factionRule?.rank ?? parts.faction_rank ?? null,
    prompt_version: PROMPT_VERSION,
    sections: Object.fromEntries(sections),
    prompt: fullPrompt,
    negative_prompt: negativePrompt,
    reference_asset_version_ids: referenceVersionIds,
    reference_files: references.map((ref) => ({ version_id: ref.version_id, file: ref.file ?? null })),
  };
}
