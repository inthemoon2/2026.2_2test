/* 관리자 화면: 현황 · 명단/비밀번호 · 채점 · 동료평가 · 설정 */
(function () {
  const { esc, $, $$, api, toast } = PJ;
  const app = document.getElementById('app');
  const A = { token: PJ.store.get('pj_admin') || '', tab: 'overview', ov: null, schema: null, team: null, filter: '', roster: null, peer: null, lastPw: null };

  const call = async function (action, payload) {
    try { return await api(action, payload, A.token); }
    catch (e) { if (e.code === 'BAD_TOKEN' || e.code === 'EXPIRED') { logout(e.message); } throw e; }
  };
  const guard = function (fn) { return async function () { try { return await fn.apply(this, arguments); } catch (e) { toast(e.message, 'err'); } }; };

  /* ───────── 로그인 ───────── */
  function renderLogin(msg) {
    app.innerHTML = '<div class="wrap login"><div class="card"><h1>관리자 로그인</h1>' +
      (PJ.apiReady() ? '' : '<div class="banner bad">config.js 의 API_URL 이 아직 설정되지 않았어요. (README 4단계)</div>') +
      (msg ? '<div class="banner warn" role="alert">' + esc(msg) + '</div>' : '') +
      '<form id="lf"><p><label class="f" for="pw">관리자 비밀번호</label><input id="pw" type="password" required></p><p><button class="btn" style="width:100%;justify-content:center">로그인</button></p></form>' +
      '<p class="small muted">비밀번호는 Apps Script 의 "스크립트 속성 ADMIN_PASSWORD" 에 정한 값입니다.</p><p class="small"><a href="index.html">← 학생 화면</a></p></div></div>';
    $('#lf').addEventListener('submit', async function (e) {
      e.preventDefault();
      try { const r = await api('adminLogin', { pw: $('#pw').value }); A.token = r.token; PJ.store.set('pj_admin', r.token); boot(); } catch (x) { renderLogin(x.message); }
    });
  }
  function logout(msg) { A.token = ''; PJ.store.del('pj_admin'); renderLogin(msg); }

  /* ───────── 틀 ───────── */
  async function boot() {
    if (!A.token) return renderLogin();
    try { A.schema = A.schema || await api('schema'); await loadOverview(); } catch (e) { if (e.code === 'BAD_TOKEN' || e.code === 'EXPIRED') return logout(e.message); app.innerHTML = '<div class="wrap"><div class="banner bad">' + esc(e.message) + '</div></div>'; return; }
    const tabs = [['overview', '진행 현황'], ['roster', '명단 · 비밀번호'], ['score', '채점 · 세특 재료'], ['table', '채점표'], ['peer', '동료평가 가져오기'], ['settings', '설정']];
    app.innerHTML = '<header class="top"><div class="wrap"><b>관리자 · 사회문제 해결 기계학습 프로젝트</b><span class="grow"></span><a class="btn sm" href="index.html">학생 화면</a><button class="btn sm" id="lo">로그아웃</button></div></header>' +
      '<nav class="nav" id="nav">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav><main class="wrap wide" id="main"></main>';
    $('#lo').onclick = function () { logout(''); };
    $('#nav').addEventListener('click', function (e) { const b = e.target.closest('[data-t]'); if (b) go(b.dataset.t); });
    $('#main').addEventListener('click', onClick);
    $('#main').addEventListener('change', onChange);
    go(A.tab);
  }
  let mouseDown = false;
  document.addEventListener('mousedown', function () { mouseDown = true; }, true);
  document.addEventListener('mouseup', function () { mouseDown = false; }, true);
  setInterval(async function () {
    if (A.tab !== 'overview' || !A.token || document.hidden || mouseDown) return;
    const ae = document.activeElement; if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.id !== 'clsf') return;
    try { await loadOverview(); if (A.tab === 'overview' && !mouseDown) { const m = $('#main'); const y = window.scrollY; m.innerHTML = overviewHtml(); window.scrollTo(0, y); } } catch (e) { /* 다음 주기에 다시 */ }
  }, 15000);

  async function go(t) {
    const my = (A.nav = (A.nav || 0) + 1);    // 탭을 빠르게 바꿨을 때 먼저 시작한 화면이 나중에 덮어쓰지 않도록
    A.tab = t;
    $$('#nav button').forEach(function (b) { if (b.dataset.t === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const main = $('#main');
    try {
      if (t === 'overview') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = overviewHtml(); }
      else if (t === 'roster') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = rosterHtml(); }
      else if (t === 'score') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = scoreShellHtml(); if (A.team) loadTeam(A.team.team ? A.team.team.tid : A.team); }
      else if (t === 'table') { main.innerHTML = '<p class="muted">채점표를 불러오는 중…</p>'; const r = await call('scoreTable'); if (my !== A.nav) return; A.table = r; main.innerHTML = tableHtml(); }
      else if (t === 'peer') main.innerHTML = peerHtml();
      else if (t === 'settings') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = settingsHtml(); }
    } catch (e) { toast(e.message, 'err'); }
  }
  async function loadOverview() {
    const base = new URL('.', location.href).href.replace(/\/$/, '');
    A.ov = await call('adminOverview', { siteUrl: base });
  }

  /* ───────── 진행 현황 ───────── */
  function pageLabel(id) { if (!id || id === 'home') return '팀 홈'; const pg = (A.ov.pages || []).filter(function (p) { return p.id === id; })[0]; return pg ? pg.no + '단계 ' + pg.title : id; }
  function fieldLabel(id) { if (!id) return ''; let r = ''; ((A.schema || {}).pages || []).forEach(function (p) { p.sections.forEach(function (s) { s.fields.forEach(function (f) { if (f.id === String(id).split('@')[0]) r = f.label; }); }); }); return r ? '보는 칸: ' + r : ''; }
  function overviewHtml() {
    const o = A.ov, classes = Array.from(new Set(o.teams.map(function (t) { return t.cls; })));
    const teams = o.teams.filter(function (t) { return !A.filter || t.cls === A.filter; });
    const sub = teams.filter(function (t) { return t.status === '제출완료'; }).length;
    if (!o.teams.length) return '<div class="card"><h2>아직 등록된 조가 없어요</h2><p>"명단 · 비밀번호" 탭에서 역할표 파일을 올리면 조별 프로젝트 공간이 만들어집니다.</p><button class="btn" data-t2="roster">명단 올리러 가기</button></div>';
    return '<div class="card"><div class="row"><h2 class="grow" style="margin:0">진행 현황</h2>' +
      '<select id="clsf" style="width:auto"><option value="">전체 반</option>' + classes.map(function (c) { return '<option value="' + esc(c) + '"' + (A.filter === c ? ' selected' : '') + '>' + esc(c) + '반</option>'; }).join('') + '</select>' +
      '<button class="btn ghost sm" data-act="refresh">새로고침</button></div>' +
      '<p class="small muted">조 ' + teams.length + '개 · 제출 완료 ' + sub + '개. 단계별 숫자는 필수 항목 작성 비율(%)입니다. <b>접속 중</b>은 최근 40초 안에 화면을 연 학생과 그 위치이고, 15초마다 자동으로 갱신돼요.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>반-조</th><th>분야</th><th>상태</th><th>전체</th>' + o.pages.map(function (p) { return '<th title="' + esc(p.title) + '">' + p.no + '단계</th>'; }).join('') + '<th>접속 중 (위치)</th><th>마지막 수정</th><th>점검</th><th></th></tr></thead><tbody>' +
      teams.map(function (t) {
        const warn = []; if (!t.hasPw) warn.push('<span class="badge warn">비번 미발급</span>'); if (t.noSid) warn.push('<span class="badge warn">학번 ' + t.noSid + '명 없음</span>'); if (t.nStudents < 3 || t.nStudents > 5) warn.push('<span class="badge warn">' + t.nStudents + '명</span>');
        return '<tr><td><b>' + esc(t.cls) + '-' + esc(t.no) + '</b></td><td>' + esc(t.field) + '</td><td>' + (t.status === '제출완료' ? '<span class="badge ok">제출 완료</span>' : '<span class="badge">작성 중</span>') + (t.scored ? ' <span class="badge brand">채점됨</span>' : '') + '</td>' +
          '<td style="min-width:90px"><div class="bar' + (t.progress === 100 ? ' full' : '') + '"><i style="width:' + t.progress + '%"></i></div><span class="small">' + t.progress + '%</span></td>' +
          o.pages.map(function (p) { const v = t.pages[p.id]; return '<td class="small">' + (v == null ? '-' : v + '%') + '</td>'; }).join('') +
          '<td class="small">' + (t.online && t.online.length ? t.online.map(function (p) { return '<div title="' + esc(fieldLabel(p.field)) + '"><span class="dot"></span>' + esc(p.name) + ' · ' + esc(pageLabel(p.page)) + '</div>'; }).join('') : '<span class="muted">-</span>') + '</td><td class="small">' + esc(t.lastEdit || '-') + '<br><span class="muted">' + esc(t.lastBy || '') + '</span></td><td>' + warn.join(' ') + '</td>' +
          '<td style="white-space:nowrap"><button class="btn sm ghost" data-open="' + esc(t.tid) + '">채점·상세</button> <button class="btn sm ghost" data-view="' + esc(t.tid) + '">화면 보기</button> ' + (t.reportId ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(PJ.reportLink(t.reportId)) + '">보고서</a> ' : '') + (t.status === '제출완료' ? '<button class="btn sm danger ghost" data-reopen="' + esc(t.tid) + '">수정 허용</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ───────── 명단 올리기 ───────── */
  const ROLE_PAT = [/매니저|팀장/, /데이터\s*엔지니어|전처리/, /모델\s*개발|코랩/, /도메인|해결\s*방안/, /윤리|소통/];
  function splitNames(cell) {
    const out = [];
    String(cell == null ? '' : cell).replace(/\([^)]*\)|（[^）]*）/g, '').split(/[,，、;\n]+/).forEach(function (p) {
      p = p.trim(); if (!p) return;
      const toks = p.split(/\s+/);
      if (toks.length > 1 && toks.every(function (t) { return /^[가-힣]{2,5}$/.test(t); })) toks.forEach(function (t) { out.push(t); });
      else out.push(p.replace(/\s+/g, ''));
    });
    return out;
  }
  function parseRoster(rows) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); });
    let start = -1;
    for (let i = 0; i < rows.length; i++) if (/^\d+\s*조?$/.test(rows[i][0] || '')) { start = i; break; }
    if (start < 0) throw new Error('"1조", "2조"처럼 조 번호로 시작하는 줄을 찾지 못했어요. 첫 번째 칸(열)이 조 번호인지 확인해 주세요.');
    const width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    const colText = []; for (let j = 0; j < width; j++) colText[j] = rows.slice(0, start).map(function (r) { return r[j] || ''; }).join(' ');
    const used = {}, roleCols = ROLE_PAT.map(function (re) { for (let j = 1; j < width; j++) if (!used[j] && re.test(colText[j])) { used[j] = 1; return j; } return -1; });
    let fieldCol = -1; for (let j = 1; j < width; j++) if (/분야|진로/.test(colText[j])) { fieldCol = j; break; }
    const warnings = [];
    if (roleCols.some(function (c) { return c < 0; })) {
      if (width >= 7) { warnings.push('제목 줄에서 역할 열을 모두 찾지 못해 "조 / 분야 / 5개 역할" 순서(3~7번째 열)로 읽었어요. 아래 미리보기를 꼭 확인하세요.'); for (let k = 0; k < 5; k++) roleCols[k] = k + 2; fieldCol = 1; }
      else throw new Error('역할 열(프로젝트 매니저 ~ AI 윤리·소통 담당)을 찾지 못했어요. 제목 줄에 역할 이름이 있는지 확인해 주세요.');
    }
    if (fieldCol < 0) fieldCol = 1;
    const teams = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i], no = parseInt(r[0], 10); if (!(no >= 1)) continue;
      const map = {}, order = [];
      roleCols.forEach(function (c, k) { splitNames(r[c]).forEach(function (n) { if (!map[n]) { map[n] = []; order.push(n); } map[n].push(A.schema.roles[k]); }); });
      teams.push({ no: no, field: r[fieldCol] || '', members: order.map(function (n) { return { name: n, roles: map[n] }; }) });
    }
    return { teams: teams, warnings: warnings };
  }
  function rosterHtml() {
    const o = A.ov;
    return '<div class="card"><h2>① 역할표 올리기 (반별)</h2>' +
      '<p class="small">역할표 사진과 같은 모양의 파일(<b>조 · 분야 · ①프로젝트 매니저 … ⑤AI 윤리·소통 담당</b>, 이름은 쉼표로 구분)을 올려요. 엑셀(.xlsx), CSV, 또는 표를 복사해서 붙여넣기 모두 가능합니다. 같은 반을 다시 올리면 <b>조별 내용은 그대로 두고 명단만 갱신</b>돼요.</p>' +
      '<div class="row"><label class="f" for="rcls" style="margin:0">반</label><input id="rcls" type="number" min="1" max="99" style="width:90px" value="1"><input type="file" id="rfile" accept=".csv,.tsv,.txt,.xlsx,.xls"></div>' +
      '<details><summary>또는 표를 복사해 붙여넣기</summary><textarea id="rpaste" placeholder="엑셀·한글 표를 복사해서 여기에 붙여넣으세요"></textarea><button class="btn ghost sm" data-act="rparse-paste">붙여넣은 내용 확인</button></details>' +
      '<div id="rprev"></div></div>' +
      '<div class="card"><h2>② 학번 명부 올리기 (반별)</h2><p class="small">역할표에는 학번이 없어서, <b>학번과 이름이 있는 명부</b>를 따로 올려 이름으로 연결해요. 열 제목에 "학번", "이름"이 있으면 자동으로 찾아요. 학번이 5자리(예: 10101)라면 반 자리도 확인해 줍니다.</p>' +
      '<div class="row"><label class="f" for="icls" style="margin:0">반</label><input id="icls" type="number" min="1" max="99" style="width:90px" value="1"><input type="file" id="ifile" accept=".csv,.tsv,.txt,.xlsx,.xls"></div>' +
      '<details><summary>또는 붙여넣기</summary><textarea id="ipaste" placeholder="학번  이름 (한 줄에 한 명)"></textarea><button class="btn ghost sm" data-act="iparse-paste">붙여넣은 내용 올리기</button></details>' +
      '<div id="iprev"></div><p class="small muted">학번이 비어 있는 학생은 "채점 · 세특 재료" 탭에서 직접 입력할 수도 있어요.</p></div>' +
      '<div class="card"><h2>③ 조 비밀번호 발급</h2><p class="small">비밀번호는 <b>발급하는 이 순간에만 화면에 보여요</b>(시트에는 암호화된 값만 저장). 반드시 CSV로 저장하거나 인쇄해 두세요. 한 번 발급하면 재발급 전까지 유지됩니다.</p>' +
      '<div class="row"><button class="btn" data-act="pw-new">아직 발급 안 된 조만 발급</button><button class="btn ghost" data-act="pw-all">전체 재발급(기존 비밀번호 무효)</button></div>' +
      '<p class="small muted">현재 ' + o.teams.length + '개 조 중 비밀번호 미발급 ' + o.teams.filter(function (t) { return !t.hasPw; }).length + '개 · 학번 누락 학생이 있는 조 ' + o.teams.filter(function (t) { return t.noSid; }).length + '개</p><div id="pwout">' + pwHtml() + '</div></div>';
  }
  function pwHtml() {
    const L = A.lastPw; if (!L) return '';
    return '<div class="banner warn no-print"><b>지금 저장하세요!</b> 이 화면을 벗어나면 비밀번호를 다시 볼 수 없어요(재발급은 가능).</div>' +
      '<div class="row no-print"><button class="btn ghost sm" data-act="pw-csv">CSV로 저장</button><button class="btn ghost sm" data-act="pw-print">쪽지로 인쇄</button></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>반-조</th><th>분야</th><th>비밀번호</th><th>조원</th></tr></thead><tbody>' + L.map(function (x) { return '<tr><td>' + esc(x.cls) + '-' + esc(x.no) + '</td><td>' + esc(x.field) + '</td><td><code style="font-size:1.1rem;font-weight:700">' + esc(x.pw) + '</code></td><td>' + esc(x.members.join(', ')) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div id="slips" class="hide">' + L.map(function (x) { return '<div class="pw-slip card" style="border:1px dashed #666;margin:0 0 10px"><b>' + esc(x.cls) + '반 ' + esc(x.no) + '조 · ' + esc(x.field) + '</b><br>조 비밀번호: <b style="font-size:1.3rem">' + esc(x.pw) + '</b><br><span class="small">로그인: 학번 + 이름 + 이 비밀번호 · 우리 조에게만 알려 주세요.</span></div>'; }).join('') + '</div>';
  }
  async function previewRoster(rows) {
    const cls = $('#rcls').value;
    let res; try { res = parseRoster(rows); } catch (e) { $('#rprev').innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; A.roster = null; return; }
    A.roster = { cls: cls, teams: res.teams };
    const warn = res.warnings.slice();
    res.teams.forEach(function (t) { if (t.members.length < 3 || t.members.length > 5) warn.push(t.no + '조 인원이 ' + t.members.length + '명이에요.'); A.schema.roles.forEach(function (r) { if (!t.members.some(function (m) { return m.roles.indexOf(r) >= 0; })) warn.push(t.no + '조에 "' + r + '" 담당이 없어요.'); }); });
    $('#rprev').innerHTML = (warn.length ? '<div class="banner warn"><b>확인이 필요해요</b><ul class="small">' + warn.slice(0, 15).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<h3>미리보기: ' + esc(cls) + '반 · ' + res.teams.length + '개 조</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>조</th><th>분야</th><th>조원 (역할)</th></tr></thead><tbody>' + res.teams.map(function (t) { return '<tr><td>' + t.no + '</td><td>' + esc(t.field) + '</td><td>' + t.members.map(function (m) { return esc(m.name) + ' <span class="muted small">(' + esc(m.roles.map(function (r) { return r.replace(/\(.*\)/, ''); }).join('·')) + ')</span>'; }).join(' / ') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p><button class="btn" data-act="rsend">이 내용으로 ' + esc(cls) + '반 조 만들기 / 갱신</button></p>';
  }
  function parseIds(rows) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); });
    let hi = -1, sc = -1, nc = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) { const a = rows[i].findIndex(function (c) { return /학번/.test(c); }), b = rows[i].findIndex(function (c) { return /^이름$|성명/.test(c); }); if (a >= 0 && b >= 0) { hi = i; sc = a; nc = b; break; } }
    const out = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]; let sid = '', nm = '';
      if (hi >= 0) { sid = r[sc]; nm = r[nc]; }
      else { r.forEach(function (c) { if (/^\d{3,10}$/.test(c) && !sid) sid = c; else if (/^[가-힣]{2,5}$/.test(c) && !nm) nm = c; }); }
      if (sid && nm) out.push({ sid: sid, name: nm });
    }
    return out;
  }
  async function sendIds(rows) {
    const list = parseIds(rows);
    if (!list.length) { $('#iprev').innerHTML = '<div class="banner bad">학번·이름을 찾지 못했어요. 열 제목이 "학번", "이름"인지 확인해 주세요.</div>'; return; }
    const r = await call('importIds', { cls: $('#icls').value, rows: list });
    $('#iprev').innerHTML = '<div class="banner ok">학번 ' + r.matched + '명을 연결했어요 (명부 ' + list.length + '명 중).</div>' +
      (r.unmatched.length ? '<div class="banner warn"><b>역할표에 없는 이름</b> ' + esc(r.unmatched.join(', ')) + '</div>' : '') +
      (r.ambiguous.length ? '<div class="banner warn"><b>같은 반에 이름이 겹쳐 연결하지 못함</b> ' + esc(r.ambiguous.join(', ')) + ' → 채점 탭에서 직접 입력</div>' : '') +
      (r.missing.length ? '<div class="banner warn"><b>아직 학번이 없는 학생</b> ' + esc(r.missing.join(', ')) + '</div>' : '') +
      (r.warnings.length ? '<div class="banner warn"><ul class="small">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '');
  }

  /* ───────── 채점 ───────── */
  function scoreShellHtml() {
    const o = A.ov;
    if (!o.teams.length) return '<div class="card">먼저 명단을 올려 주세요.</div>';
    const cur = A.team && A.team.team ? A.team.team.tid : '';
    return '<div class="card"><div class="row"><label class="f" for="tsel" style="margin:0">조 선택</label><select id="tsel" style="width:auto"><option value="">선택하세요</option>' + o.teams.map(function (t) { return '<option value="' + esc(t.tid) + '"' + (t.tid === cur ? ' selected' : '') + '>' + esc(t.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + (t.status === '제출완료' ? ' (제출)' : '') + '</option>'; }).join('') + '</select>' +
      '<button class="btn ghost sm" data-act="vall">전체 조 가상 채점을 시트에 기록</button></div>' +
      '<p class="small muted">가상 채점은 <b>글의 형식·완성도</b>(글자 수, 필수 항목, 문제 유형과 모델·지표의 짝, 테스트 데이터 사용 여부 등)만 규칙으로 점검한 <b>제안</b>이에요. 내용이 정확한지는 판단하지 못하므로 최종 점수는 선생님이 정합니다.</p></div><div id="tdetail"></div>';
  }
  async function loadTeam(tid) {
    if (!tid) { $('#tdetail').innerHTML = ''; A.team = null; return; }
    $('#tdetail').innerHTML = '<p class="muted">불러오는 중…</p>';
    A.team = await call('adminTeam', { tid: tid });
    $('#tdetail').innerHTML = teamHtml(A.team);
  }
  function teamHtml(d) {
    const t = d.team, E = A.schema.elems;
    let h = '<div class="card"><h2>' + esc(t.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + ' ' + (t.status === '제출완료' ? '<span class="badge ok">제출 ' + esc(t.submitAt) + '</span>' : '<span class="badge">작성 중</span>') + '</h2><p class="small"><button class="btn sm ghost" data-view="' + esc(t.tid) + '">학생 작업 화면 보기(읽기 전용)</button> 작성 진행률 ' + t.progress + '% ' + (t.reportId ? '· <a target="_blank" rel="noopener" href="' + esc(PJ.reportLink(t.reportId)) + '">보고서 열기</a>' : '· 아직 보고서 없음') + '</p></div>';
    h += '<div class="card"><h2>조 점수 (기획안 · 전처리 · 모델 생성 · 모델 평가)</h2>';
    E.forEach(function (e) {
      const r = A.schema.rubric[e], v = d.virtual[e], ts = d.teamScore[e];
      h += '<div class="vs" data-e="' + e + '"><h3>' + esc(r.name) + ' <span class="badge brand">가상 채점 ' + '<span class="score">' + v.score + '</span>/' + r.max + '</span> <span class="small muted">충족 ' + v.passCount + '/' + v.total + '</span></h3>' +
        '<ul class="chk">' + v.checks.map(function (c) { return '<li class="' + (c.pass ? '' : 'no') + '">' + esc(c.label) + '<small>' + esc(c.detail) + '</small></li>'; }).join('') + '</ul>' +
        (v.flags.length ? '<div class="banner warn small">' + v.flags.map(function (f) { return '⚠ ' + esc(f); }).join('<br>') + '</div>' : '') +
        '<p class="small muted">산정 규칙: ' + esc(v.rule) + '</p>' +
        '<div><b class="small">교사 채점</b> <button class="btn sm ghost" data-use="' + e + '" data-v="' + v.score + '">가상 점수 적용</button></div>' +
        r.levels.map(function (l) { return '<label class="lv' + (ts.score === l.score ? ' sel' : '') + '"><input type="radio" name="lv_' + e + '" value="' + l.score + '"' + (ts.score === l.score ? ' checked' : '') + '><b>' + l.score + '점</b> <span class="small">' + esc(l.text) + '</span></label>'; }).join('') +
        '<label class="f small" for="rs_' + e + '">점수 사유 (선택, 시트에 기록)</label><input type="text" id="rs_' + e + '" value="' + esc(ts.reason || '') + '"></div>';
    });
    h += '<button class="btn" data-act="save-team">조 점수 저장</button></div>';

    h += '<div class="card"><h2>학생별 (개인 조정 · 결석 · 동료평가 환산)</h2><p class="small muted">조 점수에서 달라지는 학생만 "개인 조정"을 고르세요(비워 두면 조 점수 그대로). 조정하면 <b>사유가 꼭 필요</b>해요. 결석 학생은 기본 점수(' + d.base + '점)가 적용됩니다. 동료평가 환산(0~20)은 기준이 정해지면 직접 입력해요.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름 / 역할</th><th>학번</th><th>활동 기록</th><th>개인 조정</th><th>결석</th><th>조정 사유</th><th>동료평가</th><th>합계</th><th></th></tr></thead><tbody>' +
      d.members.map(function (m, i) {
        return '<tr data-m="' + i + '" data-name="' + esc(m.name) + '"><td><b>' + esc(m.name) + '</b><br><span class="small muted">' + esc(m.roles.map(function (r) { return r.replace(/\(.*\)/, ''); }).join('·')) + '</span></td>' +
          '<td><input type="text" class="sid" value="' + esc(m.sid) + '" style="width:92px" inputmode="numeric" aria-label="' + esc(m.name) + ' 학번"></td>' +
          '<td class="small">저장 ' + m.stat.saves + '회<br>+' + m.stat.chars + '자<br>' + esc(m.stat.last || '-') + '</td>' +
          '<td>' + E.map(function (e) { return '<div class="small">' + esc(A.schema.elemNames[e]) + ' <select class="adj" data-e="' + e + '" style="width:auto;padding:2px"><option value="">조 점수</option>' + A.schema.rubric[e].levels.map(function (l) { return '<option value="' + l.score + '"' + (m.adj[e] === l.score ? ' selected' : '') + '>' + l.score + '</option>'; }).join('') + '</select></div>'; }).join('') + '</td>' +
          '<td><input type="checkbox" class="abs"' + (m.absent ? ' checked' : '') + ' aria-label="' + esc(m.name) + ' 결석"></td>' +
          '<td><input type="text" class="rsn" value="' + esc(m.adjReason || '') + '" style="min-width:140px"></td>' +
          '<td class="small">원점수 ' + esc(m.peerRaw === '' || m.peerRaw == null ? '-' : m.peerRaw) + (m.peerN ? ' (' + m.peerN + '건)' : '') + '<br>환산 <input type="number" class="peer" min="0" max="20" step="0.1" value="' + (m.peerScaled == null ? '' : m.peerScaled) + '" style="width:70px"></td>' +
          '<td><b>' + (m.eff.total == null ? '-' : m.eff.total) + '</b><br><span class="badge ' + (m.absent ? 'bad' : m.eff.complete ? 'ok' : 'warn') + '">' + (m.absent ? '결석' : m.eff.complete ? '완료' : '채점 중') + '</span></td>' +
          '<td><button class="btn sm" data-save-stu="' + i + '">저장</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    h += '<div class="card"><h2>세특 · 빠른 이해 재료 (교사용)</h2>' +
      '<div class="banner warn small"><b>꼭 읽어 주세요.</b> 학교생활기록부 기재요령상 <b>학생이 직접 쓴 글을 그대로 옮기지 말고</b> 교사가 관찰한 구체적 활동·변화를 중심으로 작성하세요. 기관명·상호명·강사명·대학명 등은 쓸 수 없고, 글자 수·문장 종결·최신 개정 사항은 <b>해당 학년도 기재요령에서 직접 확인</b>해야 합니다(이 도구는 확인하지 않았어요). 아래 "주의 단어"는 간단한 규칙으로 찾은 것이라 놓치는 경우가 있어요.</div>' +
      '<div class="banner info small"><b>조 한눈에 보기</b><br>SDGs: ' + esc(d.members[0] ? d.members[0].material.facts.sdg || '-' : '-') + ' · 문제 유형: ' + esc(d.members[0] ? d.members[0].material.facts.mlType || '-' : '-') + ' · 모델: ' + esc(d.members[0] ? d.members[0].material.facts.algos || '-' : '-') + ' · 성능 수치: ' + esc(d.members[0] ? d.members[0].material.facts.metric || '-' : '-') + '</div>' +
      d.members.map(function (m) {
        return '<details><summary>' + esc(m.name) + ' <span class="muted small">(' + esc(m.roles.join(' · ')) + ')</span>' + (m.material.flags.length ? ' <span class="badge bad">주의 단어 ' + m.material.flags.length + '</span>' : '') + '</summary>' +
          '<p class="small"><b>본인이 쓴 "내가 한 일"</b><br>' + (m.contribDo ? esc(m.contribDo).replace(/\n/g, '<br>') : '<span class="muted">작성 안 함</span>') + '</p>' +
          '<p class="small"><b>본인이 쓴 "배운 점·느낀 점"</b><br>' + (m.contribLearn ? esc(m.contribLearn).replace(/\n/g, '<br>') : '<span class="muted">작성 안 함</span>') + '</p>' +
          (m.material.flags.length ? '<div class="banner bad small"><b>기재 금지 가능성이 있는 단어:</b> ' + m.material.flags.map(esc).join(', ') + '</div>' : '') +
          '<p class="small"><b>뼈대 문장(참고용)</b></p><textarea readonly style="min-height:80px">' + esc(m.material.skeleton) + '</textarea> <button class="btn sm ghost" data-copy="' + esc(m.material.skeleton) + '">복사</button></details>';
      }).join('') + '</div>';

    h += '<div class="card"><h2>학생이 쓴 전체 내용</h2><details><summary>펼쳐서 확인</summary>' + d.fields.map(function (f) {
      if (f.type === 'file') return '<p class="small"><b>' + esc(f.label) + '</b><br>' + (f.file ? '<a target="_blank" rel="noopener" href="' + esc(f.file.view) + '">' + esc(f.file.name) + '</a>' : '<span class="muted">없음</span>') + '</p>';
      const n = PJ.countChars(f.val);
      return '<p class="small"><b>' + f.page + '단계 · ' + esc(f.label) + '</b>' + (f.min ? ' <span class="badge ' + (n >= f.min ? 'ok' : 'warn') + '">' + n + '/' + f.min + '자</span>' : '') + '<br>' + (f.val ? esc(f.val).replace(/\n/g, '<br>') : '<span class="muted">비어 있음</span>') + '</p>';
    }).join('') + '</details></div>';
    return h;
  }
  const saveTeam = guard(async function () {
    const tid = A.team.team.tid, scores = {};
    A.schema.elems.forEach(function (e) { const r = $('input[name="lv_' + e + '"]:checked'); scores[e] = { score: r ? Number(r.value) : null, reason: $('#rs_' + e).value }; });
    await call('saveTeamScore', { tid: tid, scores: scores }); toast('조 점수를 저장했어요', 'ok'); await loadTeam(tid);
  });
  const saveStu = guard(async function (i) {
    const tr = $('tr[data-m="' + i + '"]'), tid = A.team.team.tid, name = tr.dataset.name, adj = {};
    $$('.adj', tr).forEach(function (s) { adj[s.dataset.e] = s.value === '' ? null : Number(s.value); });
    const sid = $('.sid', tr).value.trim(), m = A.team.members[i];
    if (sid !== String(m.sid || '')) await call('setStudent', { tid: tid, name: name, sid: sid });
    await call('saveStudentScore', { tid: tid, name: name, absent: $('.abs', tr).checked, adj: adj, reason: $('.rsn', tr).value, peerScaled: $('.peer', tr).value === '' ? null : Number($('.peer', tr).value) });
    toast(name + ' 저장 완료', 'ok'); await loadTeam(tid);
  });

  /* ───────── 채점표 ───────── */
  function tableHtml() {
    const t = A.table; if (!t) return '';
    return '<div class="card"><div class="row"><h2 class="grow" style="margin:0">채점표 (구글 시트 "채점표" 탭과 같은 내용)</h2><button class="btn ghost sm" data-act="tcsv">CSV로 저장</button></div><p class="small muted">조 점수 + 개인 조정 + 동료평가 환산을 합친 학생별 점수예요. "채점 중"은 아직 빈 항목이 있다는 뜻입니다.</p><div class="tbl-wrap"><table class="tbl"><thead><tr>' + t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + t.rows.map(function (r) { return '<tr>' + t.headers.map(function (h) { return '<td>' + esc(r[h]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
  }

  /* ───────── 동료평가 가져오기 ───────── */
  function peerHtml() {
    return '<div class="card"><h2>동료평가 파일 가져오기</h2><p class="small">엑셀(.xlsx)·CSV 파일을 올리면 <b>어느 열이 평가자 / 평가받는 학생 / 점수인지</b> 고르는 화면이 나와요. 한 줄이 "한 사람이 한 사람을 평가한 기록"인 형태를 기준으로 하며, 학생별 점수 평균을 구해 <b>원점수</b>로 저장합니다. 20점 만점으로의 <b>환산은 하지 않아요</b>(기준이 정해지면 채점 탭에서 입력).</p>' +
      '<input type="file" id="pfile" accept=".csv,.tsv,.txt,.xlsx,.xls"> <details style="display:inline-block"><summary>붙여넣기</summary><textarea id="ppaste" placeholder="표를 복사해서 붙여넣기"></textarea><button class="btn ghost sm" data-act="pparse-paste">확인</button></details><div id="pmap"></div><div id="pres"></div></div>';
  }
  function peerMap(rows) {
    if (rows.length < 2) { $('#pmap').innerHTML = '<div class="banner bad">데이터 줄이 부족해요.</div>'; return; }
    const head = rows[0].map(function (c, j) { return String(c || '').trim() || ('열' + (j + 1)); });
    A.peer = { head: head, rows: rows.slice(1) };
    const opt = function (sel, filter) { const hit = filter ? head.findIndex(function (h) { return filter.test(h); }) : -1; return '<option value="">(없음)</option>' + head.map(function (h, j) { return '<option value="' + j + '"' + (j === hit ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join(''); };
    const tgGuess = head.findIndex(function (h) { return /피평가|대상|평가받/.test(h); });
    const guessScore = head.map(function (h, j) { return /점수|평가|score|\d/.test(h) && !/평가자|피평가|대상/.test(h) ? j : -1; }).filter(function (j) { return j >= 0; });
    $('#pmap').innerHTML = '<h3>열 연결하기</h3><div class="row"><div><label class="f small">평가한 사람(평가자) 열</label><select id="pev">' + opt(0, /평가자|작성자|응답자|이름$/) + '</select></div>' +
      '<div><label class="f small">평가받은 학생 열</label><select id="ptg">' + opt(0, /피평가|대상|평가받/) + '</select></div>' +
      '<div><label class="f small">반 열(이름으로 찾을 때, 선택)</label><select id="pcl">' + opt(0, /^반$/) + '</select></div></div>' +
      '<p class="f small" style="margin-top:10px">평가받은 학생을 무엇으로 찾을까요?</p><label><input type="radio" name="pkey" value="sid"' + (tgGuess >= 0 && /이름|성명/.test(head[tgGuess]) ? '' : ' checked') + '> 학번</label> &nbsp; <label><input type="radio" name="pkey" value="name"' + (tgGuess >= 0 && /이름|성명/.test(head[tgGuess]) ? ' checked' : '') + '> 이름</label>' +
      '<p class="f small" style="margin-top:10px">점수 열 (여러 개 선택 → 줄마다 평균)</p><div class="opts" id="psc">' + head.map(function (h, j) { return '<label><input type="checkbox" value="' + j + '"' + (guessScore.indexOf(j) >= 0 ? ' checked' : '') + '>' + esc(h) + '</label>'; }).join('') + '</div>' +
      '<p><label><input type="checkbox" id="pself" checked> 자기 자신을 평가한 줄은 제외</label></p>' +
      '<h3>미리보기 (처음 5줄)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + A.peer.rows.slice(0, 5).map(function (r) { return '<tr>' + head.map(function (h, j) { return '<td>' + esc(r[j]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="small muted">전체 ' + A.peer.rows.length + '줄. 다시 가져오면 이전에 가져온 원점수는 새 내용으로 바뀌고, 입력해 둔 환산 점수는 유지돼요.</p><p><button class="btn" data-act="psend">가져오기</button></p>';
  }
  const peerSend = guard(async function () {
    const ev = $('#pev').value, tg = $('#ptg').value, cl = $('#pcl').value, sc = $$('#psc input:checked').map(function (i) { return Number(i.value); });
    if (tg === '') return toast('평가받은 학생 열을 골라 주세요.', 'err');
    if (!sc.length) return toast('점수 열을 하나 이상 골라 주세요.', 'err');
    const rows = A.peer.rows.map(function (r) { return { evaluator: ev === '' ? '' : r[ev], target: r[tg], cls: cl === '' ? '' : r[cl], scores: sc.map(function (j) { return parseFloat(String(r[j]).replace(/[^\d.\-]/g, '')); }).filter(function (x) { return !isNaN(x); }) }; });
    const res = await call('importPeer', { rows: rows, keyType: $('input[name="pkey"]:checked').value, excludeSelf: $('#pself').checked });
    $('#pres').innerHTML = '<div class="banner ok"><b>' + res.students + '명</b>의 원점수를 저장했어요 (사용한 줄 ' + res.used + ', 본인 평가 제외 ' + res.skippedSelf + ', 점수 없는 줄 ' + res.skippedEmpty + ').</div>' +
      (res.unmatched.length ? '<div class="banner warn"><b>명단에서 찾지 못한 대상</b> ' + esc(res.unmatched.join(', ')) + '</div>' : '') +
      (res.ambiguous.length ? '<div class="banner warn"><b>동명이인 등으로 구분하지 못함</b> ' + esc(res.ambiguous.join(', ')) + ' (반 열을 연결하거나 학번 기준으로 해 보세요)</div>' : '') +
      (res.noResponse.length ? '<details><summary>평가를 받지 못한 학생 ' + res.noResponse.length + '명</summary><p class="small">' + esc(res.noResponse.join(', ')) + '</p></details>' : '');
  });

  /* ───────── 설정 ───────── */
  function settingsHtml() {
    const s = A.ov.settings;
    return '<div class="card"><h2>설정</h2><p><label class="f" for="s_school">학교 이름 (세특 "주의 단어" 검사에 사용)</label><input id="s_school" type="text" value="' + esc(s.schoolName) + '" maxlength="40"></p>' +
      '<p><label class="f" for="s_base">결석 학생 기본 점수</label><input id="s_base" type="number" min="0" max="100" value="' + esc(s.baseScore) + '" style="width:120px"></p>' +
      '<p><label class="f" for="s_url">사이트 주소 (보고서 링크의 앞부분)</label><input id="s_url" type="text" value="' + esc(s.siteUrl) + '"><span class="hint">처음 관리자 로그인할 때 자동으로 채워져요. 주소를 바꾸면 이미 만든 보고서 링크도 함께 바뀝니다.</span></p>' +
      '<button class="btn" data-act="save-settings">저장</button></div>' +
      '<div class="card"><h2>구글 시트 안내</h2><p class="small">모든 데이터는 연결된 구글 시트에 있어요. 주요 탭: <b>제출</b>(조별 보고서 한 줄), <b>채점표</b>(학생별 점수), <b>가상채점</b>(규칙 기반 제안과 근거), <b>조채점·개인채점</b>(교사 입력), <b>수정이력</b>(누가 언제 얼마나 썼는지), <b>로그</b>. 이 탭들은 화면에서 자동으로 갱신되니 <b>시트에서 직접 고치지 않는 것</b>을 권해요.</p></div>';
  }

  /* ───────── 이벤트 ───────── */
  async function onClick(e) {
    const t2 = e.target.closest('[data-t2]'); if (t2) return go(t2.dataset.t2);
    const op = e.target.closest('[data-open]'); if (op) { A.team = { team: { tid: op.dataset.open } }; return go('score').then(function () { const s = $('#tsel'); if (s) s.value = op.dataset.open; }); }
    const vw = e.target.closest('[data-view]'); if (vw) { window.open('index.html?view=' + encodeURIComponent(vw.dataset.view), '_blank'); return; }   // noopener 를 쓰지 않아야 관리자 로그인 정보가 새 탭에 전달돼요
    const ro = e.target.closest('[data-reopen]'); if (ro) { if (!confirm('이 조가 다시 수정할 수 있게 할까요? (보고서 링크는 그대로 유지돼요)')) return; return guard(async function () { await call('reopenTeam', { tid: ro.dataset.reopen }); toast('수정을 허용했어요', 'ok'); go('overview'); })(); }
    const us = e.target.closest('[data-use]'); if (us) { const r = $('input[name="lv_' + us.dataset.use + '"][value="' + us.dataset.v + '"]'); if (r) { r.checked = true; $$('.lv', us.closest('.vs')).forEach(function (l) { l.classList.toggle('sel', l.contains(r)); }); } return; }
    const ss = e.target.closest('[data-save-stu]'); if (ss) return saveStu(Number(ss.dataset.saveStu));
    const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('복사했어요', 'ok'); } catch (x) { toast('복사하지 못했어요', 'err'); } return; }
    const ac = e.target.closest('[data-act]'); if (!ac) return;
    const act = ac.dataset.act;
    if (act === 'refresh') return go('overview');
    if (act === 'save-team') return saveTeam();
    if (act === 'psend') return peerSend();
    if (act === 'rparse-paste') { const v = $('#rpaste').value; if (!v.trim()) return; return previewRoster(PJ.parseTable(v)); }
    if (act === 'iparse-paste') { const v = $('#ipaste').value; if (!v.trim()) return; return guard(sendIds)(PJ.parseTable(v)); }
    if (act === 'pparse-paste') { const v = $('#ppaste').value; if (!v.trim()) return; return peerMap(PJ.parseTable(v)); }
    if (act === 'rsend') return guard(async function () {
      if (!A.roster) return;
      const r = await call('importRoster', { cls: A.roster.cls, teams: A.roster.teams });
      $('#rprev').innerHTML = '<div class="banner ok">' + esc(A.roster.cls) + '반: 새 조 ' + r.created + '개, 갱신 ' + r.updated + '개, 학생 ' + r.students + '명을 등록했어요.</div>' + (r.warnings.length ? '<div class="banner warn"><ul class="small">' + r.warnings.slice(0, 20).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') + '<p>다음: ② 학번 명부 → ③ 비밀번호 발급</p>';
      A.roster = null; await loadOverview();
    })();
    if (act === 'pw-new' || act === 'pw-all') return guard(async function () {
      if (act === 'pw-all' && !confirm('모든 조의 비밀번호를 새로 발급합니다. 기존 비밀번호는 쓸 수 없게 돼요. 계속할까요?')) return;
      const r = await call('issuePasswords', { scope: act === 'pw-all' ? 'all' : 'new' });
      A.lastPw = r.list; $('#pwout').innerHTML = r.list.length ? pwHtml() : '<div class="banner info">새로 발급할 조가 없어요.</div>'; await loadOverview();
    })();
    if (act === 'pw-csv') return PJ.downloadCsv('조별_비밀번호.csv', [['반', '조', '분야', '비밀번호', '조원']].concat(A.lastPw.map(function (x) { return [x.cls, x.no, x.field, x.pw, x.members.join(', ')]; })));
    if (act === 'pw-print') { const s = $('#slips'); const w = document.createElement('div'); w.id = 'printArea'; w.innerHTML = s.innerHTML; document.body.appendChild(w); $$('body > :not(#printArea):not(script)').forEach(function (n) { n.dataset.hid = n.style.display || ' '; n.style.display = 'none'; }); window.print(); $$('[data-hid]').forEach(function (n) { n.style.display = n.dataset.hid === ' ' ? '' : n.dataset.hid; delete n.dataset.hid; }); w.remove(); return; }
    if (act === 'vall') return guard(async function () { const r = await call('runVirtualAll'); toast(r.teams + '개 조의 가상 채점을 "가상채점" 시트에 기록했어요', 'ok'); })();
    if (act === 'tcsv') return PJ.downloadCsv('채점표.csv', [A.table.headers].concat(A.table.rows.map(function (r) { return A.table.headers.map(function (h) { return r[h]; }); })));
    if (act === 'save-settings') return guard(async function () { const r = await call('saveSettings', { schoolName: $('#s_school').value, baseScore: $('#s_base').value, siteUrl: $('#s_url').value }); A.ov.settings = r.settings; toast('저장했어요', 'ok'); })();
  }
  async function onChange(e) {
    if (e.target.id === 'ptg' && A.peer) { const h = A.peer.head[Number(e.target.value)] || ''; const r = $('input[name="pkey"][value="' + (/이름|성명/.test(h) ? 'name' : 'sid') + '"]'); if (r) r.checked = true; return; }
    if (e.target.id === 'clsf') { A.filter = e.target.value; $('#main').innerHTML = overviewHtml(); return; }
    if (e.target.id === 'tsel') return guard(function () { return loadTeam(e.target.value); })();
    if (e.target.name && e.target.name.indexOf('lv_') === 0) { $$('.lv', e.target.closest('.vs')).forEach(function (l) { l.classList.toggle('sel', l.contains(e.target)); }); return; }
    if (e.target.id === 'rfile' && e.target.files[0]) return guard(async function () { previewRoster(await PJ.readTableFile(e.target.files[0])); })();
    if (e.target.id === 'ifile' && e.target.files[0]) return guard(async function () { await sendIds(await PJ.readTableFile(e.target.files[0])); })();
    if (e.target.id === 'pfile' && e.target.files[0]) return guard(async function () { peerMap(await PJ.readTableFile(e.target.files[0])); })();
  }

  boot();
})();
