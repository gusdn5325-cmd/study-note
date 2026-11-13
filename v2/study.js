// 하루 학습 흐름: 오늘 할 일 → 서브노트 읽기 → 가리고 떠올리기 → 시간 재고 쓰기 → 모범답안 비교 → 복습 예약
// 내용은 data.js(STUDY_DATA), 채점은 scoring.js(02 앱 복사본)를 쓴다. 기록은 이 브라우저(localStorage)에 저장.
'use strict';
const D = window.STUDY_DATA;
const KEY = 'pe-study-v1';
const LADDER = [1, 3, 7, 14, 30];
const STEPS = ['read', 'recall', 'write', 'compare', 'review'];

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
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('브라우저 저장소를 쓸 수 없습니다. 기록 내보내기를 이용하세요'); } }
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2000); }

// ── 오늘의 추천: 몫 채우기 + 약점 가중 ──
// 비중 = (누적 출제 + k × 최근 6회 출제) × 약점계수, k는 평소 2·시험 4주 전부터 4
// 매일 '비중 × 지금까지 공부한 날 수' 대비 가장 덜 한 주제를 고른다(운에 의한 치우침·긴 공백 방지). 복습이 쌓였으면 그 주제 먼저.
const EXAM = D.examDate ? new Date(D.examDate + 'T00:00:00') : null;
const daysToExam = () => EXAM ? Math.ceil((EXAM - today()) / 86400000) : null;
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
  const pick = (due[0] || fresh[0] || ANS[0]).id;
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
    <h1>오늘 할 일</h1><p class="sub">${esc(SN.topic)} · ${esc(SN.count)} · 공부한 문항 ${seen}/${ANS.length} · 오늘 복습 ${due}건</p>
    ${isAuto() ? (() => { const p = autoTopic(), f = D.topics[TI].freq || {}, dd = daysToExam();
      const head = dd !== null ? `시험까지 D-${dd}${recentK() === 4 ? ' (막판 4주: 최근 출제 비중 강화)' : ''}. ` : '';
      return `<p class="note">${head}${p.why === 'due' ? `복습할 문항이 ${p.n}건 쌓여 있어 이 주제를 먼저 골랐습니다.` : `오늘의 추천: 이 주제의 목표 비중은 ${Math.round(p.share * 100)}%(누적 ${f.tot}회·최근 6회 ${f.rec}회${p.weak > 1.05 ? '·약점 가중' : p.weak < 0.95 ? '·잘 아는 주제라 감량' : ''})인데, 지금까지 ${p.done}일 공부해 목표(${p.target.toFixed(1)}일)보다 가장 덜 했습니다.`}</p>`; })() : ''}
    <div class="todo">${STEPS.map((s, i) => `<div class="${t.done.includes(s) ? 'done' : ''}"><b>${i + 1}단계</b>${names[s]}${t.done.includes(s) ? ' · 완료' : ''}</div>`).join('')}</div>
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

// ── 1. 서브노트 읽기 ──
function subnoteHtml(hide) {
  const keys = [...SN.keywords].sort((a, b) => b.length - a.length);
  const blankify = text => {
    if (!hide) return esc(text);
    const re = new RegExp(`(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|\\d+(?:\\.\\d+)?\\s*(?:년|%|개))`, 'g');
    let out = '', last = 0;
    for (const m of text.matchAll(re)) { out += esc(text.slice(last, m.index)) + `<button class="blank" type="button">${esc(m[0])}</button>`; last = m.index + m[0].length; }
    return out + esc(text.slice(last));
  };
  const cell = v => hide ? `<button class="blank" type="button">${esc(v)}</button>` : esc(v);
  return `
    <h2>① 정의</h2><p class="def">${blankify(SN.definition)}</p>
    <h2>② 목차 (기본 뼈대)</h2><ol class="outline">${SN.outline.map(o => `<li>${blankify(o)}</li>`).join('')}</ol>
    <h2>③ 핵심어</h2><div class="chips">${SN.keywords.map(k => hide ? `<button class="blank" type="button">${esc(k)}</button>` : `<span class="chip">${esc(k)}</span>`).join('')}</div>
    <h2>④ 수치·조항</h2><table><tr><th>내용</th><th>수치</th><th>근거</th></tr>${SN.facts.map(f => `<tr><td>${esc(f.item)}</td><td>${cell(f.value)}</td><td>${cell(f.basis)}</td></tr>`).join('')}</table>
    ${SN.lists.map(l => `<h2>${esc(l.title)}</h2><ol class="outline">${l.items.map(i => `<li>${cell(i)}</li>`).join('')}</ol>`).join('')}
    <h2>⑤ 그림: 수립 절차 흐름도</h2>${hide ? '<p class="note">흐름도는 빈 종이에 직접 그려 본 뒤 아래 버튼으로 확인합니다.</p><details><summary>흐름도 보기</summary>' : ''}<pre class="fig">${esc(SN.figure)}</pre>${hide ? '</details>' : ''}
    <h2>⑥ 실무 의견</h2><ol class="outline">${SN.opinions.map(o => `<li>${blankify(o)}</li>`).join('')}</ol>
    ${hide ? '' : `<h2>문제점과 개선</h2><table><tr><th>분야</th><th>문제점</th><th>개선</th></tr>${SN.problems.map(p => `<tr><td>${esc(p.field)}</td><td>${esc(p.problem)}</td><td>${esc(p.fix)}</td></tr>`).join('')}</table>
    <h2>⑦ 문제 유형별 강조할 곳</h2><table><tr><th>유형</th><th>강조</th></tr>${SN.types.map(t => `<tr><td>${esc(t.type)}</td><td>${esc(t.focus)}</td></tr>`).join('')}</table>
    <h2>⑧ 근거</h2><ul class="note">${SN.sources.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`}`;
}
function renderRead() {
  $('v-read').innerHTML = `<h1>1단계 · 서브노트 읽기</h1><p class="sub">${esc(SN.topic)} · <span class="badge ok">${esc(SN.status)}</span> · 목차와 숫자를 소리 내어 한 번 읽습니다.</p>
    <div class="panel">${subnoteHtml(false)}</div><button class="primary" data-done="read" data-go="recall">다 읽었습니다 → 2단계</button>`;
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
  $('v-write').innerHTML = `<h1>3단계 · 시간 재고 쓰기</h1><p class="sub">모범답안을 보지 않고 씁니다. 권장 분량 ${target}자(답안지 ${a.gyosi === 1 ? '약 1.3쪽' : '3~4쪽'}).</p>
    <div class="panel"><div class="row"><span class="badge">${a.gyosi}교시 · ${a.max}점</span><span class="badge">${esc(a.type)}</span></div><p class="q">${esc(a.question)}</p>
      <div class="row"><span class="timer" id="timer">${minutes(a)}:00</span><button class="ghost" id="timerBtn" type="button">시작</button><span class="note">목표 ${minutes(a)}분</span>
      <div class="meter"><i id="lenBar" style="width:0"></i></div><span class="note" id="lenText">0 / ${target}자</span></div></div>
    <textarea id="answer" placeholder="Ⅰ. 개요 → Ⅱ. 본론(번호체계) → 표·모식도 → 근거 조항 → 실무 의견">${esc(draft)}</textarea>
    <div class="row" style="margin-top:10px"><button class="ghost" id="saveDraft" type="button">임시저장</button><button class="primary" id="submitAnswer" type="button">작성 완료 → 4단계 비교</button></div>`;
  remain = minutes(a) * 60; spent = 0; clearInterval(timer); timer = null;
  const ta = $('answer'); const upd = () => { const n = ta.value.length; $('lenText').textContent = `${n} / ${target}자`; $('lenBar').style.width = Math.min(100, n / target * 100) + '%'; };
  ta.addEventListener('input', upd); upd();
}
function tick() { remain--; spent++; const m = Math.floor(Math.abs(remain) / 60), s = String(Math.abs(remain) % 60).padStart(2, '0'); const el = $('timer'); if (!el) return; el.textContent = `${remain < 0 ? '+' : ''}${m}:${s}`; el.classList.toggle('over', remain < 0); }

// ── 4. 비교 ──
function renderCompare() {
  const a = answerOf(pickQuestion()), last = S.attempts.find(x => x.key === a.id && x.day === dayKey());
  if (!last) { $('v-compare').innerHTML = `<h1>4단계 · 모범답안과 비교</h1><div class="panel">3단계에서 답안을 먼저 써 주세요.<br><br><button class="primary" data-go="write">3단계로</button></div>`; return; }
  const q = { card, ex: exOf(a.id) }, r = scoreAnswer(q, last.text), ks = keywords(q), an = normal(last.text);
  $('v-compare').innerHTML = `<h1>4단계 · 모범답안과 비교</h1><p class="sub">점수는 모범답안 핵심어·형식·분량으로 계산한 "빠진 것 확인용"입니다. 실제 채점과 다릅니다.</p>
    <div class="result"><div class="row"><span class="score">${r.score} / ${r.max}</span><span>${last.text.length}자 · ${Math.round(last.secs / 60)}분 사용</span></div>
      ${r.missing.length ? `<ul>${r.missing.map(m => `<li>${esc(m.heading)} — ${m.earned}/${m.max}점, 빠진 것: ${esc((m.keywords || []).join(' · ') || '설명 보강')}</li>`).join('')}</ul>` : '<p>소제목별 핵심어를 모두 다뤘습니다.</p>'}
      ${r.numberIssues.length ? `<p>수치 확인: ${r.numberIssues.map(n => `${esc(n.key)} 모범 ${esc(n.model)} / 내 답안 ${esc(n.answer)}`).join(' · ')}</p>` : ''}
      ${r.missingNumbers.length ? `<p>빠진 수치: ${esc(r.missingNumbers.join(' · '))}</p>` : ''}
      ${r.presentationMissing.length ? `<p>형식 보완: ${esc(r.presentationMissing.join(' · '))}</p>` : ''}
      ${r.notices.length ? `<p>명칭 확인: ${esc(r.notices.join(' · '))}</p>` : ''}</div>
    <h2>핵심어 (초록 = 썼음, 빨강 = 빠짐)</h2><div class="chips">${ks.map(k => `<span class="chip ${termHit(k, an) ? 'hit' : 'miss'}">${esc(k)}</span>`).join('')}</div>
    <h2>나란히 보기</h2><div class="two"><div class="panel"><b>내 답안</b><pre>${esc(last.text)}</pre></div><div class="panel"><b>모범답안</b> ${badge(a)}<pre>${esc(a.answer)}</pre><p class="note">근거: ${esc(a.basis)}</p></div></div>
    <button class="primary" data-done="compare" data-go="review">비교 끝 → 5단계 복습 예약</button>`;
}

// ── 5. 복습 예약 ──
function renderReview() {
  const a = answerOf(pickQuestion()), c = S.cards[a.id];
  $('v-review').innerHTML = `<h1>5단계 · 복습 예약</h1><p class="sub">이 문제를 다시 볼 날을 정합니다. 간격은 1·3·7·14·30일입니다.</p>
    <div class="panel"><p class="q">${esc(a.question)}</p><p class="note">${c ? `지금 ${LADDER[c.level]}일 간격 · 다음 복습 ${fmt(c.next)}` : '처음 공부한 문제입니다.'}</p>
    <div class="rate">${[['again', '다시', '내일'], ['hard', '어려움', '간격 유지'], ['good', '보통', '다음 간격'], ['easy', '쉬움', '한 칸 건너뛰기']].map(([v, t, s]) => `<button type="button" data-rate="${v}"><b>${t}</b><span>${s}</span></button>`).join('')}</div></div>
    <h2>복습 일정</h2><div class="panel">${schedule()}</div>`;
}
function schedule() {
  const rows = ANS.filter(a => S.cards[a.id]).sort((x, y) => new Date(S.cards[x.id].next) - new Date(S.cards[y.id].next));
  return rows.length ? rows.map(a => `<div class="list-item"><span class="badge ${isDue(a.id) ? 'due' : ''}">${fmt(S.cards[a.id].next)}</span><span>${esc(a.question)}</span><span class="note">${LADDER[S.cards[a.id].level]}일 간격</span></div>`).join('') : '<p class="note">아직 예약한 문제가 없습니다.</p>';
}
function rate(v) {
  const a = answerOf(pickQuestion()), prev = S.cards[a.id];
  let level = prev ? prev.level : -1;
  level = v === 'again' ? 0 : v === 'hard' ? Math.max(0, level) : v === 'good' ? Math.min(LADDER.length - 1, level + 1) : Math.min(LADDER.length - 1, level + 2);
  const next = today(); next.setDate(next.getDate() + (v === 'again' ? 1 : LADDER[level]));
  S.cards[a.id] = { level, next: next.toISOString(), reviews: (prev ? prev.reviews : 0) + 1 };
  markDone('review'); save(); toast(`${fmt(next.toISOString())}에 다시 봅니다`); renderReview();
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
const RENDER = { today: renderToday, read: renderRead, recall: renderRecall, write: renderWrite, compare: renderCompare, review: renderReview, list: renderList };
function show(step) {
  if (step !== 'write' && timer) { clearInterval(timer); timer = null; }
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === `v-${step}`));
  RENDER[step](); renderNav(step); window.scrollTo(0, 0);
}
function renderNav(active) {
  const t = todayState();
  document.querySelectorAll('.step').forEach(b => { b.classList.toggle('on', b.dataset.step === (active || document.querySelector('.view.on')?.id.slice(2))); b.classList.toggle('done', t.done.includes(b.dataset.step)); });
}

document.addEventListener('click', e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.classList.contains('blank')) { el.classList.add('shown'); updateRecallCount(); return; }
  if (el.dataset.step) return show(el.dataset.step);
  if (el.dataset.done) markDone(el.dataset.done);
  if (el.dataset.go) return show(el.dataset.go);
  if (el.dataset.recall) { const t = todayState(); t.recall = el.dataset.recall; markDone('recall'); save(); return show(['some', 'none'].includes(el.dataset.recall) ? 'read' : 'write'); }
  if (el.dataset.rate) return rate(el.dataset.rate);
  if (el.dataset.pick) { todayState().q = el.dataset.pick; const t = todayState(); t.done = t.done.filter(s => s === 'read' || s === 'recall'); save(); toast('오늘의 문제를 바꿨습니다'); return show('today'); }
  if (el.id === 'revealAll') { document.querySelectorAll('#recallBody .blank').forEach(b => b.classList.add('shown')); updateRecallCount(); }
  if (el.id === 'timerBtn') { if (timer) { clearInterval(timer); timer = null; el.textContent = '계속'; } else { timer = setInterval(tick, 1000); el.textContent = '일시정지'; } }
  if (el.id === 'saveDraft') { S.drafts[pickQuestion()] = $('answer').value; save(); toast('임시저장했습니다'); }
  if (el.id === 'submitAnswer') {
    const text = $('answer').value.trim(); if (text.length < 50) { toast('50자 이상 쓴 뒤 완료하세요'); return; }
    const key = pickQuestion(); S.drafts[key] = text;
    S.attempts = S.attempts.filter(x => !(x.key === key && x.day === dayKey()));
    S.attempts.unshift({ key, day: dayKey(), text, secs: spent, at: new Date().toISOString() });
    clearInterval(timer); timer = null; markDone('write'); save(); show('compare');
  }
  if (el.id === 'exportBtn') { const blob = new Blob([JSON.stringify({ app: '수자원기술사 학습', at: new Date().toISOString(), state: S }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `기술사학습기록_${dayKey()}.json`; a.click(); }
  if (el.id === 'importBtn') $('importFile').click();
});
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const p = JSON.parse(await f.text()), next = p.state || p; if (!next.cards || !Array.isArray(next.attempts)) throw 0; if (!confirm('현재 기록을 이 파일로 바꿀까요?')) return; S = { ...load(), ...next }; save(); show('today'); toast('기록을 가져왔습니다'); } catch { toast('학습 기록 파일이 아닙니다'); }
  e.target.value = '';
});

setTopic(isAuto() ? autoTopic().i : Number(S.topic || 0));
$('topicSel').innerHTML = `<option value="auto">오늘의 추천 (출제 비례) — ${esc(D.topics[autoTopic().i].subnote.topic)}</option>` +
  D.topics.map((t, i) => `<option value="${i}">${esc(t.subnote.topic)} (${t.answers.length}문항 · 출제 ${t.freq ? t.freq.tot : '-'}회)</option>`).join('');
$('topicSel').value = isAuto() ? 'auto' : String(TI);
$('topicSel').addEventListener('change', e => {
  if (e.target.value === 'auto') { S.topicMode = 'auto'; setTopic(autoTopic().i); }
  else { S.topicMode = 'manual'; setTopic(Number(e.target.value)); S.topic = TI; }
  save(); show('today'); toast(`${SN.topic} 주제로 바꿨습니다`);
});
$('topicLine').textContent = `자료 ${D.built}`;
show('today');
