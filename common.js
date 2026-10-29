/* 공통 도구: 서버 호출, CSV 읽기, 화면 도우미 */
(function () {
  const C = (window.PJ = window.PJ || {});

  C.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  C.$ = function (sel, root) { return (root || document).querySelector(sel); };
  C.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---- 서버 호출 ---- */
  C.apiReady = function () {
    const u = (window.APP_CONFIG || {}).API_URL || '';
    return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/.+\/exec/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u);
  };
  C.api = async function (action, payload, token) {
    if (!C.apiReady()) throw Object.assign(new Error('config.js 의 API_URL 이 아직 설정되지 않았어요. README 4단계를 확인하세요.'), { code: 'NO_API' });
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 사전 요청(preflight) 방지
        body: JSON.stringify({ action: action, payload: payload || {}, token: token || '' }),
      });
    } catch (e) {
      throw Object.assign(new Error('서버에 연결하지 못했어요. 인터넷 연결과 API_URL 을 확인하세요.'), { code: 'NETWORK' });
    }
    let j;
    try { j = JSON.parse(await res.text()); } catch (e) {
      throw Object.assign(new Error('서버 응답을 읽을 수 없어요. Apps Script 배포 설정(액세스: 모든 사용자)과 URL 끝이 /exec 인지 확인하세요.'), { code: 'BAD_RESPONSE' });
    }
    if (!j.ok) throw Object.assign(new Error(j.message || '오류가 발생했어요.'), { code: j.code || 'ERROR' });
    return j.data;
  };

  /* ---- 토스트 ---- */
  C.toast = function (msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () { d.classList.add('out'); setTimeout(function () { d.remove(); }, 400); }, kind === 'err' ? 6000 : 2800);
  };

  /* ---- CSV ---- */
  // 따옴표, 줄바꿈이 들어간 칸까지 처리하는 CSV/TSV 해석기. delim 이 없으면 탭·쉼표 중 많은 쪽을 자동 선택
  C.parseTable = function (text, delim) {
    text = String(text).replace(/^﻿/, '');
    if (!delim) {
      const head = text.split(/\r?\n/).slice(0, 10).join('\n');
      const tabs = (head.match(/\t/g) || []).length, commas = (head.match(/,/g) || []).length;
      delim = tabs > 0 && tabs >= commas / 2 ? '\t' : ',';
    }
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  };

  // 파일 바이트를 글자로: UTF-8 로 먼저 시도하고, 깨지면 한국어 엑셀 기본(CP949=EUC-KR)로 다시 읽는다
  C.decodeBuffer = function (buf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }; }
    catch (e) { return { text: new TextDecoder('euc-kr').decode(buf), encoding: 'cp949' }; }
  };

  C.readFileBuffer = function (file) {
    return new Promise(function (ok, no) { const r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(new Error('파일을 읽지 못했어요.')); }; r.readAsArrayBuffer(file); });
  };

  C.bufToB64 = function (buf) {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // 업로드할 CSV 를 훑어서 행·열 수, 결측치, 미리보기를 만든다 (서버가 다시 한 번 정리한다)
  C.summarizeCsv = function (text, encoding) {
    const t = C.parseTable(text, ',');
    if (!t.length) return { rows: 0, cols: 0, columns: [], missing: {}, sample: [], encoding: encoding };
    const cols = t[0].map(function (c) { return String(c).trim(); }), body = t.slice(1), missing = {};
    cols.forEach(function (c, j) { missing[c || ('열' + (j + 1))] = body.filter(function (r) { const v = r[j]; return v === undefined || String(v).trim() === '' || /^(nan|na|n\/a|null|none)$/i.test(String(v).trim()); }).length; });
    return { rows: body.length, cols: cols.length, columns: cols, missing: missing, sample: body.slice(0, 5), encoding: encoding };
  };

  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙여 CSV 로 내려받기
  C.downloadCsv = function (filename, rows) {
    const q = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const blob = new Blob(['﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  // 엑셀(.xlsx/.xls) 지원: 필요할 때만 SheetJS 를 불러온다
  C.loadXlsx = function () {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, no) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = function () { ok(window.XLSX); };
      s.onerror = function () { no(new Error('엑셀 변환 도구를 불러오지 못했어요. 엑셀에서 CSV로 저장한 파일을 올려 주세요.')); };
      document.head.appendChild(s);
    });
  };

  // 표 파일(csv/tsv/txt/xlsx/xls)을 2차원 배열로
  C.readTableFile = async function (file) {
    const buf = await C.readFileBuffer(file), name = file.name.toLowerCase();
    if (/\.xlsx?$/.test(name)) {
      const X = await C.loadXlsx(), wb = X.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    }
    return C.parseTable(C.decodeBuffer(buf).text);
  };

  C.fmtBytes = function (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; };
  C.countChars = function (s) { return String(s || '').replace(/\s+/g, '').length; };
  C.debounce = function (fn, ms) { let t; return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; };

  /* 교사 피드백 화면 (학생 앱·보고서·관리자 미리보기가 같이 쓴다) */
  C.feedbackHtml = function (fb, o) {
    o = o || {};
    const E = C.esc;
    const stars = function (n) { return n ? '<span class="stars" aria-label="5단계 중 ' + n + '단계">' + '★'.repeat(n) + '<i>' + '☆'.repeat(5 - n) + '</i></span>' : '<span class="muted">기록 없음</span>'; };
    const pre = function (t) { return '<p class="pre">' + E(t) + '</p>'; };
    const badge = function (st) { return st === 'ok' ? '<span class="badge ok">✓ 충족</span>' : st === 'part' ? '<span class="badge warn">△ 보완 필요</span>' : st === 'no' ? '<span class="badge bad">✗ 미흡</span>' : '<span class="badge">점검 전</span>'; };
    let h = '<section class="fb"><h2>교사 피드백</h2>';
    if (o.admin) h += '<div class="banner info no-print small">관리자 미리보기입니다. ' + (fb.published ? '학생에게 <b>공개 중</b>이에요.' : '아직 <b>비공개</b>예요. 공개하면 학생 화면과 보고서 맨 끝에 보여요.') + '</div>';
    h += '<div class="fb-card fb-main"><h3>① 총평</h3>' + pre(fb.overall) + '</div>';

    // ② 참여도
    const pt = fb.participation || { sessions: [] };
    h += '<div class="fb-card"><h3>② 참여도</h3>' +
      (pt.avg === null ? '<p class="muted">아직 기록된 참여도가 없어요.</p>' :
        '<p><b>전체 평균 ' + pt.avg + ' / 5 · ' + E(pt.label) + '</b></p>' + pt.sessions.map(function (s) {
          return '<div class="fb-bar"><span class="fb-lab">' + E(s.title) + '</span><div class="bar"><i style="width:' + (s.avg ? Math.round(s.avg / 5 * 100) : 0) + '%"></i></div><span class="fb-val">' + (s.avg === null ? '–' : s.avg) + '</span></div>';
        }).join('') + '<p class="small muted">조원의 5단계 참여도(1 참여 미흡 ~ 5 매우 적극적)를 차시마다 평균한 값이에요.</p>');
    if (fb.individuals && fb.individuals.length) {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th>' + pt.sessions.map(function (s) { return '<th>' + E(s.title) + '</th>'; }).join('') + '<th>평균</th></tr></thead><tbody>' +
        fb.individuals.map(function (m) { return '<tr><td><b>' + E(m.name) + '</b><div class="small muted">' + E((m.roles || []).join(' · ')) + '</div></td>' + pt.sessions.map(function (s) { return '<td>' + stars(m.levels[s.no]) + '</td>'; }).join('') + '<td>' + (m.avg === null ? '–' : m.avg) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      const praise = fb.individuals.filter(function (m) { return m.notes.length || m.asks.length; });
      if (praise.length) {
        h += '<h4>수업 중 눈에 띈 모습</h4>' + praise.map(function (m) {
          return '<div class="fb-person"><b>' + E(m.name) + '</b>' +
            (m.notes.length ? '<div class="small"><span class="badge ok">잘한 점</span> ' + m.notes.map(function (n) { return E(n.no + '차시: ' + n.text); }).join(' / ') + '</div>' : '') +
            (m.asks.length ? '<div class="small"><span class="badge brand">질문·고민</span> ' + m.asks.map(function (n) { return E(n.no + '차시: ' + n.text); }).join(' / ') + '</div>' : '') + '</div>';
        }).join('');
      }
    }
    h += '</div>';

    // ③ 중간 점검
    h += '<div class="fb-card"><h3>③ 중간 점검 기록</h3>' + ((fb.checks || []).length ? fb.checks.map(function (c) {
      return '<h4>' + E(c.title) + '</h4><ul class="fb-list">' + c.items.map(function (i) { return '<li>' + badge(i.status) + ' ' + E(i.label) + '</li>'; }).join('') + '</ul>' + (c.memo ? '<p class="small"><b>교사 메모</b> ' + E(c.memo) + '</p>' : '');
    }).join('') : '<p class="muted">기록된 점검이 없어요.</p>') + '</div>';

    // ④ 프로젝트 내용
    h += '<div class="fb-card"><h3>④ 프로젝트 내용 평가</h3>' + pre(fb.project.comment) + '<div class="fb-grid">' + fb.project.elems.map(function (e) {
      const pct = e.total ? Math.round(e.pass / e.total * 100) : 0;
      return '<div class="fb-el"><h4>' + E(e.name) + '</h4><div class="fb-bar"><div class="bar' + (pct === 100 ? ' full' : '') + '"><i style="width:' + pct + '%"></i></div><span class="fb-val">' + e.pass + '/' + e.total + '</span></div>' +
        (e.good.length ? '<div class="small"><b class="ok-t">잘한 점</b><ul class="fb-list">' + e.good.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        (e.todo.length ? '<div class="small"><b class="warn-t">보완하면 좋은 점</b><ul class="fb-list">' + e.todo.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul></div>' : '<div class="small ok-t"><b>모든 점검 기준을 충족했어요.</b></div>') +
        (o.admin && e.flags && e.flags.length ? '<div class="small warn-t">⚠ ' + e.flags.map(E).join('<br>⚠ ') + '</div>' : '') + '</div>';
    }).join('') + '</div><p class="small muted">점검 기준은 보고서에 필요한 내용이 갖춰졌는지 살피는 항목이에요. 내용의 정확성과 깊이는 선생님이 따로 평가합니다.</p></div>';

    if (fb.note) h += '<div class="fb-card fb-note"><h3>⑤ 선생님 한마디</h3>' + pre(fb.note) + '</div>';
    return h + '</section>';
  };

  /* 보고서 본문(제목·조 정보·단계별 내용). 보고서 페이지와 학생 앱의 '보고서·피드백' 탭이 같이 쓴다 */
  C.reportBodyHtml = function (r) {
    const esc = C.esc, PJ = C;
  function item(it) {
    let v;
    if (it.type === 'member') {
      v = it.values.map(function (m) { return '<p><b>' + esc(m.name) + '</b><br>' + (m.val ? '<span class="val">' + esc(m.val) + '</span>' : '<span class="empty">작성하지 않음</span>') + '</p>'; }).join('');
      return '<div class="item"><div class="lab">' + esc(it.label) + '</div>' + v + '</div>';
    }
    if (it.type === 'file') {
      const f = it.file;
      if (!f) v = '<span class="empty">올리지 않음</span>';
      else if (it.kind === 'img') v = '<a href="' + esc(f.view) + '" target="_blank" rel="noopener"><img src="' + esc(f.thumb) + '" alt="' + esc(f.name) + '"></a><div class="small muted">' + esc(f.name) + '</div>';
      else {
        v = '<a href="' + esc(f.view) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a> <span class="muted small">(' + PJ.fmtBytes(f.size) + ')</span>';
        const m = f.meta;
        if (it.kind === 'csv' && m && m.cols) {
          v += '<div class="small">행 ' + m.rows + ' × 열 ' + m.cols + ' · 열 이름: ' + esc((m.columns || []).join(', ')) + '</div>';
          const miss = Object.keys(m.missing || {}).filter(function (k) { return m.missing[k] > 0; });
          v += '<div class="small">결측치: ' + (miss.length ? esc(miss.map(function (k) { return k + ' ' + m.missing[k] + '개'; }).join(', ')) : '없음') + '</div>';
        }
      }
      return '<div class="item"><div class="lab">' + esc(it.label) + '</div><div>' + v + '</div></div>';
    }
    v = it.val ? '<div class="val">' + (/^https?:\/\/\S+$/.test(it.val) ? '<a href="' + esc(it.val) + '" target="_blank" rel="noopener">' + esc(it.val) + '</a>' : esc(it.val)) + '</div>' : '<div class="empty">작성하지 않음</div>';
    return '<div class="item"><div class="lab">' + esc(it.label) + '</div>' + v + '</div>';
  }


    return '<h1>사회문제 해결 기계학습 프로젝트 보고서</h1>' +
      '<table class="tbl"><tbody><tr><th>반 / 조</th><td>' + esc(r.cls) + '반 ' + esc(r.no) + '조</td><th>진로 분야</th><td>' + esc(r.field) + '</td></tr>' +
      '<tr><th>조원(역할)</th><td colspan="3">' + r.members.map(function (m) { return esc(m.name) + (m.roles.length ? ' (' + esc(m.roles.join(' · ')) + ')' : ''); }).join('<br>') + '</td></tr>' +
      '<tr><th>제출 일시</th><td colspan="3">' + esc(r.submitAt || '—') + '</td></tr></tbody></table>' +
      r.pages.map(function (pg) {
        return '<section class="sec pg"><h2>' + pg.no + '. ' + esc(pg.title) + '</h2>' + pg.sections.filter(function (sc) { return !/^6-1/.test(sc.title); }).map(function (sc) { return '<h3>' + esc(sc.title) + '</h3>' + sc.items.map(item).join(''); }).join('') + '</section>';
      }).join('');
  };

  C.reportLink = function (id) { return new URL('report.html?id=' + encodeURIComponent(id), location.href).href; };
  C.store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장이 막혀도 동작은 계속 */ } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };
})();
