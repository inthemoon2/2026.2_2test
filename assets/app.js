/* 학생 화면: 로그인 → 팀 홈 → 단계별 페이지(자동 저장·공동 편집) → 제출 */
(function () {
  const { esc, $, $$, api, toast } = PJ;
  const app = document.getElementById('app');
  const S = { schema: null, token: PJ.store.get('pj_token') || '', st: null, page: 'home', dirty: {}, base: {}, conflicts: {}, timer: null, poller: null, saving: false, me: '' };

  /* ───────── 기본 도우미 ───────── */
  const fieldKey = function (f, name) { return f.perMember ? f.id + '@' + name : f.id; };
  const curVal = function (id) { if (id in S.dirty) return S.dirty[id]; const c = S.st.content[id]; return c ? c.val : ''; };
  const filled = function (f, name) {
    const id = fieldKey(f, name);
    return String(curVal(id)).trim() !== '';
  };
  const locked = function () { return !!(S.st && S.st.locked); };
  const pageOf = function (id) { return S.schema.pages.filter(function (p) { return p.id === id; })[0]; };

  function missingList() {
    const out = [];
    S.schema.pages.forEach(function (pg) {
      pg.sections.forEach(function (sc) {
        sc.fields.forEach(function (f) {
          if (!f.req) return;
          if (f.perMember) S.st.members.forEach(function (m) { if (!filled(f, m.name)) out.push({ page: pg.id, label: f.label + ' — ' + m.name }); });
          else if (!filled(f)) out.push({ page: pg.id, label: f.label });
        });
      });
    });
    return out;
  }
  function pagePct(pgId) {
    const pg = pageOf(pgId); let t = 0, d = 0;
    pg.sections.forEach(function (sc) {
      sc.fields.forEach(function (f) {
        if (!f.req) return;
        if (f.perMember) S.st.members.forEach(function (m) { t++; if (filled(f, m.name)) d++; });
        else { t++; if (filled(f)) d++; }
      });
    });
    return t ? Math.round(100 * d / t) : 100;
  }

  function fatal(e) {
    if (['BAD_TOKEN', 'EXPIRED'].indexOf(e.code) >= 0) { logout(e.message); return true; }
    return false;
  }

  /* ───────── 로그인 ───────── */
  function renderLogin(msg) {
    stopTimers();
    const ready = PJ.apiReady();
    app.innerHTML =
      '<div class="wrap login"><div class="card">' +
      '<h1>사회문제 해결<br>기계학습 프로젝트</h1>' +
      (ready ? '' : '<div class="banner bad"><b>아직 서버 주소가 설정되지 않았어요.</b><br>선생님께서 <code>config.js</code> 의 <code>API_URL</code> 을 설정해야 합니다. (README 4단계)</div>') +
      (msg ? '<div class="banner warn" role="alert">' + esc(msg) + '</div>' : '') +
      '<form id="lf" autocomplete="off">' +
      '<p><label class="f" for="sid">학번</label><input id="sid" type="text" inputmode="numeric" required placeholder="예) 10101"></p>' +
      '<p><label class="f" for="nm">이름</label><input id="nm" type="text" required></p>' +
      '<p><label class="f" for="pw">우리 조 비밀번호</label><input id="pw" type="password" required placeholder="선생님이 알려준 6자리"></p>' +
      '<p><button class="btn" style="width:100%;justify-content:center" ' + (ready ? '' : 'disabled') + '>들어가기</button></p>' +
      '</form>' +
      '<p class="small muted">같은 조 친구들과 하나의 프로젝트 공간을 함께 씁니다. 비밀번호는 우리 조 사람에게만 알려 주세요.</p>' +
      '<p class="small"><a href="admin.html">선생님(관리자) 페이지</a></p>' +
      '</div></div>';
    $('#lf').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const btn = $('#lf button'); btn.disabled = true; btn.textContent = '확인 중…';
      try {
        const r = await api('login', { sid: $('#sid').value, name: $('#nm').value, pw: $('#pw').value });
        S.token = r.token; PJ.store.set('pj_token', r.token);
        await boot();
      } catch (e) { renderLogin(e.message); }
    });
  }

  function logout(msg) {
    S.token = ''; PJ.store.del('pj_token'); S.st = null; S.dirty = {}; S.base = {}; S.conflicts = {};
    renderLogin(msg || '');
  }

  /* ───────── 시작 ───────── */
  async function boot() {
    if (!PJ.apiReady()) return renderLogin();
    if (!S.token) return renderLogin();
    app.innerHTML = '<div class="wrap"><p class="muted">프로젝트를 불러오는 중…</p></div>';
    try {
      if (!S.schema) S.schema = await api('schema');
      S.st = await api('loadProject', { page: S.page }, S.token);
      S.me = S.st.me.name;
    } catch (e) { if (fatal(e)) return; app.innerHTML = '<div class="wrap"><div class="banner bad">' + esc(e.message) + '</div><p><button class="btn" onclick="location.reload()">다시 시도</button></p></div>'; return; }
    renderShell();
    show(location.hash.replace('#', '') || 'home');
    startPolling();
  }

  /* ───────── 틀(상단바, 탭) ───────── */
  function renderShell() {
    app.innerHTML =
      '<header class="top"><div class="wrap">' +
      '<b id="ttl"></b><span class="grow"></span><span id="pres" class="small"></span>' +
      '<span id="saveState" class="small" aria-live="polite"></span>' +
      '<button class="btn sm" id="lo">나가기</button></div></header>' +
      '<nav class="nav" id="nav" aria-label="단계"></nav>' +
      '<main class="wrap" id="main"></main>';
    $('#lo').addEventListener('click', async function () { await saveNow(); logout(); });
    $('#nav').addEventListener('click', function (e) { const b = e.target.closest('button[data-p]'); if (b) show(b.dataset.p); });
    const main = $('#main');
    main.addEventListener('input', onInput);
    main.addEventListener('change', onInput);
    main.addEventListener('focusout', function (e) { if (e.target.closest('[data-fid]')) saveNow(); });
    main.addEventListener('click', onClick);
    window.addEventListener('beforeunload', function (e) { if (Object.keys(S.dirty).length) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.st) poll(); });
    renderTop();
  }

  function renderTop() {
    const t = S.st.team;
    $('#ttl').textContent = t.cls + '반 ' + t.no + '조 · ' + t.field + (S.st.locked ? ' (제출 완료)' : '');
    $('#pres').innerHTML = (S.st.presence || []).length ? '<span class="dot"></span>접속 중: ' + (S.st.presence || []).map(function (p) { return esc(p.name) + (p.name === S.me ? '(나)' : ''); }).join(', ') : '';
    renderNav();
  }
  function renderNav() {
    const items = [{ id: 'home', label: '팀 홈' }].concat(S.schema.pages.map(function (p) { return { id: p.id, label: p.no + '. ' + p.title, pct: pagePct(p.id) }; }));
    const nav = $('#nav'), btns = $$('button', nav);
    // 버튼을 새로 만들지 않고 제자리에서 갱신한다. (클릭하는 순간 버튼이 바뀌면 클릭이 취소되기 때문)
    if (btns.length !== items.length) {
      nav.innerHTML = items.map(function (i) { return '<button data-p="' + i.id + '">' + esc(i.label) + (i.pct != null ? '<span class="pct"></span>' : '') + '</button>'; }).join('');
    }
    $$('button', nav).forEach(function (b, k) {
      const i = items[k];
      if (S.page === i.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      const sp = $('.pct', b);
      if (sp) { const t = i.pct + '%', c = 'pct' + (i.pct === 100 ? ' full' : ''); if (sp.textContent !== t) sp.textContent = t; if (sp.className !== c) sp.className = c; }
    });
  }

  async function show(id) {
    if (id !== 'home' && !pageOf(id)) id = 'home';
    await saveNow();
    S.page = id; history.replaceState(null, '', '#' + id);
    renderNav();
    const main = $('#main');
    main.innerHTML = id === 'home' ? homeHtml() : pageHtml(pageOf(id));
    window.scrollTo(0, 0);
    if (id !== 'home') { $$('textarea', main).forEach(updateCount); }
    pollNow();
  }

  /* ───────── 팀 홈 ───────── */
  function homeHtml() {
    const st = S.st, t = st.team;
    const roleRows = st.members.map(function (m) {
      return '<tr><td>' + esc(m.name) + (m.name === S.me ? ' <span class="badge brand">나</span>' : '') + '</td><td>' + (m.roles.length ? m.roles.map(function (r) { return '<span class="chip">' + esc(r) + '</span>'; }).join(' ') : '<span class="muted">역할 미정</span>') + '</td></tr>';
    }).join('');
    const mine = (st.members.filter(function (m) { return m.name === S.me; })[0] || { roles: [] }).roles;
    const pages = S.schema.pages.map(function (p) {
      const pc = pagePct(p.id);
      const own = (p.owners || []).map(function (o) { return '<span class="chip' + (mine.indexOf(o) >= 0 ? '" style="background:var(--brand-l);border-color:var(--brand)' : '') + '">' + esc(o) + '</span>'; }).join(' ');
      return '<tr><td><button class="btn ghost sm" data-go="' + p.id + '">' + p.no + '. ' + esc(p.title) + '</button></td><td>' + own + '</td><td style="min-width:120px"><div class="bar' + (pc === 100 ? ' full' : '') + '"><i style="width:' + pc + '%"></i></div> <span class="small">' + pc + '%</span></td></tr>';
    }).join('');
    const rub = S.schema.elems.map(function (e) {
      const r = S.schema.rubric[e];
      return '<details><summary>' + esc(r.name) + ' (' + r.max + '점)</summary>' + r.levels.map(function (l) { return '<p class="small"><b>' + l.score + '점</b> ' + esc(l.text) + '</p>'; }).join('') + '</details>';
    }).join('');
    const r5 = S.schema.rubric.E5;
    return (st.locked ? lockedBanner() : '') +
      '<div class="card"><h2>' + t.cls + '반 ' + t.no + '조 · ' + esc(t.field) + '</h2>' +
      '<p>이 공간은 <b>우리 조 모두가 함께</b> 쓰는 하나의 프로젝트예요. 글을 쓰면 몇 초 안에 <b>자동으로 저장</b>되고, 조원이 고친 내용도 곧 화면에 나타납니다. 같은 칸을 동시에 고치면 충돌 안내가 뜨니 먼저 상의해요.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>역할</th></tr></thead><tbody>' + roleRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>진행 단계</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>단계</th><th>주로 맡는 역할</th><th>작성 진행률</th></tr></thead><tbody>' + pages + '</tbody></table></div>' +
      '<p class="small muted">역할은 "주로 맡는" 기준일 뿐, 모든 조원이 어느 페이지든 함께 쓰고 고칠 수 있어요. (※ 마지막 페이지의 "나의 기여" 칸은 본인만 쓸 수 있어요.)</p></div>' +
      '<div class="card"><h2>평가 기준 미리 보기</h2><p class="small muted">아래 기준에 따라 선생님이 평가합니다. 각 단계를 쓸 때 기준을 떠올려 보세요.</p>' + rub +
      '<details><summary>' + esc(r5.name) + ' (' + r5.max + '점) — 개인별</summary>' + r5.levels.map(function (l) { return '<p class="small"><b>' + l.score + '점</b> ' + esc(l.text) + '</p>'; }).join('') + '</details></div>';
  }

  function lockedBanner() {
    const t = S.st.team;
    return '<div class="banner ok"><b>제출이 완료되어 수정할 수 없어요.</b> (' + esc(t.submitAt || '') + ' · ' + esc(t.submitBy || '') + ')<br>' +
      (t.reportId ? '<a href="' + esc(PJ.reportLink(t.reportId)) + '" target="_blank" rel="noopener">보고서 보기</a> · <a href="' + esc(PJ.reportLink(t.reportId) + '&print=1') + '" target="_blank" rel="noopener">PDF로 저장하기</a>' : '') +
      '<br><span class="small">고쳐야 할 내용이 있으면 선생님께 말씀드려 "수정 허용"을 받아 주세요.</span></div>';
  }

  /* ───────── 단계 페이지 ───────── */
  function pageHtml(pg) {
    const mine = (S.st.members.filter(function (m) { return m.name === S.me; })[0] || { roles: [] }).roles;
    let h = (S.st.locked ? lockedBanner() : '') +
      '<div class="card"><h2>' + pg.no + '. ' + esc(pg.title) + '</h2><p>' + esc(pg.intro || '') + '</p>' +
      ((pg.owners || []).length ? '<p class="small muted">주로 맡는 역할: ' + pg.owners.map(function (o) { return '<span class="chip">' + esc(o) + '</span>' + (mine.indexOf(o) >= 0 ? ' <span class="badge brand">내 역할</span>' : ''); }).join(' ') + '</p>' : '') +
      '</div>';
    pg.sections.forEach(function (sc) {
      h += '<div class="card"><h3>' + esc(sc.title) + '</h3>' + sc.fields.map(fieldHtml).join('') + '</div>';
    });
    if (pg.id === S.schema.pages[S.schema.pages.length - 1].id) h += submitHtml();
    h += '<div class="row no-print" style="justify-content:space-between">' + navBtn(pg, -1) + navBtn(pg, 1) + '</div>';
    return h;
  }
  function navBtn(pg, d) {
    const i = S.schema.pages.indexOf(pg) + d;
    if (i < 0) return d < 0 ? '<button class="btn ghost" data-go="home">← 팀 홈</button>' : '<span></span>';
    if (i >= S.schema.pages.length) return '<span></span>';
    const p = S.schema.pages[i];
    return '<button class="btn ghost" data-go="' + p.id + '">' + (d < 0 ? '← ' : '') + esc(p.no + '. ' + p.title) + (d > 0 ? ' →' : '') + '</button>';
  }

  function fieldHtml(f) {
    if (f.perMember) {
      return '<div class="field-group"><label class="f">' + esc(f.label) + (f.req ? ' <span class="badge warn">필수</span>' : '') + '</label>' + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') +
        S.st.members.map(function (m) { return controlHtml(f, m.name, true); }).join('') + '</div>';
    }
    return controlHtml(f, null, false);
  }

  function controlHtml(f, name, sub) {
    const id = fieldKey(f, name), v = curVal(id), ro = locked() || (f.perMember && name !== S.me);
    const dis = ro ? ' disabled' : '';
    const label = sub ? esc(name) + (name === S.me ? ' (나)' : '') : esc(f.label) + (f.req ? ' <span class="badge warn">필수</span>' : '');
    const lab = '<label class="f" for="f_' + esc(id) + '">' + label + '</label>';
    const hint = !sub && f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '';
    let ctl = '';
    switch (f.type) {
      case 'textarea': ctl = '<textarea id="f_' + esc(id) + '" data-fid="' + esc(id) + '" placeholder="' + esc(f.ph || '') + '"' + dis + '>' + esc(v) + '</textarea><div class="cnt" data-cnt="' + esc(id) + '"></div>'; break;
      case 'select': ctl = '<select id="f_' + esc(id) + '" data-fid="' + esc(id) + '"' + dis + '><option value="">선택하세요</option>' + f.opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'; break;
      case 'multiselect': { const sel = v.split('|'); ctl = '<div class="opts" data-fid="' + esc(id) + '" data-multi="1">' + f.opts.map(function (o) { return '<label><input type="checkbox" value="' + esc(o) + '"' + (sel.indexOf(o) >= 0 ? ' checked' : '') + dis + '>' + esc(o) + '</label>'; }).join('') + '</div>'; break; }
      case 'checkbox': ctl = '<label style="font-weight:400"><input type="checkbox" id="f_' + esc(id) + '" data-fid="' + esc(id) + '" data-check="1"' + (v === 'Y' ? ' checked' : '') + dis + '> ' + esc(f.ph || '확인했어요') + '</label>'; return '<div class="field" data-field="' + esc(id) + '">' + '<div class="f" style="font-weight:600">' + label + '</div>' + hint + ctl + '<div class="stat" data-stat="' + esc(id) + '"></div></div>';
      case 'file': ctl = fileHtml(f, id); break;
      default: ctl = '<input id="f_' + esc(id) + '" data-fid="' + esc(id) + '" type="' + (f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text') + '"' + (f.type === 'number' ? ' step="any"' : '') + ' value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '"' + dis + '>';
    }
    return '<div class="field" data-field="' + esc(id) + '">' + (f.type === 'file' ? '<div class="f" style="font-weight:600">' + label + '</div>' : lab) + hint + ctl + '<div class="stat" data-stat="' + esc(id) + '"></div></div>';
  }

  /* ---- 파일 칸 ---- */
  function colabSnippet(file) {
    const enc = file.meta && file.meta.encoding === 'cp949' ? ", encoding='cp949'" : '';
    return "import pandas as pd\n\nurl = 'https://drive.google.com/uc?export=download&id=" + file.id + "'\ndf = pd.read_csv(url" + enc + ")\ndf.head()";
  }
  function fileHtml(f, id) {
    const file = S.st.files[id], accept = f.kind === 'csv' ? '.csv' : f.kind === 'img' ? 'image/*' : '.pdf,.ppt,.pptx';
    const limit = f.kind === 'ppt' ? '10MB' : '5MB';
    let h = '<div class="drop" data-drop="' + esc(id) + '" data-seen="' + esc(file ? file.id : '') + '">';
    if (file) {
      h += '<p><b>' + esc(file.name) + '</b> <span class="muted small">(' + PJ.fmtBytes(file.size) + ' · ' + esc(file.by) + ' · ' + esc(file.at) + ')</span></p>';
      if (f.kind === 'img') h += '<p><a href="' + esc(file.view) + '" target="_blank" rel="noopener"><img src="' + esc(file.thumb) + '" alt="올린 이미지" style="max-width:100%;max-height:320px;border:1px solid var(--line);border-radius:6px" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'미리보기를 불러오지 못했어요. 아래 링크로 열어 보세요.\'}))"></a></p>';
      if (f.kind === 'csv' && file.meta) {
        const m = file.meta, miss = m.missing || {};
        h += '<p class="small">행 <b>' + (m.rows || 0) + '</b> × 열 <b>' + (m.cols || 0) + '</b> · 글자 인코딩 ' + esc(m.encoding || 'utf-8') + '</p>';
        if ((m.columns || []).length) h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + m.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody><tr>' + m.columns.map(function (c) { return '<td class="small">' + (miss[c] ? '<span class="badge warn">결측 ' + miss[c] + '</span>' : '<span class="badge ok">결측 0</span>') + '</td>'; }).join('') + '</tr>' + (m.sample || []).map(function (r) { return '<tr>' + m.columns.map(function (c, j) { return '<td>' + esc(r[j] == null ? '' : r[j]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        h += '<details><summary>코랩에서 이 파일 불러오는 코드</summary><pre class="code">' + esc(colabSnippet(file)) + '</pre><button class="btn ghost sm" data-copy="' + esc(colabSnippet(file)) + '">코드 복사</button>' + (file.meta.shared === false ? '<p class="small" style="color:var(--bad)">※ 학교 계정 정책으로 "링크 공유"가 막혀 있어 코랩에서 바로 열리지 않을 수 있어요. 선생님께 문의하세요.</p>' : '') + '</details>';
      }
      h += '<p><a href="' + esc(file.view) + '" target="_blank" rel="noopener">드라이브에서 열기</a></p>';
    } else h += '<p class="muted">아직 올린 파일이 없어요.</p>';
    if (!locked()) h += '<p class="no-print"><label class="btn ghost sm" style="cursor:pointer">' + (file ? '다른 파일로 바꾸기' : '파일 선택') + '<input type="file" accept="' + accept + '" data-upload="' + esc(id) + '" style="display:none"></label> <span class="small muted">최대 ' + limit + (f.kind === 'csv' ? ' · 더 크면 아래 "데이터 원본 링크" 칸에 주소를 적어요' : '') + '</span></p>';
    return h + '</div>';
  }

  /* ───────── 입력 처리·자동 저장 ───────── */
  function readEl(el) {
    if (el.dataset.multi) return $$('input:checked', el).map(function (i) { return i.value; }).join('|');
    if (el.dataset.check) return el.checked ? 'Y' : '';
    return el.value;
  }
  function updateCount(el) {
    const id = el.dataset.fid, box = $('[data-cnt="' + id + '"]'); if (!box) return;
    const base = id.split('@')[0]; let min = 0;
    S.schema.pages.forEach(function (p) { p.sections.forEach(function (s) { s.fields.forEach(function (f) { if (f.id === base) min = f.min || 0; }); }); });
    const n = PJ.countChars(el.value);
    box.textContent = n + '자' + (min ? ' (권장 ' + min + '자 이상)' : '');
    box.className = 'cnt' + (min ? (n >= min ? ' ok' : ' low') : '');
  }
  function onInput(e) {
    const el = e.target.closest('[data-fid]'); if (!el || locked()) return;
    if (e.target.type === 'file') return;
    const id = el.dataset.fid;
    if (e.type === 'input' && (el.dataset.multi || el.dataset.check || el.tagName === 'SELECT')) return;   // 선택형은 change 에서 처리
    const val = readEl(el), saved = S.st.content[id] ? S.st.content[id].val : '';
    if (val === saved && !(id in S.conflicts)) { delete S.dirty[id]; delete S.base[id]; }
    else { if (!(id in S.dirty)) S.base[id] = S.st.content[id] ? S.st.content[id].v : 0; S.dirty[id] = val; }
    const wrap = el.closest('.field'); if (wrap) wrap.className = 'field' + (id in S.dirty ? ' dirty' : '') + (id in S.conflicts ? ' conflict' : '');
    if (el.tagName === 'TEXTAREA') updateCount(el);
    setSaveState(Object.keys(S.dirty).length ? '입력 중…' : '');
    clearTimeout(S.timer); S.timer = setTimeout(saveNow, 1500);
    renderNav();
  }
  function setSaveState(t) { const e = $('#saveState'); if (e) e.textContent = t; }

  async function saveNow() {
    clearTimeout(S.timer);
    if (S.saving || !S.st || locked()) return;
    const ids = Object.keys(S.dirty).filter(function (id) { return !(id in S.conflicts); });
    if (!ids.length) return;
    S.saving = true; setSaveState('저장 중…');
    const sent = {}, fields = {};
    ids.forEach(function (id) { sent[id] = S.dirty[id]; fields[id] = { val: S.dirty[id], baseV: S.base[id] || 0 }; setFieldClass(id, 'saving'); });
    try {
      const r = await api('saveFields', { page: S.page, fields: fields }, S.token);
      Object.keys(r.saved).forEach(function (id) {
        S.st.content[id] = { val: sent[id], v: r.saved[id].v, by: r.saved[id].by, at: r.saved[id].at };
        if (S.dirty[id] === sent[id]) { delete S.dirty[id]; delete S.base[id]; setFieldClass(id, 'saved'); }
        else S.base[id] = r.saved[id].v;
      });
      r.conflicts.forEach(function (c) { S.conflicts[c.id] = c.theirs; showConflict(c.id); });
      S.st.rev = r.rev;
      setSaveState(r.conflicts.length ? '⚠ 충돌이 있어요' : '✓ 저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      renderNav();
    } catch (e) {
      ids.forEach(function (id) { setFieldClass(id, 'dirty'); });
      if (!fatal(e)) {
        if (e.code === 'LOCKED') { toast(e.message, 'err'); S.st = await api('loadProject', { page: S.page }, S.token).catch(function () { return S.st; }); renderTop(); show(S.page); }
        else { setSaveState('⚠ 저장 실패(다시 시도 중)'); toast(e.message, 'err'); S.timer = setTimeout(saveNow, 6000); }
      }
    } finally { S.saving = false; }
    if (Object.keys(S.dirty).some(function (id) { return !(id in S.conflicts); })) S.timer = setTimeout(saveNow, 800);
  }
  function setFieldClass(id, cls) { const w = $('[data-field="' + id + '"]'); if (w) w.className = 'field ' + cls; }

  function showConflict(id) {
    const c = S.conflicts[id], w = $('[data-field="' + id + '"]'); if (!w) return;
    w.className = 'field conflict';
    const st = $('[data-stat="' + id + '"]');
    st.innerHTML = '<div class="conflict-box"><b>' + esc(c.by || '조원') + '</b>님이 ' + esc(c.at || '') + '에 이 칸을 먼저 고쳤어요.<pre>' + esc(c.val === '' ? '(비어 있음)' : c.val) + '</pre>' +
      '<div class="row"><button class="btn sm ghost" data-res="theirs" data-id="' + esc(id) + '">조원 내용으로 바꾸기</button> <button class="btn sm ghost" data-res="both" data-id="' + esc(id) + '">둘 다 남기기(내 글을 뒤에 붙이기)</button> <button class="btn sm danger ghost" data-res="mine" data-id="' + esc(id) + '">내 내용으로 덮어쓰기</button></div></div>';
  }
  function resolveConflict(id, how) {
    const c = S.conflicts[id], el = $('[data-fid="' + id + '"]'), mine = S.dirty[id] || '';
    delete S.conflicts[id];
    if (how === 'theirs') { S.st.content[id] = { val: c.val, v: c.v, by: c.by, at: c.at }; delete S.dirty[id]; delete S.base[id]; setEl(el, c.val); }
    else if (how === 'both') { S.st.content[id] = { val: c.val, v: c.v, by: c.by, at: c.at }; const merged = c.val ? c.val + '\n\n' + mine : mine; S.dirty[id] = merged; S.base[id] = c.v; setEl(el, merged); }
    else { S.base[id] = c.v; }
    const st = $('[data-stat="' + id + '"]'); if (st) st.innerHTML = '';
    setFieldClass(id, id in S.dirty ? 'dirty' : '');
    if (el && el.tagName === 'TEXTAREA') updateCount(el);
    saveNow(); renderNav();
  }
  function setEl(el, val) {
    if (!el) return;
    if (el.dataset.multi) { const s = val.split('|'); $$('input', el).forEach(function (i) { i.checked = s.indexOf(i.value) >= 0; }); }
    else if (el.dataset.check) el.checked = val === 'Y';
    else el.value = val;
  }

  /* ───────── 클릭·업로드 ───────── */
  async function onClick(e) {
    const go = e.target.closest('[data-go]'); if (go) return show(go.dataset.go);
    const res = e.target.closest('[data-res]'); if (res) return resolveConflict(res.dataset.id, res.dataset.res);
    const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('복사했어요', 'ok'); } catch (x) { toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.', 'err'); } return; }
    if (e.target.closest('#submitBtn')) return doSubmit();
  }
  document.addEventListener('change', async function (e) {
    const inp = e.target.closest('input[data-upload]'); if (!inp || !inp.files.length) return;
    const id = inp.dataset.upload, file = inp.files[0], f = fieldDef(id);
    const limit = (f.kind === 'ppt' ? 10 : 5) * 1048576;
    if (file.size > limit) { toast('파일이 너무 커요. 최대 ' + (f.kind === 'ppt' ? 10 : 5) + 'MB 입니다.' + (f.kind === 'csv' ? ' 더 큰 데이터는 "데이터 원본 링크" 칸에 주소를 적어 주세요.' : ''), 'err'); inp.value = ''; return; }
    const stat = $('[data-stat="' + id + '"]'); if (stat) stat.textContent = '올리는 중… 잠시만 기다려 주세요.';
    try {
      const buf = await PJ.readFileBuffer(file); let meta;
      if (f.kind === 'csv') { const d = PJ.decodeBuffer(buf); meta = PJ.summarizeCsv(d.text, d.encoding); }
      const r = await api('uploadFile', { field: id, name: file.name, b64: PJ.bufToB64(buf), meta: meta }, S.token);
      S.st.files[id] = r.file; S.st.content[id] = { val: r.file.id, v: r.version, by: S.me, at: r.file.at }; S.st.rev = r.rev;
      const w = $('[data-field="' + id + '"]'); if (w) w.outerHTML = controlHtml(f, null, false);
      toast('파일을 올렸어요', 'ok'); renderNav();
      if (r.shared === false) toast('학교 계정 정책으로 링크 공유가 막혀 있어요. 선생님께 알려 주세요.', 'err');
    } catch (x) { if (!fatal(x)) { if (stat) stat.textContent = ''; toast(x.message, 'err'); } }
    inp.value = '';
  });
  function fieldDef(id) { let r = null; S.schema.pages.forEach(function (p) { p.sections.forEach(function (s) { s.fields.forEach(function (f) { if (f.id === id.split('@')[0]) r = f; }); }); }); return r; }

  /* ───────── 제출 ───────── */
  function submitHtml() {
    if (S.st.locked) return '';
    const miss = missingList();
    return '<div class="card" id="submitCard"><h2>교사에게 제출하기</h2>' +
      (miss.length ? '<div class="banner warn"><b>아직 비어 있는 필수 항목이 ' + miss.length + '개 있어요.</b><ul class="small">' + miss.slice(0, 12).map(function (m) { return '<li><a href="#' + m.page + '" data-go="' + m.page + '" onclick="return false">' + esc(pageOf(m.page).no + '단계') + '</a> ' + esc(m.label) + '</li>'; }).join('') + (miss.length > 12 ? '<li>…외 ' + (miss.length - 12) + '개</li>' : '') + '</ul></div>' : '<div class="banner ok">필수 항목을 모두 작성했어요. 제출 전에 한 번 더 읽어 보세요.</div>') +
      '<p>제출하면 <b>더 이상 수정할 수 없고</b>, 우리 조의 보고서 페이지가 만들어져요. 조원 모두 확인했나요?</p>' +
      '<p><button class="btn" id="submitBtn">교사에게 제출하기</button></p></div>';
  }
  async function doSubmit() {
    const miss = missingList();
    const msg = (miss.length ? '필수 항목 ' + miss.length + '개가 비어 있어요.\n그래도 제출할까요?\n\n' : '') + '제출하면 수정할 수 없어요. 정말 제출할까요?';
    if (!window.confirm(msg)) return;
    const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = '제출 중…';
    try {
      await saveNow();
      if (Object.keys(S.conflicts).length) throw Object.assign(new Error('충돌이 해결되지 않은 칸이 있어요. 먼저 해결해 주세요.'), { code: 'CONFLICT' });
      const r = await api('submitProject', {}, S.token);
      S.st = await api('loadProject', { page: S.page }, S.token);
      renderTop(); await show(S.page);
      toast('제출했어요! 보고서가 만들어졌어요.', 'ok');
      return r;
    } catch (e) { if (!fatal(e)) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '교사에게 제출하기'; } }
  }

  /* ───────── 실시간 반영(8초마다 확인) ───────── */
  function startPolling() { stopTimers(); S.poller = setInterval(function () { if (!document.hidden) poll(); }, 8000); }
  function stopTimers() { clearInterval(S.poller); clearTimeout(S.timer); }
  function pollNow() { poll(); }
  let polling = false;
  async function poll() {
    if (polling || !S.st || !S.token) return; polling = true;
    try {
      const r = await api('pollProject', { rev: S.st.rev, page: S.page }, S.token);
      S.st.presence = r.presence;
      if (r.changed) {
        const wasLocked = S.st.locked;
        S.st.rev = r.rev; S.st.content = r.content; S.st.files = r.files; S.st.locked = r.locked; S.st.team = r.team; S.st.members = r.members; S.st.progress = r.progress;
        if (wasLocked !== r.locked) { renderTop(); await show(S.page); }
        else applyRemote();
      }
      renderTop();
    } catch (e) { fatal(e); } finally { polling = false; }
  }
  function applyRemote() {
    if (S.page === 'home') { $('#main').innerHTML = homeHtml(); return; }
    $$('[data-fid]', $('#main')).forEach(function (el) {
      const id = el.dataset.fid;
      if (id in S.dirty || el.type === 'file') return;
      const c = S.st.content[id], v = c ? c.val : '';
      if (readEl(el) !== v) {
        setEl(el, v);
        if (el.tagName === 'TEXTAREA') updateCount(el);
        const stt = $('[data-stat="' + id + '"]'); if (stt && c) stt.textContent = '✎ ' + c.by + ' 님이 방금 고쳤어요';
      }
    });
    $$('[data-drop]', $('#main')).forEach(function (d) {
      const id = d.dataset.drop, f = fieldDef(id), cur = S.st.files[id], nowId = cur ? cur.id : '';
      if (d.dataset.seen !== nowId) { const w = d.closest('.field'); if (w) w.outerHTML = controlHtml(f, null, false); }
    });
  }

  /* ───────── 시작 ───────── */
  boot();
})();
