/* 보고서 페이지: 링크(?id=...)만 있으면 누구나 볼 수 있는 읽기 전용 페이지. PDF 는 인쇄 → "PDF로 저장" */
(function () {
  const { esc, api } = PJ, box = document.getElementById('rp');
  const qs = new URLSearchParams(location.search), id = qs.get('id') || '';

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

  async function main() {
    if (!id) { box.innerHTML = '<div class="banner bad">보고서 주소가 올바르지 않아요. (주소 끝에 ?id=… 가 필요합니다)</div>'; return; }
    let r;
    try { r = await api('getReport', { id: id }); } catch (e) { box.innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; return; }
    document.title = r.cls + '반 ' + r.no + '조 프로젝트 보고서';
    box.innerHTML =
      '<div class="row no-print" style="justify-content:flex-end;margin-bottom:8px"><button class="btn ghost" id="cp">링크 복사</button><button class="btn" id="pdf">PDF로 저장하기 (인쇄)</button></div>' +
      (r.status !== '제출완료' ? '<div class="banner warn no-print"><b>작성 중인 보고서</b>예요. 아직 최종 제출 전이거나, 수정을 위해 다시 열려 있어요. 고쳐 쓰면 이 링크의 내용도 함께 바뀌어요.</div>' : '') +
      '<h1>사회문제 해결 기계학습 프로젝트 보고서</h1>' +
      '<table class="tbl"><tbody><tr><th>반 / 조</th><td>' + esc(r.cls) + '반 ' + esc(r.no) + '조</td><th>진로 분야</th><td>' + esc(r.field) + '</td></tr>' +
      '<tr><th>조원(역할)</th><td colspan="3">' + r.members.map(function (m) { return esc(m.name) + (m.roles.length ? ' (' + esc(m.roles.join(' · ')) + ')' : ''); }).join('<br>') + '</td></tr>' +
      '<tr><th>제출 일시</th><td colspan="3">' + esc(r.submitAt || '—') + '</td></tr></tbody></table>' +
      r.pages.map(function (pg) {
        return '<section class="sec pg"><h2>' + pg.no + '. ' + esc(pg.title) + '</h2>' + pg.sections.map(function (sc) { return '<h3>' + esc(sc.title) + '</h3>' + sc.items.map(item).join(''); }).join('') + '</section>';
      }).join('') + (r.feedback ? PJ.feedbackHtml(r.feedback) : '');
    document.getElementById('cp').addEventListener('click', function () { const u = location.origin + location.pathname + '?id=' + encodeURIComponent(id); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { PJ.toast('링크를 복사했어요', 'ok'); }, function () { window.prompt('이 링크를 복사하세요', u); }); });
    document.getElementById('pdf').addEventListener('click', function () { window.print(); });
    if (qs.get('print') === '1') setTimeout(function () { window.print(); }, 700);   // 이미지가 뜰 시간을 잠깐 기다림
  }
  main();
})();
