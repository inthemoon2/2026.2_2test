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
  C.reportLink = function (id) { return new URL('report.html?id=' + encodeURIComponent(id), location.href).href; };
  C.store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장이 막혀도 동작은 계속 */ } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };
})();
