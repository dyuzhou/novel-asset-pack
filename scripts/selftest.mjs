#!/usr/bin/env node
/**
 * novel-asset-pack 自测 —— 全部确定性逻辑，不调模型、不耗额度。
 * 覆盖：init 骨架、seed 搬运、18 组质量门（正反例）、提示词拼装、HTML/MD 渲染冒烟、示例资产通过全门。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_QUALITY, DEFAULT_NEGATIVE,
  assemblePrompt, gateList, validateAssets,
  initSkeleton, seedFromOutline, renderHtml, renderMarkdown,
} from './asset-pack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}
function throwsWith(name, make, re) {
  const problems = validateAssets(make());
  assert(problems.length > 0, name + '：期望有违规但全部通过');
  assert.match(problems.join('\n'), re, name + '：违规信息未命中 ' + re);
  passed++;
  console.log('  ✓ ' + name);
}

const ANCHOR = '3D 写实国风仙侠，UE5 引擎质感，PBR 材质，电影级光影，低饱和厚重色调，人物比例写实，画面稳定统一，禁止 Q 版、卡通渲染、过度美颜';
const BODY_BASE = '中景平视；少年男修，相貌普通，肤色微黑，中等身形偏瘦，穿青灰色粗布弟子服，腰系木牌；山门石阶前，云雾缭绕，古松与青石门楼可见；布料褶皱与石阶苔痕清晰；侧逆光，冷色晨雾，轮廓光轻微；';
const BODY_DERIVED = '中景平视；青年男修，相貌普通，肤色微黑，中等身形清瘦，穿米黄色道袍，腰系玉牌；宗门庭院前，枫树环绕；布料褶皱与玉牌光泽清晰；柔光，暖色午后；';
const BODY_FACTION1 = '平视全景；江湖门派山门；青石门楼立在崖壁要道，铁索吊桥连栈道；门楼雕纹、铁索与木板细节清晰；晨雾侧光，冷色调，远景山影层叠；';
const BODY_FACTION2 = '平视全景；修仙宗门庭院；黄枫夹道石桥连殿，殿宇错落；枫叶与殿宇彩绘清晰；午后柔光，暖色调，轻雾浮空；';
const BODY_SCENE = '平视全景；高山门派山门；百丈崖壁下青石门楼，铁索吊桥连栈道；崖壁纹理与门楼雕纹清晰；侧逆光，晨雾体积光；';
const BODY_PROP = '特写俯视；粗木腰牌；散落青石桌面，麻绳垂落；木纹与刻痕清晰；柔和顶光，浅景深；';

/** 一份能过全部质量门的最小文档。 */
function makeValid() {
  return {
    meta: { drama: '测试项目', created: '2026-01-01' },
    project: {
      aspect_ratio: '16:9',
      style_anchor: ANCHOR,
      faithful: true,
      quality_common: DEFAULT_QUALITY,
      negative_common: DEFAULT_NEGATIVE,
    },
    world: {
      background: '凡人修仙世界，江湖门派与修仙宗门并存',
      power_system: '炼气、筑基、结丹……境界分明',
      social_structure: '凡人王朝之下，修仙门派超然其上',
      architecture: '青石台基，木构殿宇，飞檐斗拱',
      costume_rules: '门派按阶级配袍，粗麻至绸缎',
      color_system: '低饱和青灰为底，暖金点缀，冷雾环境色',
    },
    factions: [
      {
        id: 'f_qixuan', name: '七玄门', positioning: '越国江湖门派',
        class_system: ['记名弟子', '外门弟子', '内门弟子', '堂主', '门主'],
        costume_rule: '杂役短打青黑，弟子青灰粗麻，堂主以上玄色绸缎',
        main_color: '青灰', pattern: '玄字纹',
        prompt_body: BODY_FACTION1,
      },
      {
        id: 'f_huangfeng', name: '黄枫谷', positioning: '越国修仙宗门',
        class_system: ['弟子', '长老', '掌门'],
        costume_rule: '弟子米黄道袍，长老加披帛玉饰',
        main_color: '米黄', pattern: '枫叶纹',
        prompt_body: BODY_FACTION2,
      },
    ],
    characters: [
      {
        id: 'c_hanli', name: '韩立', gender: '男', age: '16 岁',
        identity: '七玄门杂役出身少年', class: '记名弟子',
        faction_id: 'f_qixuan', personality: '谨慎坚韧，藏拙',
        identity_anchor: '相貌普通，肤色微黑，鼻梁挺直，中等身形偏瘦',
        fixed_features: '',
        periods: [
          {
            period_name: '七玄门杂役期', is_base: true, generation_mode: 'fresh_generation',
            appearance: '少年，肤色微黑，身形偏瘦', costume: '青灰色粗布弟子服，腰系木牌',
            prompt_body: BODY_BASE,
          },
          {
            period_name: '黄枫谷弟子期', is_base: false, generation_mode: 'reference_img2img',
            reference_image: 'c_hanli/period-01.png', variation_reason: '加入黄枫谷，改穿米黄道袍，气质沉稳',
            appearance: '青年，相貌不变，身形清瘦', costume: '米黄色道袍，腰系玉牌',
            prompt_body: BODY_DERIVED,
          },
        ],
      },
    ],
    scenes: [{
      id: 's_gate', name: '七玄门山门', era: '七玄门时期', location: '越国彩霞山',
      atmosphere: '肃穆清冷', lighting: '晨雾侧逆光',
      key_elements: ['百丈崖壁', '青石门楼', '铁索吊桥'],
      prompt_body: BODY_SCENE,
    }],
    props: [{
      id: 'p_tag', name: '弟子木牌', owner: '七玄门弟子', material: '粗木',
      usage: '身份标识', source_ref: { chapter: 2, quote: '腰间挂着一方木牌' },
      prompt_body: BODY_PROP,
    }],
    pipeline: {
      steps: [
        { id: 'config', label: '项目配置与风格锚点', status: 'done', note: '' },
        { id: 'world', label: '世界观与势力', status: 'done', note: '' },
        { id: 'report', label: 'HTML 报告输出', status: 'pending', note: '' },
      ],
    },
  };
}

console.log('== 基准：完整文档通过全部质量门 ==');
ok('makeValid() 零违规', () => {
  const problems = validateAssets(makeValid());
  assert.deepStrictEqual(problems, [], '意外违规：\n' + problems.join('\n'));
});
ok('gateList 数量 > 15（覆盖面足够）', () => {
  assert.ok(gateList(makeValid()).length > 15);
});

console.log('== P 组：项目配置 ==');
throwsWith('P1 锚点过短', () => { const d = makeValid(); d.project.style_anchor = '太短'; return d; }, /P1/);
throwsWith('P2 画幅格式非法', () => { const d = makeValid(); d.project.aspect_ratio = '16-9'; return d; }, /P2/);
throwsWith('P3 负面词为空', () => { const d = makeValid(); d.project.negative_common = ''; return d; }, /P3/);
throwsWith('P4 faithful=false 拒绝', () => { const d = makeValid(); d.project.faithful = false; return d; }, /P4/);

console.log('== W 组：世界观 ==');
throwsWith('W1 缺色彩体系', () => { const d = makeValid(); d.world.color_system = ''; return d; }, /W1/);

console.log('== F 组：势力 ==');
throwsWith('F1 缺纹样', () => { const d = makeValid(); d.factions[0].pattern = ''; return d; }, /F1/);
throwsWith('F2 主色纹样全同', () => { const d = makeValid(); d.factions[1].main_color = '青灰'; d.factions[1].pattern = '玄字纹'; return d; }, /F2/);
throwsWith('F3 势力引用不存在', () => { const d = makeValid(); d.characters[0].faction_id = 'f_no'; return d; }, /F3/);

console.log('== C 组：角色与时期 ==');
throwsWith('C1 缺性格', () => { const d = makeValid(); d.characters[0].personality = ''; return d; }, /C1/);
throwsWith('C2 锚点过短', () => { const d = makeValid(); d.characters[0].identity_anchor = '普通脸'; return d; }, /C2/);
throwsWith('C3 两个基准期', () => {
  const d = makeValid();
  d.characters[0].periods[1].is_base = true;
  return d;
}, /C3/);
throwsWith('C5 衍生期缺参考图', () => { const d = makeValid(); d.characters[0].periods[1].reference_image = ''; return d; }, /C5/);
throwsWith('C5 衍生期默认重开新图被拒', () => {
  const d = makeValid();
  d.characters[0].periods[1].generation_mode = 'fresh_generation';
  return d;
}, /C5/);
ok('C5 原著明确描写幻化可重开（source_described=true）', () => {
  const d = makeValid();
  d.characters[0].periods[1].generation_mode = 'fresh_generation';
  d.characters[0].periods[1].source_described = true;
  assert.deepStrictEqual(validateAssets(d), []);
});
throwsWith('C6 固定特征未延续', () => {
  const d = makeValid();
  d.characters[0].fixed_features = '左脸刀疤';
  return d;
}, /C6/);
ok('C6 固定特征写进每个时期即通过', () => {
  const d = makeValid();
  d.characters[0].fixed_features = '左脸刀疤';
  d.characters[0].periods[0].prompt_body = BODY_BASE.replace('相貌普通', '相貌普通，左脸刀疤');
  d.characters[0].periods[1].prompt_body = BODY_DERIVED.replace('相貌普通', '相貌普通，左脸刀疤');
  assert.deepStrictEqual(validateAssets(d), []);
});

console.log('== E 组：prompt_body（对所有资产生效，抽两个代表）==');
throwsWith('E1 段数不足', () => { const d = makeValid(); d.characters[0].periods[0].prompt_body = '中景平视；主体；背景；'; return d; }, /E1/);
throwsWith('E2 首段无视角词', () => { const d = makeValid(); d.characters[0].periods[0].prompt_body = '少年男修；主体；背景；细节；光影；'; return d; }, /E2/);
throwsWith('E3 手写风格词 UE5', () => {
  const d = makeValid();
  d.characters[0].periods[0].prompt_body = BODY_BASE.replace('中景平视', 'UE5 引擎质感，中景平视');
  return d;
}, /E3/);
throwsWith('E3 手写质量词 8K', () => {
  const d = makeValid();
  d.scenes[0].prompt_body = BODY_SCENE.replace('平视全景', '8K 超清，平视全景');
  return d;
}, /E3/);
throwsWith('E3 手写图生图前缀', () => {
  const d = makeValid();
  d.characters[0].periods[1].prompt_body = BODY_DERIVED.replace('中景平视', '以参考图为基础，中景平视');
  return d;
}, /E3/);

console.log('== S / R 组：场景与道具 ==');
throwsWith('S1 关键元素不足', () => { const d = makeValid(); d.scenes[0].key_elements = ['石阶']; return d; }, /S1/);
throwsWith('R1 缺用途', () => { const d = makeValid(); d.props[0].usage = ''; return d; }, /R1/);

console.log('== G 组：结构 ==');
throwsWith('G1 id 重复', () => { const d = makeValid(); d.props[0].id = 's_gate'; return d; }, /G1/);
throwsWith('G2 非法 status', () => { const d = makeValid(); d.pipeline.steps[0].status = 'ok'; return d; }, /G2/);

console.log('== 提示词拼装（确定性） ==');
ok('基准期：锚点+五段+质量词+负面词', () => {
  assert.strictEqual(
    assemblePrompt('锚A', 'v；s；b；d；l', '质量Q', '负面N'),
    '锚A；v；s；b；d；l；质量Q；负面提示词：负面N',
  );
});
ok('衍生期：注入图生图前缀 + 变化依据', () => {
  assert.strictEqual(
    assemblePrompt('锚A', 'v；s；b；d；l', '质量Q', '负面N', { img2img: true, reason: '换了袍子' }),
    '以参考图为基础，保持面部特征与体型不变，仅调整：换了袍子；锚A；v；s；b；d；l；质量Q；负面提示词：负面N',
  );
});
ok('注入前缀锚点自身带尾分号会被清理', () => {
  const s = assemblePrompt('锚A；', 'v；s；b；d；l', '质量Q', '负面N');
  assert.ok(!s.includes('；；'), s);
});

console.log('== init / seed ==');
ok('init 骨架默认值齐备', () => {
  const d = initSkeleton('测试剧');
  assert.strictEqual(d.project.aspect_ratio, '16:9');
  assert.strictEqual(d.project.faithful, true);
  assert.strictEqual(d.project.negative_common, DEFAULT_NEGATIVE);
  assert.strictEqual(d.project.style_anchor, '', '风格锚点必须留给用户确认后填');
  assert.strictEqual(d.pipeline.steps.length, 7);
});
ok('seed 搬运 outline.json 事实', () => {
  const doc = seedFromOutline({
    source: { title: '渡口' },
    characters: [{ id: 'c1', name: '老船公', role: '摆渡人', arc: '从不肯渡人到渡人', tier: '主角' }],
    scenes: [{ id: 's1', name: '渡口', primary: true }],
    props: [{ id: 'p1', name: '皮箱', function: '承载身世', beatIds: ['b1', 'b2'] }],
  }, '渡口');
  assert.strictEqual(doc.characters[0].name, '老船公');
  assert.strictEqual(doc.characters[0].identity, '摆渡人');
  assert.strictEqual(doc.characters[0].class, '主角');
  assert.strictEqual(doc.characters[0].periods[0].is_base, true);
  assert.strictEqual(doc.scenes[0].name, '渡口');
  assert.strictEqual(doc.props[0].usage, '承载身世');
  assert.ok(doc.props[0].seedNote.includes('b1'));
});

console.log('== 渲染冒烟 ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nap-test-'));
try {
  ok('HTML：JSON 注入 + 导航 + 锚点 + 拼装提示词齐全', () => {
    const html = renderHtml(makeValid(), { jsonDir: tmp });
    assert.ok(html.includes('window.__ASSET_REPORT__'));
    for (const t of ['进度总览', '项目配置', '世界观', '势力与阶级', '角色资产', '角色时期变化', '场景资产', '道具资产', '提示词库']) {
      assert.ok(html.includes(t), '缺面板：' + t);
    }
    assert.ok(html.includes('3D 写实国风仙侠'));
    assert.ok(html.includes('以参考图为基础，保持面部特征与体型不变，仅调整：加入黄枫谷'));
    assert.ok(html.includes('负面提示词：'));
    assert.ok(html.includes('img-ph'), '无图时应渲染占位框');
  });
  ok('HTML：图片存在则把 URL 写进 JSON 注入（页面 JS 运行时渲染 img）', () => {
    fs.mkdirSync(path.join(tmp, 'images', 'c_hanli'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'images', 'c_hanli', 'period-01.png'), 'png');
    const d = makeValid();
    d.characters[0].periods[0].image = 'c_hanli/period-01.png';
    const html = renderHtml(d, { jsonDir: tmp });
    assert.ok(html.includes('"img":"images/c_hanli/period-01.png"'), '存在的图片应进 payload');
    const d2 = makeValid();
    d2.characters[0].periods[0].image = 'c_hanli/missing.png';
    const html2 = renderHtml(d2, { jsonDir: tmp });
    assert.ok(!html2.includes('"img":"images/c_hanli/missing.png"'), '不存在的图片应为 null（渲染占位框）');
  });
  ok('HTML：脚本安全（</script> 已转义）', () => {
    const d = makeValid();
    d.world.background = '危险字符串 </script><script>alert(1)</script>';
    const html = renderHtml(d, { jsonDir: tmp });
    assert.ok(!html.includes('</script><script>alert'), 'JSON 注入未转义');
  });
  ok('Markdown：结构与完整提示词', () => {
    const md = renderMarkdown(makeValid());
    for (const t of ['## 项目配置', '## 世界观', '## 势力与阶级', '## 角色资产', '## 场景资产', '## 道具资产', '负面提示词：']) {
      assert.ok(md.includes(t), '缺小节：' + t);
    }
    assert.ok(md.includes('以参考图为基础'));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('== 示例资产（examples/）通过全门 ==');
ok('示例 json 全部质量门通过', () => {
  const examplePath = path.join(here, '..', 'examples', '凡人修仙传-开篇-assets.json');
  const doc = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  const problems = validateAssets(doc);
  assert.deepStrictEqual(problems, [], '示例资产违规：\n' + problems.join('\n'));
});

console.log(`\nselftest passed：${passed} 项断言`);
