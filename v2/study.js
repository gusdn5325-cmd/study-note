// 하루 학습 흐름: 오늘 할 일 → 서브노트 읽기 → 가리고 떠올리기 → 시간 재고 쓰기 → 모범답안 비교 → 복습 예약
// 내용은 data.js(STUDY_DATA), 채점은 scoring.js(02 앱 복사본)를 쓴다. 기록은 이 브라우저(localStorage)에 저장.
'use strict';
const D = window.STUDY_DATA;
const KEY = 'pe-study-v1';
const LADDER = [1, 3, 7, 14, 30];
const STEPS = ['read', 'recall', 'write', 'compare', 'review'];
const SHORT = { read: '읽기', recall: '떠올리기', write: '쓰기', compare: '비교', review: '복습' };

// scoring.js가 쓰는 전역 db (02 앱과 같은 모양) — 주제별 카드, 핵심어 가중치(IDF)는 전체 답안 기준
var db = { topics: [], cards: D.topics.map(t => ({ id: t.prefix, name: t.subnote.topic, skel: [], ex: t.answers.map(a => ({ q: a.question, a: a.answer, g: a.gyosi, h: a.source && a.source.h, n: a.source && a.source.n, _id: a.id })) })) };
let TI = 0, SN = null, ANS = [], card = null;
function setTopic(i) { TI = Math.max(0, Math.min(D.topics.length - 1, i)); SN = D.topics[TI].subnote; ANS = D.topics[TI].answers; card = db.cards[TI]; }
const exOf = id => card.ex.find(e => e._id === id);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = iso => new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

function load() { try { return { cards: {}, attempts: [], drafts: {}, days: {}, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { cards: {}, attempts: [], drafts: {}, days: {} }; } }
let S = load();
function save() { try { if (typeof MK !== 'undefined') S.mockNow = MK; localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('브라우저 저장소를 쓸 수 없습니다. 기록 내보내기를 이용하세요'); } }
let toastT = null;
function toast(t, undo) {
  const el = $('toast'); el.innerHTML = `<span>${esc(t)}</span>${undo ? '<button type="button" id="toastUndo">되돌리기</button>' : ''}`;
  el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), undo ? 6000 : 4000);
  if (undo) $('toastUndo').onclick = () => { undo(); el.classList.remove('on'); };
}

// ── 오늘의 추천: 몫 채우기 + 약점 가중 ──
// 비중 = (누적 출제 + k × 최근 6회 출제) × 약점계수, k는 평소 2·시험 4주 전부터 4
// 매일 '비중 × 지금까지 공부한 날 수' 대비 가장 덜 한 주제를 고른다(운에 의한 치우침·긴 공백 방지). 복습이 쌓였으면 그 주제 먼저.
const EXAM = D.examDate ? new Date(D.examDate + 'T00:00:00') : null;
const daysToExam = () => EXAM ? Math.ceil((EXAM - today()) / 86400000) : null;
// 시험일이 공고로 확인되기 전에는 '미확정'으로 보이고, 남은 날은 임시 날짜 기준이라고 밝힌다
const examLabel = () => { const d = daysToExam(); if (d === null) return ''; return D.examConfirmed ? ` · 시험까지 D-${d}` : ` · 시험일 미확정(공고 전, 임시 ${EXAM.getMonth() + 1}월 ${EXAM.getDate()}일 기준 D-${d})`; };
function backupNote() {
  if (!S.attempts.length && !Object.keys(S.cards).length) return '';
  const last = S.lastExport ? Math.floor((today() - new Date(S.lastExport)) / 86400000) : null;
  if (last !== null && last < 7) return '';
  return `<p class="note warnline">${last === null ? '아직 기록을 내보낸 적이 없습니다.' : `마지막 내보내기 ${last}일 전.`} 위쪽 '기록 관리'에서 내보내 두세요.</p>`;
}
const recentK = () => { const d = daysToExam(); return d !== null && d <= 28 ? 4 : 2; };
const baseWeight = t => (t.freq ? t.freq.tot + recentK() * t.freq.rec : 1);
function weakness(i) {
  const lv = D.topics[i].answers.map(a => S.cards[a.id]).filter(Boolean).map(c => c.level);
  if (!lv.length) return 1;
  const avg = lv.reduce((a, b) => a + b, 0) / lv.length;   // 0(다시)~4(쉬움)
  return Math.max(0.7, Math.min(1.5, 1 + (2 - avg) * 0.25));
}
const weightOf = (t, i) => baseWeight(t) * weakness(i);
function studiedDays(i, exceptKey) {
  const pre = '|' + D.topics[i].prefix;
  return Object.entries(S.days).filter(([k, v]) => k.endsWith(pre) && !k.startsWith(exceptKey) && v.done && v.done.length).length;
}
function dueCount(i) { return D.topics[i].answers.filter(a => isDue(a.id)).length; }
function autoTopic() {
  S.autoDay = S.autoDay || {};
  const k = dayKey();
  const kept = S.autoDay[k];   // 이전 버전(출제 비례 랜덤)이 저장한 값은 형식이 달라 다시 뽑는다
  if (kept && kept.i < D.topics.length && (kept.why === 'due' || (kept.why === 'quota' && typeof kept.target === 'number'))) return kept;
  const dues = D.topics.map((_, i) => dueCount(i)), maxDue = Math.max(...dues);
  let pick;
  if (maxDue > 0) pick = { i: dues.indexOf(maxDue), why: 'due', n: maxDue };
  else {
    const ys = new Date(); ys.setDate(ys.getDate() - 1); const prev = (S.autoDay[dayKey(ys)] || {}).i;
    const ws = D.topics.map((t, i) => weightOf(t, i)), sum = ws.reduce((a, b) => a + b, 0);
    const done = D.topics.map((_, i) => studiedDays(i, k)), total = done.reduce((a, b) => a + b, 0) + 1;
    let best = -1, bestGap = -Infinity;
    ws.forEach((w, i) => { if (i === prev && D.topics.length > 1) return; const gap = w / sum * total - done[i]; if (gap > bestGap + 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && w > ws[best])) { best = i; bestGap = gap; } });
    pick = { i: best, why: 'quota', share: ws[best] / sum, done: done[best], target: ws[best] / sum * total, weak: weakness(best) };
  }
  S.autoDay[k] = pick; save(); return pick;
}
const isAuto = () => S.topicMode !== 'manual';

// ── 오늘 할 일 ──
function todayState() { const k = `${dayKey()}|${D.topics[TI].prefix}`; S.days[k] = S.days[k] || { done: [], q: null, recall: null }; return S.days[k]; }
function isDue(key) { const c = S.cards[key]; return !!c && new Date(c.next) <= today(); }
function pickQuestion() {
  const t = todayState();
  if (t.q && ANS.some(a => a.id === t.q)) return t.q;
  const due = ANS.filter(a => isDue(a.id)).sort((a, b) => new Date(S.cards[a.id].next) - new Date(S.cards[b.id].next));
  const fresh = ANS.filter(a => !S.cards[a.id]).sort((a, b) => ((a.status === '원문 확인' ? 0 : 1) - (b.status === '원문 확인' ? 0 : 1)) || (((b.source && b.source.h) || 0) - ((a.source && a.source.h) || 0)));
  const w = wantGyosi(), fit = x => !w || (w === 1 ? x.gyosi === 1 : x.gyosi !== 1);
  const pick = (due.find(fit) || due[0] || fresh.find(fit) || fresh[0] || ANS[0]).id;
  t.q = pick; save(); return pick;
}
function markDone(step) { const t = todayState(); if (!t.done.includes(step)) { t.done.push(step); save(); } renderNav(); }
const answerOf = id => ANS.find(a => a.id === id);
const minutes = a => a.gyosi === 1 ? 10 : 25;

function renderToday() {
  const t = todayState(), a = answerOf(pickQuestion());
  const due = ANS.filter(x => isDue(x.id)).length, seen = ANS.filter(a => S.cards[a.id]).length;
  const names = { read: '서브노트 읽기', recall: '가리고 떠올리기', write: '시간 재고 쓰기', compare: '모범답안과 비교', review: '복습 예약' };
  $('v-today').innerHTML = `
    <h1>오늘 할 일</h1><p class="sub">${esc(SN.topic)}${examLabel()}${due ? ` · 복습 ${due}건` : ''}</p>
    ${backupNote()}
    ${goalHtml()}
    ${isAuto() ? (() => { const p = autoTopic(), f = D.topics[TI].freq || {};
      const why = p.why === 'due' ? `복습할 문항이 ${p.n}건 쌓여 있어 이 주제를 먼저 골랐습니다.` : `이 주제는 출제 비중 ${Math.round(p.share * 100)}%(누적 ${f.tot}회, 최근 6회 ${f.rec}회)입니다. 지금까지 ${p.done}일 공부해 비중 대비 가장 덜 한 주제라서 골랐습니다.${p.weak > 1.05 ? ' 복습 평가가 낮아 더 자주 나옵니다.' : p.weak < 0.95 ? ' 잘 아는 주제라 덜 나옵니다.' : ''}${recentK() === 4 ? ' 시험 4주 전이라 최근 출제를 더 무겁게 봅니다.' : ''}`;
      return `<details class="why"><summary>왜 이 주제?</summary><p class="note">${why} 공부한 문항 ${seen}/${ANS.length}.</p></details>`; })() : `<p class="note">공부한 문항 ${seen}/${ANS.length}</p>`}
    <div class="todo">${STEPS.map((s, i) => `<div class="${t.done.includes(s) ? 'done' : ''}"><b>${i + 1}단계${t.done.includes(s) ? ' ✓' : ''}</b><span class="lbl">${names[s]}</span><span class="sh">${SHORT[s]}</span></div>`).join('')}</div>
    <div class="panel"><div class="row"><span class="badge">${a.gyosi}교시 · ${a.max}점 · ${minutes(a)}분</span>${badge(a)}${isDue(a.id) ? '<span class="badge due">복습</span>' : ''}<span class="badge">${esc(a.type)}</span></div>
      <p class="q">${esc(a.question)}</p>
      <p class="note">오늘의 문제입니다. 1·2단계로 서브노트를 익힌 뒤 3단계에서 이 문제를 씁니다.</p>
      <div class="row"><button class="primary" data-go="${nextStep()}">${t.done.length ? '이어서 하기' : '시작하기'}</button><button class="ghost" data-go="list">다른 문제 고르기</button></div></div>
    ${D.topics[TI].related.length ? `<h2>최근 기출 중 이 주제와 관련된 문제</h2><div class="panel">${D.topics[TI].related.map(r => {
      const has = ANS.some(x => x.source && x.source.h === r.h && x.source.g === r.g && x.source.n === r.n);
      return `<div class="list-item"><span class="badge">${r.h}회 ${r.g}교시 ${r.n}번</span><span>${esc(r.q)}</span>${has ? '<span class="badge ok">답안 있음</span>' : '<span class="badge draft">답안 없음</span>'}</div>`;
    }).join('')}</div>` : ''}`;
}
function nextStep() { const t = todayState(); return STEPS.find(s => !t.done.includes(s)) || 'review'; }
function badge(a) { return a.status === '원문 확인' ? '<span class="badge ok">원문 확인</span>' : `<span class="badge draft">${esc(a.status)}</span>`; }

// ── 서브노트 그림: SVG 그림 + 흐름 상자(글자 그림은 글꼴에 따라 깨져서 쓰지 않음) ──
function diagHtml(sn) {
  const d = sn.diag;
  if (!d) return `<pre class="fig">${esc(sn.figure || '')}</pre>`;
  const svgs = (d.svg || []).map(id => (D.figures || []).find(f => f.id === id)).filter(Boolean)
    .map(f => `<figure class="figbox"><div class="svgbox" role="img" aria-label="${esc(f.title)}">${f.svg}</div><figcaption><b>${esc(f.title)}</b></figcaption>${(f.steps || []).length ? `<details><summary>그리는 순서</summary><ol class="outline">${f.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}</figure>`).join('');
  const rows = (d.rows || []).map(r => r.par ? `<div class="flowrow par">${r.par.map(x => `<span class="flowbox">${esc(x)}</span>`).join('')}</div>` : `<div class="flowrow">${r.map(x => `<span class="flowbox">${esc(x)}</span>`).join('<span class="flowarr" aria-hidden="true">→</span>')}</div>`)
    .join('<div class="flowdown" aria-hidden="true">↓</div>');
  const notes = (d.notes || []).length ? `<ul class="flownotes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `${svgs}${rows ? `<div class="flow">${rows}</div>` : ''}${notes}`;
}
// ── 1. 서브노트 읽기 ──
function subnoteHtml(hide) {
  const keys = [...SN.keywords].sort((a, b) => b.length - a.length);
  const blankify = text => {
    if (!hide) return esc(text);
    const re = new RegExp(`(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|\\d+(?:\\.\\d+)?\\s*(?:년|%|개))`, 'g');
    let out = '', last = 0;
    for (const m of text.matchAll(re)) { out += esc(text.slice(last, m.index)) + `<button class="blank" type="button" aria-label="빈칸, 눌러서 보기"><span aria-hidden="true">${esc(m[0])}</span></button>`; last = m.index + m[0].length; }
    return out + esc(text.slice(last));
  };
  const cell = v => hide ? `<button class="blank" type="button" aria-label="빈칸, 눌러서 보기"><span aria-hidden="true">${esc(v)}</span></button>` : esc(v);
  return `
    <h2>① 정의</h2><p class="def">${blankify(SN.definition)}</p>
    <h2>② 목차 (기본 뼈대)</h2><ol class="outline">${SN.outline.map(o => `<li>${blankify(o)}</li>`).join('')}</ol>
    <h2>③ 핵심어</h2><div class="chips">${SN.keywords.map(k => hide ? `<button class="blank" type="button" aria-label="빈칸, 눌러서 보기"><span aria-hidden="true">${esc(k)}</span></button>` : `<span class="chip">${esc(k)}</span>`).join('')}</div>
    <h2>④ 수치·조항</h2><table><tr><th>내용</th><th>수치</th><th>근거</th></tr>${SN.facts.map(f => `<tr><td>${esc(f.item)}</td><td>${cell(f.value)}</td><td>${cell(f.basis)}</td></tr>`).join('')}</table>
    ${SN.lists.map(l => `<h2>${esc(l.title)}</h2><ol class="outline">${l.items.map(i => `<li>${cell(i)}</li>`).join('')}</ol>`).join('')}
    <h2>⑤ 그림: ${esc((SN.diag && SN.diag.title) || '흐름도')}</h2>${hide ? '<p class="note">그림은 빈 종이에 직접 그려 본 뒤 아래 버튼으로 확인합니다.</p><details><summary>그림 보기</summary>' : ''}${diagHtml(SN)}${hide ? '</details>' : ''}
    <h2>⑥ 실무 의견</h2><ol class="outline">${SN.opinions.map(o => `<li>${blankify(o)}</li>`).join('')}</ol>
    ${hide ? '' : `<h2>문제점과 개선</h2><table><tr><th>분야</th><th>문제점</th><th>개선</th></tr>${SN.problems.map(p => `<tr><td>${esc(p.field)}</td><td>${esc(p.problem)}</td><td>${esc(p.fix)}</td></tr>`).join('')}</table>
    <h2>⑦ 문제 유형별 강조할 곳</h2><table><tr><th>유형</th><th>강조</th></tr>${SN.types.map(t => `<tr><td>${esc(t.type)}</td><td>${esc(t.focus)}</td></tr>`).join('')}</table>
    <h2>⑧ 근거</h2><ul class="note">${SN.sources.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`}`;
}
// ── 그림: 손으로 1분 안에 그리는 대표 그림(그리는 순서 포함) ──
const FIGS = D.figures || [];
const figsOfTopic = () => FIGS.filter(f => f.topic === D.topics[TI].prefix);
const figsExtra = () => figsOfTopic().filter(f => !((SN.diag && SN.diag.svg) || []).includes(f.id));   // 서브노트 ⑤에 이미 나온 그림은 빼고
const figsOfAnswer = id => FIGS.filter(f => f.answers.includes(id));
const figHtml = f => `<figure class="figbox"><div class="svgbox" aria-hidden="true">${f.svg}</div><figcaption><b>${esc(f.title)}</b> · 그리는 순서</figcaption><ol class="outline">${f.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></figure>`;
function renderRead() {
  $('v-read').innerHTML = `<h1>1단계 · 서브노트 읽기</h1><p class="sub">${esc(SN.topic)} · <span class="badge ok">${esc(SN.status)}</span> · 목차와 숫자를 소리 내어 한 번 읽습니다.</p>
    <div class="panel">${subnoteHtml(false)}</div>${figsExtra().length ? `<h2>손으로 그릴 대표 그림</h2>${figsExtra().map(figHtml).join('')}` : ''}<button class="primary" data-done="read" data-go="recall">다 읽었습니다 → 2단계</button>`;
}

// ── 2. 가리고 떠올리기 ──
function renderRecall() {
  $('v-recall').innerHTML = `<h1>2단계 · 가리고 떠올리기</h1><p class="sub">빈칸을 먼저 떠올리고 눌러서 확인합니다. 다 확인한 뒤 얼마나 떠올렸는지 고릅니다.</p>
    <div class="row" style="margin-bottom:10px"><button class="ghost" id="revealAll" type="button">모두 보기</button><span class="note" id="recallCount"></span></div>
    <div class="panel" id="recallBody">${subnoteHtml(true)}</div>
    <h2>얼마나 떠올렸나요?</h2>
    <div class="rate">${[['all', '거의 다', '3단계로'], ['most', '절반 이상', '3단계로'], ['some', '절반 미만', '1단계 다시 읽기 권장'], ['none', '거의 못 함', '1단계 다시 읽기 권장']].map(([v, t, s]) => `<button type="button" data-recall="${v}"><b>${t}</b><span>${s}</span></button>`).join('')}</div>`;
  updateRecallCount();
}
function updateRecallCount() { const all = document.querySelectorAll('#recallBody .blank').length, shown = document.querySelectorAll('#recallBody .blank.shown').length; const el = $('recallCount'); if (el) el.textContent = `확인한 빈칸 ${shown}/${all}`; }

// ── 3. 시간 재고 쓰기 ──
let timer = null, remain = 0, spent = 0;
function renderWrite() {
  const a = answerOf(pickQuestion()), draft = S.drafts[a.id] || '', target = a.gyosi === 1 ? 500 : 1300;
  const pen = S.writeMode === 'pen';
  $('v-write').innerHTML = `<h1>3단계 · 시간 재고 쓰기</h1><p class="sub">모범답안을 보지 않고 씁니다. 권장 분량 ${target}자(답안지 ${a.gyosi === 1 ? '약 1.3쪽' : '3~4쪽'}).</p>
    <div class="writebar"><div class="row"><span class="badge">${a.gyosi}교시 · ${a.max}점 · ${minutes(a)}분</span><span class="timer" id="timer" role="timer">${minutes(a)}:00</span><button class="ghost" id="timerBtn" type="button">시작</button>
      ${pen ? '' : `<div class="meter" aria-hidden="true"><i id="lenBar" style="width:0"></i></div><span class="note" id="lenText">0 / ${target}자</span>`}</div><p class="q">${esc(a.question)}</p>
    <div class="modebar"><div class="seg"><button type="button" data-mode="text" class="${pen ? '' : 'on'}">글자 입력</button><button type="button" data-mode="pen" class="${pen ? 'on' : ''}">펜 손글씨</button></div>
      <span class="note">${pen ? '펜으로 씁니다. 손가락은 화면 넘기기.' : '애플펜슬로 쓰면 글자로 바뀝니다.'}</span></div>
    ${pen ? `<div class="pentools"><button class="ghost on" type="button" data-tool="pen">펜</button><button class="ghost" type="button" data-tool="eraser">지우개</button><button class="ghost" type="button" id="penUndo">되돌리기</button><button class="ghost" type="button" id="penAddPage">쪽 추가</button><button class="ghost" type="button" id="penClear">이 쪽 지우기</button>${(figsOfAnswer(a.id)[0] || figsOfTopic()[0]) ? '<button class="ghost" type="button" id="penTrace">밑그림</button>' : ''}<label><input type="checkbox" id="fingerDraw"> 손가락으로도 쓰기</label></div></div><div class="pages" id="pages"></div>`
      : `</div><textarea id="answer" aria-label="답안" placeholder="Ⅰ. 개요 → Ⅱ. 본론(번호체계) → 표·모식도 → 근거 조항 → 실무 의견">${esc(draft)}</textarea>`}
    <div class="row" style="margin-top:10px"><button class="ghost" id="saveDraft" type="button">임시저장</button><button class="primary" id="submitAnswer" type="button">작성 완료 → 4단계 비교</button></div>`;
  remain = minutes(a) * 60; spent = 0; clearInterval(timer); timer = null;
  if (pen) { PEN.open(a.id, a.gyosi === 1 ? 2 : 4); return; }
  const ta = $('answer'); const upd = () => { const n = ta.value.length; $('lenText').textContent = `${n} / ${target}자`; $('lenBar').style.width = Math.min(100, n / target * 100) + '%'; };
  let st = null; ta.addEventListener('input', () => { upd(); clearTimeout(st); st = setTimeout(() => { S.drafts[a.id] = ta.value; save(); }, 800); }); upd();
}

// ── 펜 손글씨: 획을 쪽 너비 기준 비율 좌표로 저장해 가로·세로 전환 때 다시 그린다. 저장은 IndexedDB ──
const IDB = {
  db: null,
  open() { return this.db ? Promise.resolve(this.db) : new Promise((ok, no) => { const r = indexedDB.open('pe-study-pen', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(this.db = r.result); r.onerror = () => no(r.error); }); },
  async get(k) { const d = await this.open(); return new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); },
  async set(k, v) { const d = await this.open(); return new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(true); t.onerror = () => ok(false); }); },
  async all() {   // 백업용: 손글씨 전체 {키: 값}
    const d = await this.open(); return new Promise(ok => {
      const out = {}, q = d.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => { const c = q.result; if (c) { out[c.key] = c.value; c.continue(); } else ok(out); }; q.onerror = () => ok(out);
    });
  },
};
const PEN = {
  key: null, pages: [], tool: 'pen', ro: null, t: null,
  async open(id, minPages) {
    this.key = 'draft|' + id; this.tool = 'pen';
    let saved = null; try { saved = await IDB.get(this.key); } catch (e) { saved = null; }
    this.pages = saved && saved.length ? saved : Array.from({ length: minPages }, () => []);
    this.render();
    if (this.ro) this.ro.disconnect();
    if (window.ResizeObserver) { this.ro = new ResizeObserver(() => this.redrawAll()); this.ro.observe($('pages')); }
  },
  render() {
    $('pages').innerHTML = this.pages.map((_, i) => `<div class="sheet"><canvas data-page="${i}"></canvas><span class="pno">${i + 1}쪽</span></div>`).join('');
    document.querySelectorAll('#pages canvas').forEach(c => this.bind(c)); this.redrawAll();
  },
  size(c) { const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return { w, h }; },
  redrawAll() { document.querySelectorAll('#pages canvas').forEach(c => this.redraw(c)); },
  redraw(c) {
    const { w, h } = this.size(c), g = c.getContext('2d'); g.clearRect(0, 0, w, h);
    g.strokeStyle = '#dfe6ee'; g.lineWidth = 1; const rows = 22, top = h * 0.06, gap = (h * 0.9) / rows;   // 답안지처럼 줄
    for (let i = 0; i <= rows; i++) { g.beginPath(); g.moveTo(w * 0.04, top + i * gap); g.lineTo(w * 0.96, top + i * gap); g.stroke(); }
    (this.pages[+c.dataset.page] || []).forEach(st => this.drawStroke(g, st, w));
  },
  drawStroke(g, st, w) {
    g.globalCompositeOperation = st.e ? 'destination-out' : 'source-over'; g.strokeStyle = '#14233a'; g.lineCap = 'round'; g.lineJoin = 'round';
    const p = st.p;
    if (p.length === 1) { g.beginPath(); g.fillStyle = '#14233a'; g.arc(p[0][0] * w, p[0][1] * w, (0.0022 + 0.0028 * p[0][2]) * w / 2, 0, 7); g.fill(); }
    for (let i = 1; i < p.length; i++) { g.beginPath(); g.lineWidth = (st.e ? 0.03 : 0.0022 + 0.0028 * p[i][2]) * w; g.moveTo(p[i - 1][0] * w, p[i - 1][1] * w); g.lineTo(p[i][0] * w, p[i][1] * w); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  },
  bind(c) {
    let cur = null, lastY = 0;
    const pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width, e.pressure || 0.5]; };
    c.addEventListener('pointerdown', e => {
      const finger = e.pointerType === 'touch' && !($('fingerDraw') && $('fingerDraw').checked);
      try { c.setPointerCapture(e.pointerId); } catch (_) { /* 포인터 고정 실패해도 그리기는 계속 */ }
      if (finger) { lastY = e.clientY; cur = 'scroll'; return; }   // 손가락: 화면 넘기기(손바닥 오작동 방지)
      e.preventDefault();
      cur = { e: this.tool === 'eraser' ? 1 : 0, p: [pt(e)] }; this.pages[+c.dataset.page].push(cur);
      this.drawStroke(c.getContext('2d'), cur, c.width);
    });
    c.addEventListener('pointermove', e => {
      if (!cur) return;
      if (cur === 'scroll') { window.scrollBy(0, lastY - e.clientY); lastY = e.clientY; return; }
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const g = c.getContext('2d'), w = c.width;
      evs.forEach(ev => { cur.p.push(pt(ev)); this.drawStroke(g, { e: cur.e, p: cur.p.slice(-2) }, w); });
    });
    const end = () => { if (cur && cur !== 'scroll') this.autosave(); cur = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  },
  autosave() { clearTimeout(this.t); this.t = setTimeout(() => IDB.set(this.key, this.pages), 600); },
  undo() { for (let i = this.pages.length - 1; i >= 0; i--) if (this.pages[i].length) { this.pages[i].pop(); break; } this.redrawAll(); this.autosave(); },
  addPage() { this.pages.push([]); this.render(); this.autosave(); },
  clearPage() {
    const sheets = [...document.querySelectorAll('#pages .sheet')], mid = innerHeight / 2;
    let i = sheets.findIndex(sh => { const r = sh.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }); if (i < 0) i = 0;
    if (!this.pages[i].length || !confirm(`${i + 1}쪽을 모두 지울까요?`)) return; this.pages[i] = []; this.redrawAll(); this.autosave();
  },
  inkCount() { return this.pages.reduce((n, p) => n + p.filter(st => !st.e).length, 0); },
  exportImages() {   // 비교 화면용 이미지(줄 포함, 쓴 쪽만)
    return Promise.resolve([...document.querySelectorAll('#pages canvas')].filter((_, i) => this.pages[i].length).map(c => {
      const o = document.createElement('canvas'), k = 900 / c.width; o.width = 900; o.height = Math.round(c.height * k);
      const g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', 0.75);
    }));
  },
};

function tick() { remain--; spent++; const m = Math.floor(Math.abs(remain) / 60), s = String(Math.abs(remain) % 60).padStart(2, '0'); const el = $('timer'); if (!el) return; el.textContent = `${remain < 0 ? '+' : ''}${m}:${s}`; el.classList.toggle('over', remain < 0); }

// ── 4. 비교 ──
// 학습 메모(답안 작성 요령): 답안 본문과 분리해 비교 화면 아래에 보인다
const memoHtml = a => (a.memo && a.memo.length ? `<details class="why"><summary>학습 메모(작성 요령)</summary><ul class="note">${a.memo.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : '');
function renderCompare() {
  const a = answerOf(pickQuestion()), last = S.attempts.find(x => x.key === a.id && x.day === dayKey());
  if (!last) { $('v-compare').innerHTML = `<h1>4단계 · 모범답안과 비교</h1><div class="panel">3단계에서 답안을 먼저 써 주세요.<br><br><button class="primary" data-go="write">3단계로</button></div>`; return; }
  if (last.pen) return renderComparePen(a, last);
  const q = { card, ex: exOf(a.id) }, r = scoreAnswer(q, last.text), ks = keywords(q), an = normal(last.text);
  $('v-compare').innerHTML = `<h1>4단계 · 모범답안과 비교</h1><p class="sub">점수는 모범답안 핵심어·형식·분량으로 계산한 "빠진 것 확인용"입니다. 실제 채점과 다릅니다.</p>
    <div class="result"><div class="row"><span class="score">빠진 것 확인</span><span class="note">확인용 점수 ${r.score}/${r.max} · ${last.text.length}자 · ${Math.round(last.secs / 60)}분</span></div>
      ${r.missing.length ? `<ul>${r.missing.map(m => `<li>${esc(m.heading)} — ${m.earned}/${m.max}점, 빠진 것: ${esc((m.keywords || []).join(' · ') || '설명 보강')}</li>`).join('')}</ul>` : '<p>소제목별 핵심어를 모두 다뤘습니다.</p>'}
      ${r.numberIssues.length ? `<p>수치 확인: ${r.numberIssues.map(n => `${esc(n.key)} 모범 ${esc(n.model)} / 내 답안 ${esc(n.answer)}`).join(' · ')}</p>` : ''}
      ${r.missingNumbers.length ? `<p>빠진 수치: ${esc(r.missingNumbers.join(' · '))}</p>` : ''}
      ${r.presentationMissing.length ? `<p>형식 보완: ${esc(r.presentationMissing.join(' · '))}</p>` : ''}
      ${r.notices.length ? `<p>명칭 확인: ${esc(r.notices.join(' · '))}</p>` : ''}</div>
    <h2>핵심어 (실선 = 썼음, 점선 = 빠짐)</h2><div class="chips">${ks.map(k => `<span class="chip ${termHit(k, an) ? 'hit' : 'miss'}"><span class="sr">${termHit(k, an) ? '썼음: ' : '빠짐: '}</span>${esc(k)}</span>`).join('')}</div>
    <h2>나란히 보기</h2><div class="two"><div class="panel"><b>내 답안</b><pre>${esc(last.text)}</pre></div><div class="panel"><b>모범답안</b> ${badge(a)}<pre>${esc(a.answer)}</pre><p class="note">근거: ${esc(a.basis)}</p></div></div>
    ${figsOfAnswer(a.id).map(figHtml).join('')}${memoHtml(a)}<button class="primary" data-done="compare" data-go="review">비교 끝 → 5단계 복습 예약</button>`;
}

function renderComparePen(a, last) {
  const ks = keywords({ card, ex: exOf(a.id) }), ck = ((S.penCheck = S.penCheck || {})[a.id + '|' + last.day]) || [];
  $('v-compare').innerHTML = `<h1>4단계 · 모범답안과 비교</h1><p class="sub">손글씨 답안은 자동 채점하지 않습니다. 모범답안의 핵심어 중 내가 쓴 것을 눌러 체크하세요.</p>
    <div class="result"><div class="row"><span class="score" id="penScore">${ck.length} / ${ks.length}</span><span>핵심어 체크 · ${Math.round(last.secs / 60)}분 사용</span></div></div>
    <h2>핵심어 (내가 쓴 것을 누르면 실선으로 바뀜)</h2><div class="chips">${ks.map(k => `<button type="button" class="chip tap ${ck.includes(k) ? 'hit' : 'miss'}" aria-pressed="${ck.includes(k)}" data-kw="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <h2>나란히 보기</h2><div class="two"><div class="panel"><b>내 답안</b><div class="penimgs" id="penImgs"><p class="note">불러오는 중…</p></div></div><div class="panel"><b>모범답안</b> ${badge(a)}<pre>${esc(a.answer)}</pre><p class="note">근거: ${esc(a.basis)}</p></div></div>
    ${figsOfAnswer(a.id).map(figHtml).join('')}${memoHtml(a)}<button class="primary" data-done="compare" data-go="review">비교 끝 → 5단계 복습 예약</button>`;
  IDB.get('att|' + a.id + '|' + last.day).then(imgs => { const el = $('penImgs'); if (el) el.innerHTML = imgs && imgs.length ? imgs.map(u => `<img alt="손글씨 답안" src="${u}">`).join('') : '<p class="note">이미지를 찾지 못했습니다.</p>'; });
}
function toggleKw(el) {
  const a = answerOf(pickQuestion()), last = S.attempts.find(x => x.key === a.id && x.day === dayKey()); if (!last) return;
  const k = a.id + '|' + last.day; S.penCheck = S.penCheck || {}; const L = S.penCheck[k] = S.penCheck[k] || [];
  const i = L.indexOf(el.dataset.kw); if (i < 0) L.push(el.dataset.kw); else L.splice(i, 1);
  el.classList.toggle('hit', i < 0); el.classList.toggle('miss', i >= 0); el.setAttribute('aria-pressed', String(i < 0));
  $('penScore').textContent = `${L.length} / ${document.querySelectorAll('[data-kw]').length}`; save();
}

// ── 5. 복습 예약 ──
function renderReview() {
  const a = answerOf(pickQuestion()), c = S.cards[a.id];
  const fin = todayState().done.includes('review');
  $('v-review').innerHTML = `<h1>5단계 · 복습 예약</h1><p class="sub">이 문제를 다시 볼 날을 정합니다. 간격은 1·3·7·14·30일입니다.</p>
    ${fin ? `<div class="donebox" role="status"><b>오늘 공부 끝</b><p class="note" style="margin:4px 0 0">${c ? `이 문제는 ${fmt(c.next)}에 다시 나옵니다. ` : ''}내일은 앱이 출제 비중과 복습 일정으로 새 주제를 골라 둡니다.</p>${goalLeftHtml()}</div>` : ''}
    <div class="panel"><p class="q">${esc(a.question)}</p><p class="note">${c ? `지금 ${LADDER[c.level]}일 간격 · 다음 복습 ${fmt(c.next)}` : '처음 공부한 문제입니다.'}</p>
    <div class="rate">${[['again', '다시', '내일'], ['hard', '어려움', '간격 유지'], ['good', '보통', '다음 간격'], ['easy', '쉬움', '한 칸 건너뛰기']].map(([v, t, s]) => `<button type="button" data-rate="${v}"><b>${t}</b><span>${s}</span></button>`).join('')}</div></div>
    <h2>복습 일정</h2><div class="panel">${schedule()}</div>`;
}
function schedule() {
  const rows = ANS.filter(a => S.cards[a.id]).sort((x, y) => new Date(S.cards[x.id].next) - new Date(S.cards[y.id].next));
  return rows.length ? rows.map(a => `<div class="list-item"><span class="badge ${isDue(a.id) ? 'due' : ''}">${fmt(S.cards[a.id].next)}</span><span>${esc(a.question)}</span><span class="note">${LADDER[S.cards[a.id].level]}일 간격</span></div>`).join('') : '<p class="note">아직 예약한 문제가 없습니다.</p>';
}
// 문항 하나의 복습 간격 갱신(오늘 문제·복습 모아 보기 공용). 되돌리기용 이전 값을 돌려준다
function rateCard(id, v) {
  const prev = S.cards[id];
  let level = prev ? prev.level : -1;
  level = v === 'again' ? 0 : v === 'hard' ? Math.max(0, level) : v === 'good' ? Math.min(LADDER.length - 1, level + 1) : Math.min(LADDER.length - 1, level + 2);
  const next = today(); next.setDate(next.getDate() + (v === 'again' ? 1 : LADDER[level]));
  S.cards[id] = { level, next: next.toISOString(), reviews: (prev ? prev.reviews : 0) + 1, last: dayKey() };
  return { prev, next };
}
function rate(v) {
  const a = answerOf(pickQuestion()), tday = todayState(), prevDone = [...tday.done];
  const { prev, next } = rateCard(a.id, v);
  markDone('review'); save(); renderReview();
  toast(`${fmt(next.toISOString())}에 다시 봅니다`, () => { if (prev) S.cards[a.id] = prev; else delete S.cards[a.id]; tday.done = prevDone; save(); renderNav(); renderReview(); });
}

// ── 하루 분량: 목표(1교시형·논술 수)와 '한 문제 더' ──
const GOALS = { light: { n: '가볍게', g1: 1, g2: 0 }, normal: { n: '보통', g1: 2, g2: 1 }, heavy: { n: '많이', g1: 3, g2: 2 } };
const ANS_BY_ID = new Map(D.topics.flatMap((t, ti) => t.answers.map(a => [a.id, { a, ti }])));
const goal = () => GOALS[S.goal] || GOALS.normal;
function todayDone() {   // 오늘 쓰기를 마친 문항 수(교시별)
  const n = { g1: 0, g2: 0 };
  S.attempts.filter(x => x.day === dayKey()).forEach(x => { const r = ANS_BY_ID.get(x.key); if (r) n[r.a.gyosi === 1 ? 'g1' : 'g2']++; });
  return n;
}
function wantGyosi() {   // 남은 목표에 맞는 교시: 1(1교시형) / 2(논술) / 0(상관없음)
  const g = goal(), d = todayDone();
  if (d.g1 < g.g1 && d.g2 >= g.g2) return 1;
  if (d.g2 < g.g2 && d.g1 >= g.g1) return 2;
  return 0;
}
function topicsDoneToday() { const k = dayKey() + '|'; return new Set(Object.entries(S.days).filter(([key, v]) => key.startsWith(k) && v.done && v.done.length).map(([key]) => key.slice(k.length))); }
function pickExtraTopic() {   // 오늘 아직 안 한 주제 중 출제 비중 대비 가장 덜 한 주제
  const done = topicsDoneToday(), ws = D.topics.map((t, i) => weightOf(t, i)), sum = ws.reduce((a, b) => a + b, 0);
  const days = D.topics.map((_, i) => studiedDays(i, '')), total = days.reduce((a, b) => a + b, 0) + 1;
  let best = -1, gap = -Infinity;
  D.topics.forEach((t, i) => { if (done.has(t.prefix)) return; const g = ws[i] / sum * total - days[i]; if (g > gap) { gap = g; best = i; } });
  return best;
}
function oneMore() {
  const i = pickExtraTopic(); if (i < 0) { toast('오늘 모든 주제를 공부했습니다'); return; }
  S.extraPick = { day: dayKey(), i }; S.topicMode = 'auto'; setTopic(i); save(); $('topicSel').value = 'auto'; show('today'); toast(`다음 문제: ${SN.topic}`);
}
const currentAutoTopic = () => (S.extraPick && S.extraPick.day === dayKey() && S.extraPick.i < D.topics.length ? S.extraPick.i : autoTopic().i);
function goalHtml() {
  const g = goal(), d = todayDone(), cur = S.goal || 'normal';
  return `<div class="goalbar"><span class="note">오늘 목표</span><div class="seg" role="group" aria-label="하루 분량">${Object.entries(GOALS).map(([k, v]) => `<button type="button" data-goal="${k}" class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k}">${v.n}</button>`).join('')}</div>
    <span class="note">1교시형 ${Math.min(d.g1, g.g1)}/${g.g1}${g.g2 ? ` · 논술 ${Math.min(d.g2, g.g2)}/${g.g2}` : ''}</span></div>`;
}
function goalLeftHtml() {
  const g = goal(), d = todayDone(), left = Math.max(0, g.g1 - d.g1) + Math.max(0, g.g2 - d.g2);
  return `<p class="note" style="margin:6px 0 0">오늘 목표 ${left ? `${left}문제 남음` : '달성'} · 1교시형 ${d.g1}/${g.g1}${g.g2 ? ` · 논술 ${d.g2}/${g.g2}` : ''}</p><button class="${left ? 'primary' : 'ghost'}" type="button" id="oneMore">한 문제 더</button>`;
}

// ── 복습 모아 보기: 모든 주제의 복습 예정 문항을 차례로 ──
let DUEQ = null, DI = 0, DPH = 'q';
const dueAllIds = () => [...ANS_BY_ID.keys()].filter(isDue).sort((x, y) => new Date(S.cards[x].next) - new Date(S.cards[y].next));
const skeletonOf = a => a.answer.split('\n').filter(l => /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.\s/.test(l)).map(l => l.trim().replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.\s*/, ''));
const RATES = [['again', '다시', '내일'], ['hard', '어려움', '간격 유지'], ['good', '보통', '다음 간격'], ['easy', '쉬움', '한 칸 건너뛰기']];
function renderDue() {
  if (!DUEQ) { DUEQ = dueAllIds(); DI = 0; DPH = 'q'; }
  const v = $('v-due');
  if (!DUEQ.length) { v.innerHTML = `<h1>복습 모아 보기</h1><p class="sub">모든 주제의 복습 예정 문항을 한 번에 봅니다.</p><div class="donebox" role="status"><b>오늘 복습할 문항이 없습니다</b><p class="note" style="margin:4px 0 0">다음 복습 예정일이 되면 여기에 모입니다.</p></div>`; return; }
  if (DI >= DUEQ.length) { v.innerHTML = `<h1>복습 모아 보기</h1><div class="donebox" role="status"><b>오늘 복습 끝 · ${DUEQ.length}건</b><p class="note" style="margin:4px 0 0">이제 '오늘 할 일'에서 새 문제를 공부하세요.</p></div><button class="primary" type="button" data-go="today">오늘 할 일로</button>`; return; }
  const { a, ti } = ANS_BY_ID.get(DUEQ[DI]), sn = D.topics[ti].subnote, c = S.cards[a.id];
  const kws = sn.keywords.filter(k => a.answer.includes(k));
  v.innerHTML = `<h1>복습 모아 보기</h1><p class="sub">${DI + 1} / ${DUEQ.length}건 · 문항당 2~3분. 뼈대를 먼저 떠올린 뒤 확인합니다.</p>
    <div class="panel"><div class="row"><span class="badge">${esc(sn.topic)}</span><span class="badge">${a.gyosi}교시 · ${a.max}점</span>${badge(a)}${c ? `<span class="badge due">${LADDER[c.level]}일 간격</span>` : ''}</div>
    <p class="q">${esc(a.question)}</p>
    ${DPH === 'q' ? `<p class="note">대제목(Ⅰ·Ⅱ·Ⅲ…)과 꼭 쓸 핵심어, 그림 1개를 머릿속이나 종이에 적어 본 뒤 누르세요.</p><button class="primary" type="button" id="dueShow">모범 뼈대 보기</button>`
    : `<h2>모범 뼈대</h2><ol class="outline">${skeletonOf(a).map(l => `<li>${esc(l)}</li>`).join('')}</ol>
      ${kws.length ? `<h2>핵심어</h2><div class="chips">${kws.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}
      <details><summary>모범답안 전체</summary><pre class="ans">${esc(a.answer)}</pre></details>
      <div class="rate">${RATES.map(([k, t, s2]) => `<button type="button" data-drate="${k}"><b>${t}</b><span>${s2}</span></button>`).join('')}</div>`}</div>`;
}
function dueRate(v) {
  const id = DUEQ[DI], { prev, next } = rateCard(id, v); save();
  const at = DI; DI++; DPH = 'q'; renderDue(); renderNav();
  toast(`${fmt(next.toISOString())}에 다시 봅니다`, () => { if (prev) S.cards[id] = prev; else delete S.cards[id]; save(); DI = at; DPH = 'a'; renderDue(); renderNav(); });
}

// ── 범위 현황판: 등급별 수록·공부 현황과 최근 6회 '고를 수 있는 문항 수' ──
function studiedTopicIds() { return new Set(D.topics.filter((t, i) => t.answers.some(a => S.cards[a.id]) || studiedDays(i, '') > 0).map(t => t.tid)); }
function renderCover() {
  const studied = studiedTopicIds(), app = new Set(D.topics.map(t => t.tid)), G = D.grades || [], R = D.recent || [];
  const tiers = ['S', 'A', 'B', 'C'].map(k => { const g = G.filter(x => x.tier === k); return { k, n: g.length, app: g.filter(x => app.has(x.id)).length, st: g.filter(x => studied.has(x.id)).length, rec: g.reduce((a, x) => a + x.rec, 0) }; });
  const rounds = [...new Set(R.map(r => r.h))].sort((a, b) => b - a);
  const need = g => (g === 1 ? 10 : 4), tot = g => (g === 1 ? 13 : 6);
  const row = (h, set) => [1, 2, 3, 4].map(g => { const n = R.filter(r => r.h === h && r.g === g && set.has(r.t)).length; return `<td class="${n < need(g) ? 'short' : 'enough'}">${n}/${tot(g)}${n < need(g) ? '<span class="sr"> 부족</span>' : ''}</td>`; }).join('');
  const table = set => `<table class="covtab"><tr><th>회차</th><th>1교시</th><th>2교시</th><th>3교시</th><th>4교시</th></tr>${rounds.map(h => `<tr><td>${h}회</td>${row(h, set)}</tr>`).join('')}</table>`;
  $('v-cover').innerHTML = `<h1>범위 현황</h1><p class="sub">시험장에서 1교시는 13문항 중 10개, 2·3·4교시는 6문항 중 4개를 골라 씁니다. 공부한 주제로 몇 문항을 고를 수 있었는지 봅니다.</p>
    <h2>등급별 주제</h2><table><tr><th>등급</th><th>주제</th><th>답안 있음</th><th>공부함</th><th>최근 6회 출제</th></tr>
      ${tiers.map(t => `<tr><td>${t.k}</td><td>${t.n}</td><td>${t.app}</td><td>${t.st}</td><td>${t.rec}문항</td></tr>`).join('')}</table>
    <h2>최근 6회: 내가 공부한 주제로 고를 수 있던 문항</h2><p class="note">필요: 1교시 10, 2·3·4교시 각 4. 모자란 칸은 점선 테두리입니다.</p>${table(studied)}
    <h2>참고: 앱에 답안이 있는 주제를 다 공부하면</h2>${table(app)}
    <details class="why"><summary>아직 답안이 없는 주제(최근 출제 순)</summary><ol class="outline">${G.filter(x => !app.has(x.id)).sort((a, b) => b.rec - a.rec || b.tot - a.tot).map(x => `<li>${esc(x.tier)} · ${esc(x.name)} (누적 ${x.tot}, 최근 ${x.rec})</li>`).join('')}</ol></details>`;
}

// ── 요약 카드: 모든 주제의 서브노트를 한 장씩 빠르게 넘겨 보기(가리고 떠올리기 가능) ──
let CI = 0, CHIDE = false;
const cardList = () => D.topics.map((t, i) => ({ t, i })).filter(({ t }) => !S.cardTier || (t.freq && t.freq.tier) === S.cardTier || (S.cardTier === 'B' && t.partial));
function renderCards() {
  const L = cardList(); if (!L.length) { S.cardTier = ''; return renderCards(); }
  CI = Math.max(0, Math.min(L.length - 1, CI));
  const { t } = L[CI], sn = t.subnote, b = v => CHIDE ? `<button class="blank" type="button" aria-label="빈칸, 눌러서 보기"><span aria-hidden="true">${esc(v)}</span></button>` : esc(v);
  const qs = (t.partial && t.allq.length ? t.allq : t.answers.map(a => ({ h: a.source && a.source.h, g: a.gyosi, n: a.source && a.source.n, q: a.question })));
  $('v-cards').innerHTML = `<h1>요약 카드</h1><p class="sub">주제 하나를 한 장으로 봅니다. '가리기'를 켜면 핵심어·수치가 빈칸이 됩니다.</p>
    <div class="row cardbar"><div class="seg" role="group" aria-label="등급">${[['', '전체'], ['S', 'S'], ['A', 'A'], ['B', 'B']].map(([k, n]) => `<button type="button" data-ctier="${k}" class="${(S.cardTier || '') === k ? 'on' : ''}" aria-pressed="${(S.cardTier || '') === k}">${n}</button>`).join('')}</div>
      <button class="ghost${CHIDE ? ' on' : ''}" type="button" id="cardHide" aria-pressed="${CHIDE}">${CHIDE ? '가리기 켬' : '가리기'}</button><span class="note">${CI + 1} / ${L.length}</span></div>
    <div class="panel"><div class="row"><span class="badge">${esc((t.freq && t.freq.tier) || '')}등급</span><span class="badge wrap">${esc(sn.count || '')}</span></div>
      <h2 class="cardtitle">${esc(sn.topic)}</h2><p class="def">${esc(sn.definition)}</p>
      <h2>뼈대</h2><ol class="outline">${sn.outline.map(o => `<li>${esc(o)}</li>`).join('')}</ol>
      <h2>핵심어</h2><div class="chips">${sn.keywords.map(k => CHIDE ? b(k) : `<span class="chip">${esc(k)}</span>`).join('')}</div>
      <h2>수치·조항</h2><table><tr><th>내용</th><th>수치</th><th>근거</th></tr>${sn.facts.map(f => `<tr><td>${esc(f.item)}</td><td>${b(f.value)}</td><td>${esc(f.basis)}</td></tr>`).join('')}</table>
      <h2>그림: ${esc((sn.diag && sn.diag.title) || '')}</h2>${diagHtml(sn)}
      <h2>기술사 견해</h2><ol class="outline">${sn.opinions.map(o => `<li>${esc(o)}</li>`).join('')}</ol>
      <details class="why"><summary>기출 문항 ${qs.length}개</summary><ol class="outline">${qs.map(q => `<li>${q.h ? `${q.h}회 ${q.g}교시 · ` : ''}${esc(q.q)}</li>`).join('')}</ol></details></div>
    <div class="row"><button class="ghost" type="button" id="cardPrev" ${CI ? '' : 'disabled'}>이전</button><button class="primary" type="button" id="cardNext" ${CI < L.length - 1 ? '' : 'disabled'}>다음</button><button class="ghost" type="button" id="cardStudy">이 주제 공부하기</button></div>`;
}

// ── 모의고사: 실제 형식(1교시 13 중 10, 2~4교시 6 중 4, 교시당 100분) ──
const EX = D.exams || [];
const NEED = g => (g === 1 ? 10 : 4), TOT = g => (g === 1 ? 13 : 6);
const exRounds = () => [...new Set(EX.map(e => e.h))].sort((a, b) => b - a);
const ansOfEx = e => (e.a ? ANS_BY_ID.get(e.a) : null);
let MK = S.mockNow || null, mkTimer = null, mkLeft = 0;
function mockStart(kind, g, h) {
  let qs;
  if (kind === 'round') qs = EX.filter(e => e.h === h && e.g === g).sort((a, b) => a.n - b.n);
  else {   // 최근 6회 같은 교시 문항을 섞어 한 회차 분량으로
    const rs = exRounds().slice(0, 6), pool = EX.filter(e => rs.includes(e.h) && e.g === g);
    qs = pool.map(e => [Math.random(), e]).sort((a, b) => a[0] - b[0]).slice(0, TOT(g)).map(x => x[1]);
  }
  MK = { kind, g, h: kind === 'round' ? h : null, qs: qs.map(e => `${e.h}-${e.g}-${e.n}`), pick: [], phase: 'select', checks: {}, started: null };
  save(); renderMock();
}
const exByKey = k => EX.find(e => `${e.h}-${e.g}-${e.n}` === k);
function mockTick() { mkLeft--; const el = $('mkTimer'); if (el) { const m = Math.floor(Math.abs(mkLeft) / 60), s = String(Math.abs(mkLeft) % 60).padStart(2, '0'); el.textContent = `${mkLeft < 0 ? '+' : ''}${m}:${s}`; el.classList.toggle('over', mkLeft < 0); } }
function renderMock() {
  const v = $('v-mock'); clearInterval(mkTimer); mkTimer = null;
  if (!MK) {
    const hist = (S.mocks || []).slice(0, 5);
    v.innerHTML = `<h1>모의고사</h1><p class="sub">실제 시험처럼 1교시는 13문항 중 10개, 2·3·4교시는 6문항 중 4개를 골라 100분 동안 씁니다. 답은 종이에 쓰는 것을 권합니다.</p>
      <div class="panel"><h2>기출 회차 그대로</h2><div class="row"><select id="mkRound" aria-label="회차">${exRounds().map(h => `<option value="${h}">${h}회</option>`).join('')}</select>
        <select id="mkG1" aria-label="교시">${[1, 2, 3, 4].map(g => `<option value="${g}">${g}교시</option>`).join('')}</select><button class="primary" type="button" id="mkRoundGo">시작</button></div>
      <h2>최근 6회 분포로 섞어 만들기</h2><div class="row"><select id="mkG2" aria-label="교시">${[1, 2, 3, 4].map(g => `<option value="${g}">${g}교시</option>`).join('')}</select><button class="ghost" type="button" id="mkMixGo">만들기</button></div></div>
      ${hist.length ? `<h2>지난 모의고사</h2><table><tr><th>날짜</th><th>구성</th><th>점수</th></tr>${hist.map(m => `<tr><td>${esc(m.day)}</td><td>${esc(m.label)}</td><td>${m.score}점</td></tr>`).join('')}</table>` : ''}`;
    return;
  }
  const label = MK.kind === 'round' ? `${MK.h}회 ${MK.g}교시` : `섞은 ${MK.g}교시`;
  if (MK.phase === 'select') {
    v.innerHTML = `<h1>모의고사 · ${esc(label)}</h1><p class="sub">문제를 고르세요(${NEED(MK.g)}개). 실제 시험처럼 2분 안에 고르는 연습을 합니다.</p>
      <div class="panel">${MK.qs.map((k, i) => { const e = exByKey(k), on = MK.pick.includes(k); return `<label class="mkq"><input type="checkbox" data-mkpick="${k}" ${on ? 'checked' : ''}> <span><b>${i + 1}.</b> ${esc(e.q)} ${e.a ? '' : '<span class="badge draft">답안 없음</span>'}</span></label>`; }).join('')}</div>
      <div class="row"><span class="note" id="mkCnt">${MK.pick.length} / ${NEED(MK.g)} 선택</span><button class="primary" type="button" id="mkBegin" ${MK.pick.length === NEED(MK.g) ? '' : 'disabled'}>100분 시작</button><button class="ghost" type="button" id="mkPrint">문제지·답안지 인쇄</button><button class="ghost" type="button" id="mkQuit">그만두기</button></div>`;
    return;
  }
  if (MK.phase === 'write') {
    v.innerHTML = `<h1>모의고사 · ${esc(label)}</h1><div class="writebar"><div class="row"><span class="timer" id="mkTimer" role="timer">100:00</span><span class="note">종이 답안지에 쓰고, 끝나면 '채점하기'를 누릅니다.</span></div></div>
      <div class="panel"><ol class="outline">${MK.pick.map(k => `<li>${esc(exByKey(k).q)}</li>`).join('')}</ol></div>
      <div class="row"><button class="primary" type="button" id="mkDone">채점하기</button><button class="ghost" type="button" id="mkPrint">문제지·답안지 인쇄</button></div>`;
    mkLeft = 100 * 60 - Math.floor((Date.now() - MK.started) / 1000); mockTick(); mkTimer = setInterval(mockTick, 1000);
    return;
  }
  // 채점: 문항별 모범 뼈대·핵심어를 보며 쓴 것 체크
  const items = MK.pick.map(k => { const e = exByKey(k), r = ansOfEx(e); const kws = r ? D.topics[r.ti].subnote.keywords.filter(w => r.a.answer.includes(w)) : []; return { k, e, r, kws }; });
  v.innerHTML = `<h1>모의고사 채점 · ${esc(label)}</h1><p class="sub">문항마다 내가 쓴 핵심어를 누르세요. 답안이 없는 문항은 점수에서 빠집니다.</p>
    ${items.map(({ k, e, r, kws }) => `<div class="panel"><p class="q">${esc(e.q)}</p>${r ? `<details><summary>모범 뼈대 보기</summary><ol class="outline">${skeletonOf(r.a).map(l => `<li>${esc(l)}</li>`).join('')}</ol></details>
      <div class="chips">${kws.map(w => { const on = (MK.checks[k] || []).includes(w); return `<button type="button" class="chip ${on ? 'hit' : 'miss'}" data-mkkw="${esc(k)}" data-w="${esc(w)}" aria-pressed="${on}">${esc(w)}<span class="sr">${on ? ' 썼음' : ' 빠짐'}</span></button>`; }).join('')}</div>
      <p class="note">${(MK.checks[k] || []).length} / ${kws.length}</p>` : '<p class="note">이 문항은 아직 앱에 모범답안이 없습니다.</p>'}</div>`).join('')}
    <div class="row"><button class="primary" type="button" id="mkFinish">채점 마치고 복습에 반영</button></div>`;
}
function mockFinish() {
  let sum = 0, n = 0;
  MK.pick.forEach(k => {
    const r = ansOfEx(exByKey(k)); if (!r) return;
    const kws = D.topics[r.ti].subnote.keywords.filter(w => r.a.answer.includes(w)); const p = kws.length ? (MK.checks[k] || []).length / kws.length : 0;
    sum += p; n++; rateCard(r.a.id, p < 0.5 ? 'again' : p < 0.75 ? 'hard' : 'good');   // 약한 문항은 복습에 더 일찍
  });
  const score = n ? Math.round(sum / n * 100) : 0;
  S.mocks = [{ day: dayKey(), label: MK.kind === 'round' ? `${MK.h}회 ${MK.g}교시` : `섞은 ${MK.g}교시`, score, n }, ...(S.mocks || [])].slice(0, 50);
  MK = null; save(); renderMock(); renderNav(); toast(`모의고사 ${score}점(핵심어 기준). 약한 문항은 복습에 올렸습니다`);
}
function mockPrint() {
  const keys = MK.phase === 'select' && MK.pick.length !== NEED(MK.g) ? MK.qs : (MK.pick.length ? MK.pick : MK.qs);
  const w = window.open('', '_blank'); if (!w) { toast('팝업이 막혀 인쇄 창을 열 수 없습니다'); return; }
  const lines = Array.from({ length: 22 }, () => '<div class="ln"></div>').join('');
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>모의고사 ${MK.g}교시</title><style>body{font-family:serif;margin:24px}h1{font-size:18px}ol{line-height:1.7}.pg{page-break-before:always;padding-top:12px}.ln{border-bottom:1px solid #999;height:34px}</style></head><body>
    <h1>수자원개발기술사 모의고사 ${MK.g}교시(100분)</h1><p>${NEED(MK.g)}문제를 선택하여 쓰시오.</p><ol>${keys.map(k => `<li>${esc(exByKey(k).q)}</li>`).join('')}</ol>
    ${Array.from({ length: MK.g === 1 ? 7 : 8 }, (_, i) => `<div class="pg"><p>답안지 ${i + 1}쪽</p>${lines}</div>`).join('')}</body></html>`);
  w.document.close(); w.focus(); w.print();
}

// ── 처음 보는 문제 뼈대 잡기: 2분 안에 대제목·핵심어·그림 구상 ──
let SK = null, skTimer = null, skLeft = 0;
function skNew() {
  const pool = EX.filter(e => e.a && !(S.skelDone || []).includes(e.a));
  const pick = (pool.length ? pool : EX.filter(e => e.a))[Math.floor(Math.random() * (pool.length || EX.filter(e => e.a).length))];
  SK = { k: `${pick.h}-${pick.g}-${pick.n}`, phase: 'think', text: '', checks: [] }; skLeft = 120; renderSkel();
}
function renderSkel() {
  const v = $('v-skel'); clearInterval(skTimer); skTimer = null;
  if (!SK) { v.innerHTML = `<h1>뼈대 잡기</h1><p class="sub">처음 보는 문제를 받으면 2분 안에 대제목 5~7개, 핵심어, 그림 1개를 정하는 연습입니다. 공부하지 않은 문항부터 나옵니다.</p><button class="primary" type="button" id="skGo">문제 받기</button>`; return; }
  const e = exByKey(SK.k), r = ansOfEx(e);
  if (SK.phase === 'think') {
    v.innerHTML = `<h1>뼈대 잡기</h1><div class="writebar"><div class="row"><span class="badge">${e.h}회 ${e.g}교시</span><span class="timer" id="skTimer" role="timer">2:00</span></div><p class="q">${esc(e.q)}</p></div>
      <textarea id="skText" aria-label="뼈대" placeholder="Ⅰ. 개요&#10;Ⅱ. …&#10;핵심어: …&#10;그림: …">${esc(SK.text)}</textarea><div class="row"><button class="primary" type="button" id="skShow">모범 뼈대와 비교</button></div>`;
    const tick = () => { skLeft--; const el = $('skTimer'); if (el) { el.textContent = `${skLeft < 0 ? '+' : ''}${Math.floor(Math.abs(skLeft) / 60)}:${String(Math.abs(skLeft) % 60).padStart(2, '0')}`; el.classList.toggle('over', skLeft < 0); } };
    skTimer = setInterval(tick, 1000); $('skText').addEventListener('input', ev => { SK.text = ev.target.value; });
    return;
  }
  const kws = D.topics[r.ti].subnote.keywords.filter(w => r.a.answer.includes(w));
  v.innerHTML = `<h1>뼈대 잡기 · 비교</h1><p class="q">${esc(e.q)}</p>
    <div class="cmpgrid"><div class="panel"><h2>내 뼈대</h2><pre class="ans">${esc(SK.text || '(작성 안 함)')}</pre></div>
    <div class="panel"><h2>모범 뼈대</h2><ol class="outline">${skeletonOf(r.a).map(l => `<li>${esc(l)}</li>`).join('')}</ol></div></div>
    <h2>떠올린 핵심어를 누르세요</h2><div class="chips">${kws.map(w => { const on = SK.checks.includes(w); return `<button type="button" class="chip ${on ? 'hit' : 'miss'}" data-skkw="${esc(w)}" aria-pressed="${on}">${esc(w)}<span class="sr">${on ? ' 떠올림' : ' 못 떠올림'}</span></button>`; }).join('')}</div>
    <p class="note">${SK.checks.length} / ${kws.length} · 주제: ${esc(D.topics[r.ti].subnote.topic)}</p>
    <div class="row"><button class="primary" type="button" id="skNext">다음 문제</button><button class="ghost" type="button" id="skStudy">이 주제 공부하기</button></div>`;
}

// ── 주간 계획: 남은 주 수로 새 주제 → 회독 → 모의고사 ──
function renderPlan() {
  const d = daysToExam(), weeks = d === null ? null : Math.max(0, Math.ceil(d / 7));
  const studied = studiedTopicIds(), n = D.topics.length, done = D.topics.filter(t => studied.has(t.tid)).length;
  const allA = [...ANS_BY_ID.keys()], seenA = allA.filter(id => S.cards[id]).length;
  const newWeeks = weeks === null ? null : Math.max(1, weeks - 6);   // 마지막 6주: 회독 2주 + 모의고사 4주
  const perWeek = newWeeks ? Math.ceil((n - done) / newWeeks) : 0;
  const wk = d => { const t = today(); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t; };
  const mon = wk(), thisWeek = Object.keys(S.days).filter(k => new Date(k.slice(0, 10) + 'T00:00:00') >= mon && (S.days[k].done || []).length).length;
  const bar = (a, b) => `<div class="meter big" aria-hidden="true"><i style="width:${b ? Math.round(a / b * 100) : 0}%"></i></div>`;
  $('v-plan').innerHTML = `<h1>주간 계획</h1><p class="sub">${D.examConfirmed ? '시험까지' : '시험일 미확정(공고 전, 임시 날짜 기준)'} ${weeks === null ? '' : `${weeks}주 남음`}. 새 주제 → 회독 2주 → 모의고사 4주 순서로 짭니다.</p>
    <div class="panel"><h2>진도</h2>
      <p>공부한 주제 ${done} / ${n}</p>${bar(done, n)}
      <p>한 번 이상 공부한 문항 ${seenA} / ${allA.length}</p>${bar(seenA, allA.length)}
      <p>이번 주 공부한 날·주제 ${thisWeek}회</p></div>
    <div class="panel"><h2>단계별 일정</h2><table><tr><th>단계</th><th>기간</th><th>할 일</th></tr>
      <tr><td>1 새 주제</td><td>${newWeeks ?? '-'}주</td><td>남은 ${n - done}개 주제를 주당 ${perWeek}개씩 처음 공부(오늘의 추천이 출제 비중대로 고름)</td></tr>
      <tr><td>2 회독</td><td>2주</td><td>요약 카드 전체 1회 + 복습 모아 보기 매일</td></tr>
      <tr><td>3 모의고사</td><td>4주</td><td>주 2회 교시 1개씩 종이에 100분, 채점 결과는 복습에 반영</td></tr></table></div>
    <div class="panel"><h2>이번 주 목표</h2><ol class="outline"><li>새 주제 ${perWeek}개 처음 공부</li><li>복습 모아 보기 매일 비우기</li><li>${weeks !== null && weeks <= 6 ? '모의고사 2회(교시 1개씩)' : '뼈대 잡기 하루 3문제'}</li></ol></div>`;
}

// ── 문항 목록 ──
function renderList() {
  const cur = pickQuestion();
  $('v-list').innerHTML = `<h1>문항 목록</h1><p class="sub">${esc(SN.topic)} 기출 ${ANS.length}문항. 고르면 오늘의 문제가 바뀝니다.</p><div class="panel">${ANS.map(a => {
    const c = S.cards[a.id], src = a.source && a.source.h ? `${a.source.h}회 ${a.gyosi}교시` : '반복 기출';
    return `<div class="list-item"><span class="badge">${src}</span><span>${esc(a.question)} ${badge(a)} ${c ? `<span class="badge ${isDue(a.id) ? 'due' : ''}">다음 ${fmt(c.next)}</span>` : ''}</span><button class="${a.id === cur ? 'primary' : 'ghost'}" type="button" data-pick="${esc(a.id)}">${a.id === cur ? '오늘 문제' : '이 문제로'}</button></div>`;
  }).join('')}</div>`;
}

// ── 화면 전환 ──
const RENDER = { today: renderToday, read: renderRead, recall: renderRecall, write: renderWrite, compare: renderCompare, review: renderReview, list: renderList, due: renderDue, cover: renderCover, cards: renderCards, mock: renderMock, skel: renderSkel, plan: renderPlan };
function show(step) {
  if (step !== 'write' && timer) { clearInterval(timer); timer = null; }
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === `v-${step}`));
  if (step === 'due') DUEQ = null;
  if (step !== 'mock' && mkTimer) { clearInterval(mkTimer); mkTimer = null; }
  if (step !== 'skel' && skTimer) { clearInterval(skTimer); skTimer = null; }
  RENDER[step](); renderNav(step); window.scrollTo(0, 0);
}
function renderNav(active) {
  const t = todayState();
  const cur = active || document.querySelector('.view.on')?.id.slice(2);
  document.querySelectorAll('.step').forEach(b => { const on = b.dataset.step === cur; b.classList.toggle('on', on); b.toggleAttribute('aria-current', on); if (on) b.setAttribute('aria-current', 'step'); b.classList.toggle('done', t.done.includes(b.dataset.step)); if (on && b.scrollIntoView && innerWidth <= 900) b.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  document.body.classList.toggle('focus', cur === 'write');
  const dc = $('dueCnt'); if (dc) { const n = dueAllIds().length; dc.textContent = n ? String(n) : ''; }
}

document.addEventListener('click', e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.classList.contains('blank')) { el.classList.add('shown'); el.removeAttribute('aria-label'); el.firstElementChild && el.firstElementChild.removeAttribute('aria-hidden'); updateRecallCount(); return; }
  if (el.dataset.step) return show(el.dataset.step);
  if (el.dataset.done) markDone(el.dataset.done);
  if (el.dataset.go) return show(el.dataset.go);
  if (el.dataset.recall) { const t = todayState(), prev = { recall: t.recall, done: [...t.done] }; t.recall = el.dataset.recall; markDone('recall'); save(); show(['some', 'none'].includes(el.dataset.recall) ? 'read' : 'write'); toast('떠올리기 평가를 기록했습니다', () => { t.recall = prev.recall; t.done = prev.done; save(); show('recall'); }); return; }
  if (el.dataset.rate) return rate(el.dataset.rate);
  if (el.dataset.drate) return dueRate(el.dataset.drate);
  if (el.id === 'dueShow') { DPH = 'a'; return renderDue(); }
  if (el.id === 'oneMore') return oneMore();
  if (el.id === 'mkRoundGo') return mockStart('round', +$('mkG1').value, +$('mkRound').value);
  if (el.id === 'mkMixGo') return mockStart('mix', +$('mkG2').value);
  if (el.id === 'mkBegin') { MK.phase = 'write'; MK.started = Date.now(); save(); return renderMock(); }
  if (el.id === 'mkDone') { MK.phase = 'score'; save(); return renderMock(); }
  if (el.id === 'mkFinish') return mockFinish();
  if (el.id === 'mkQuit') { MK = null; save(); return renderMock(); }
  if (el.id === 'mkPrint') return mockPrint();
  if (el.dataset.mkkw !== undefined) { const k = el.dataset.mkkw, w = el.dataset.w, a = MK.checks[k] = MK.checks[k] || []; const i = a.indexOf(w); if (i < 0) a.push(w); else a.splice(i, 1); save(); return renderMock(); }
  if (el.id === 'skGo' || el.id === 'skNext') { if (SK && SK.phase === 'cmp') { const r = ansOfEx(exByKey(SK.k)); S.skelDone = [...(S.skelDone || []), r.a.id].slice(-500); save(); } return skNew(); }
  if (el.id === 'skShow') { SK.phase = 'cmp'; return renderSkel(); }
  if (el.dataset.skkw !== undefined) { const w = el.dataset.skkw, i = SK.checks.indexOf(w); if (i < 0) SK.checks.push(w); else SK.checks.splice(i, 1); return renderSkel(); }
  if (el.id === 'skStudy') { const r = ansOfEx(exByKey(SK.k)); S.topicMode = 'manual'; setTopic(r.ti); S.topic = TI; todayState().q = r.a.id; save(); $('topicSel').value = String(TI); return show('today'); }
  if (el.dataset.ctier !== undefined) { S.cardTier = el.dataset.ctier; CI = 0; save(); return renderCards(); }
  if (el.id === 'cardHide') { CHIDE = !CHIDE; return renderCards(); }
  if (el.id === 'cardPrev' || el.id === 'cardNext') { CI += el.id === 'cardNext' ? 1 : -1; renderCards(); window.scrollTo(0, 0); return; }
  if (el.id === 'cardStudy') { const { i } = cardList()[CI]; S.topicMode = 'manual'; setTopic(i); S.topic = TI; save(); $('topicSel').value = String(TI); return show('today'); }
  if (el.dataset.goal) { S.goal = el.dataset.goal; save(); return show('today'); }
  if (el.dataset.kw !== undefined) return toggleKw(el);
  if (el.dataset.pick) { todayState().q = el.dataset.pick; const t = todayState(); t.done = t.done.filter(s => s === 'read' || s === 'recall'); save(); toast('오늘의 문제를 바꿨습니다'); return show('today'); }
  if (el.id === 'revealAll') { document.querySelectorAll('#recallBody .blank').forEach(b => b.classList.add('shown')); updateRecallCount(); }
  if (el.id === 'timerBtn') { if (timer) { clearInterval(timer); timer = null; el.textContent = '계속'; } else { timer = setInterval(tick, 1000); el.textContent = '일시정지'; } }
  if (el.dataset.mode) { S.writeMode = el.dataset.mode; save(); return renderWrite(); }
  if (el.dataset.tool) { PEN.tool = el.dataset.tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b === el)); return; }
  if (el.id === 'penUndo') return PEN.undo();
  if (el.id === 'penAddPage') return PEN.addPage();
  if (el.id === 'penClear') return PEN.clearPage();
  if (el.id === 'penTrace') { const sh = document.querySelector('#pages .sheet'); if (!sh) return; const old = sh.querySelector('.trace'); if (old) { old.remove(); el.classList.remove('on'); return; } const f = figsOfAnswer(pickQuestion())[0] || figsOfTopic()[0]; sh.insertAdjacentHTML('afterbegin', `<div class="trace" aria-hidden="true">${f.svg}</div>`); el.classList.add('on'); toast('밑그림을 따라 그린 뒤, 다시 눌러 끄고 혼자 그려 보세요'); return; }
  if (el.id === 'saveDraft') {
    if (S.writeMode === 'pen') { IDB.set(PEN.key, PEN.pages); toast('손글씨를 임시저장했습니다'); return; }
    S.drafts[pickQuestion()] = $('answer').value; save(); toast('임시저장했습니다');
  }
  if (el.id === 'submitAnswer' && S.writeMode === 'pen') {
    if (PEN.inkCount() < 20) { toast('조금 더 쓴 뒤 완료하세요'); return; }
    const key = pickQuestion(); clearInterval(timer); timer = null;
    PEN.exportImages().then(imgs => IDB.set('att|' + key + '|' + dayKey(), imgs)).then(() => {
      S.attempts = S.attempts.filter(x => !(x.key === key && x.day === dayKey()));
      S.attempts.unshift({ key, day: dayKey(), text: '', pen: true, secs: spent, at: new Date().toISOString() });
      IDB.set(PEN.key, PEN.pages); markDone('write'); save(); show('compare');
    });
    return;
  }
  if (el.id === 'submitAnswer') {
    const text = $('answer').value.trim(); if (text.length < 50) { toast('50자 이상 쓴 뒤 완료하세요'); return; }
    const key = pickQuestion(); S.drafts[key] = text;
    S.attempts = S.attempts.filter(x => !(x.key === key && x.day === dayKey()));
    S.attempts.unshift({ key, day: dayKey(), text, secs: spent, at: new Date().toISOString() });
    clearInterval(timer); timer = null; markDone('write'); save(); show('compare');
  }
  if (el.id === 'exportBtn') { $('recMenu').open = false; exportRecord(); }
  if (el.id === 'importBtn' || el.id === 'replaceBtn') { importMode = el.id === 'replaceBtn' ? 'replace' : 'merge'; $('importFile').click(); $('recMenu').open = false; }
});

// ── 기록 보관: 내보내기(손글씨 포함 선택·공유 창), 불러와 합치기 ──
let importMode = 'merge';
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
async function exportRecord() {
  const withPen = $('withPen').checked;
  let pen = null; if (withPen) { try { pen = await IDB.all(); } catch (_) { pen = null; } }
  const text = JSON.stringify({ app: '수자원기술사 학습', at: new Date().toISOString(), state: S, ...(pen ? { pen } : {}) });
  const name = `기술사학습기록_${dayKey()}${pen ? '_손글씨' : ''}.json`, blob = new Blob([text], { type: 'application/json' });
  let shared = false;
  try {   // 아이폰·아이패드: 공유 창(에어드롭·파일 앱)
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer:coarse)').matches) { await navigator.share({ files: [file], title: name }); shared = true; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  if (!shared) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  S.lastExport = new Date().toISOString(); save(); toast(`기록을 내보냈습니다 (${kb(blob.size)})`);
}
// 합치기 규칙: 문항 카드는 복습을 더 많이 한 쪽(같으면 다음 복습일이 늦은 쪽), 쓰기 기록·공부한 날은 양쪽 합침, 그 밖은 지금 기기 값 우선
function mergeState(cur, inc) {
  const out = { ...inc, ...cur, cards: { ...cur.cards }, drafts: { ...(inc.drafts || {}), ...(cur.drafts || {}) }, autoDay: { ...(inc.autoDay || {}), ...(cur.autoDay || {}) }, days: { ...cur.days } };
  Object.entries(inc.cards || {}).forEach(([k, c]) => {
    const m = out.cards[k];
    if (!m || (c.reviews || 0) > (m.reviews || 0) || ((c.reviews || 0) === (m.reviews || 0) && new Date(c.next) > new Date(m.next))) out.cards[k] = c;
  });
  const seen = new Set(), att = [...(cur.attempts || []), ...(inc.attempts || [])].filter(x => { const id = `${x.key}|${x.at}`; if (seen.has(id)) return false; seen.add(id); return true; });
  out.attempts = att.sort((x, y) => new Date(y.at) - new Date(x.at));
  Object.entries(inc.days || {}).forEach(([k, d]) => {
    const m = out.days[k]; if (!m) { out.days[k] = d; return; }
    out.days[k] = { ...d, ...m, done: [...new Set([...(m.done || []), ...(d.done || [])])], q: m.q || d.q, recall: m.recall || d.recall };
  });
  return out;
}
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.mkpick; if (!k || !MK) return;
  if (e.target.checked) { if (MK.pick.length >= NEED(MK.g)) { e.target.checked = false; toast(`${NEED(MK.g)}개까지 고릅니다`); return; } MK.pick.push(k); } else MK.pick = MK.pick.filter(x => x !== k);
  save(); $('mkCnt').textContent = `${MK.pick.length} / ${NEED(MK.g)} 선택`; $('mkBegin').disabled = MK.pick.length !== NEED(MK.g);
});
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  let p; try { p = JSON.parse(await f.text()); } catch { toast('학습 기록 파일이 아닙니다'); return; }
  const next = p.state || p; if (!next.cards || !Array.isArray(next.attempts)) { toast('학습 기록 파일이 아닙니다'); return; }
  const before = { cards: Object.keys(S.cards).length, attempts: S.attempts.length };
  if (importMode === 'replace') { if (!confirm('지금 기기의 기록을 이 파일로 통째로 바꿀까요? 지금 기록은 사라집니다.')) return; S = { ...load(), ...next }; }
  else S = mergeState(S, { cards: {}, attempts: [], drafts: {}, days: {}, ...next });
  save();
  let penN = 0;
  if (p.pen) { for (const [k, v] of Object.entries(p.pen)) { if (importMode === 'replace' || (await IDB.get(k)) === undefined) { await IDB.set(k, v); penN++; } } }
  show('today');
  toast(importMode === 'replace' ? '기록을 바꿨습니다' : `합쳤습니다: 문항 ${before.cards}→${Object.keys(S.cards).length}, 쓰기 ${before.attempts}→${S.attempts.length}${penN ? `, 손글씨 ${penN}건` : ''}`);
});
$('recMenu').addEventListener('toggle', async () => {
  if (!$('recMenu').open) return;
  try { const all = await IDB.all(), n = Object.keys(all).length; $('penSize').textContent = n ? `(${n}건, 약 ${kb(new Blob([JSON.stringify(all)]).size)})` : '(없음)'; } catch (_) { $('penSize').textContent = ''; }
});

setTopic(isAuto() ? currentAutoTopic() : Number(S.topic || 0));
$('topicSel').innerHTML = `<option value="auto">오늘의 추천 (출제 비례) — ${esc(D.topics[autoTopic().i].subnote.topic)}</option>` +
  D.topics.map((t, i) => `<option value="${i}">${esc(t.subnote.topic)} (${t.answers.length}문항 · 출제 ${t.freq ? t.freq.tot : '-'}회)</option>`).join('');
$('topicSel').value = isAuto() ? 'auto' : String(TI);
$('topicSel').addEventListener('change', e => {
  if (e.target.value === 'auto') { S.topicMode = 'auto'; setTopic(currentAutoTopic()); }
  else { S.topicMode = 'manual'; setTopic(Number(e.target.value)); S.topic = TI; }
  save(); show('today'); toast(`${SN.topic} 주제로 바꿨습니다`);
});
$('topicLine').textContent = `자료 ${D.built}`;
show('today');
const setTopH = () => document.documentElement.style.setProperty('--topH', document.querySelector('.top').offsetHeight + 'px');
setTopH(); addEventListener('resize', setTopH); addEventListener('orientationchange', () => setTimeout(setTopH, 300));
