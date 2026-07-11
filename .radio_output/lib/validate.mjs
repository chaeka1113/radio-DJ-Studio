/**
 * lib/validate.mjs — 파이프라인 핵심 JSON 스키마 검증
 * 실패 시 명확한 메시지와 함께 process.exit(1)
 */

export function validateScripts(data, { minScriptLen = 700 } = {}) {
  const errors = [];

  if (!Array.isArray(data?.episodes) || data.episodes.length < 3) {
    errors.push(`episodes 배열 ${data?.episodes?.length ?? 0}개 — 최소 3개 필요`);
  }

  (data?.episodes ?? []).forEach((ep, i) => {
    const tag = `episodes[${i}]`;
    if (!ep.id)                              errors.push(`${tag}.id 없음`);
    if (!ep.title?.trim())                   errors.push(`${tag}.title 비어있음`);
    if (!ep.script?.trim())                  errors.push(`${tag}.script 비어있음`);
    else if (ep.script.length < minScriptLen)
      errors.push(`${tag}.script ${ep.script.length}字 — ${minScriptLen}字 미만`);
  });

  // 에피소드 간 캐릭터 이름 유니크성 검사
  const charNames = (data?.episodes ?? []).map(ep => ep.character?.name?.trim()).filter(Boolean);
  const nameSeen = new Set();
  for (const n of charNames) {
    if (nameSeen.has(n)) {
      errors.push(`캐릭터 이름 중복: "${n}" — 3개 에피소드 이름은 모두 달라야 함`);
    }
    nameSeen.add(n);
  }

  if (errors.length > 0) {
    console.error('❌ [validate] 01_scripts.json 스키마 오류:');
    errors.forEach(e => console.error(`   · ${e}`));
    process.exit(1);
  }
  console.log(`✅ [validate] 01_scripts.json 검증 통과 (${data.episodes.length}개 에피소드)`);
}

export function validateDjScript(data) {
  const errors = [];

  if (!data?.show_opening?.trim())  errors.push('show_opening 비어있음');
  if (!data?.show_closing?.trim())  errors.push('show_closing 비어있음');

  if (!Array.isArray(data?.episodes) || data.episodes.length < 3) {
    errors.push(`episodes 배열 ${data?.episodes?.length ?? 0}개 — 최소 3개 필요`);
  }

  (data?.episodes ?? []).forEach((ep, i) => {
    const tag = `episodes[${i}]`;
    if (!ep.id)                    errors.push(`${tag}.id 없음`);
    if (!ep.dj_reaction?.trim())   errors.push(`${tag}.dj_reaction 비어있음`);
  });

  if (errors.length > 0) {
    console.error('❌ [validate] 02_dj_script.json 스키마 오류:');
    errors.forEach(e => console.error(`   · ${e}`));
    process.exit(1);
  }
  console.log(`✅ [validate] 02_dj_script.json 검증 통과`);
}
