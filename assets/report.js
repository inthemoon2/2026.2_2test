/* 보고서 페이지: 링크(?id=...)만 있으면 누구나 볼 수 있는 읽기 전용 페이지. PDF 는 인쇄 → "PDF로 저장" */
(function () {
  const { esc, api } = PJ, box = document.getElementById('rp');
  const qs = new URLSearchParams(location.search), id = qs.get('id') || '';

  async function main() {
    if (!id) { box.innerHTML = '<div class="banner bad">보고서 주소가 올바르지 않아요. (주소 끝에 ?id=… 가 필요합니다)</div>'; return; }
    let r;
    try { r = await api('getReport', { id: id }); } catch (e) { box.innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; return; }
    document.title = r.cls + '반 ' + r.no + '조 프로젝트 보고서';
    box.innerHTML =
      '<div class="row no-print" style="justify-content:flex-end;margin-bottom:8px"><button class="btn ghost" id="cp">링크 복사</button><button class="btn" id="pdf">PDF로 저장하기 (인쇄)</button></div>' +
      (r.status !== '제출완료' ? '<div class="banner warn no-print"><b>작성 중인 보고서</b>예요. 아직 최종 제출 전이거나, 수정을 위해 다시 열려 있어요. 고쳐 쓰면 이 링크의 내용도 함께 바뀌어요.</div>' : '') +
      PJ.reportBodyHtml(r) + (r.feedback ? PJ.feedbackHtml(r.feedback) : '');
    document.getElementById('cp').addEventListener('click', function () { const u = location.origin + location.pathname + '?id=' + encodeURIComponent(id); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { PJ.toast('링크를 복사했어요', 'ok'); }, function () { window.prompt('이 링크를 복사하세요', u); }); });
    document.getElementById('pdf').addEventListener('click', function () { window.print(); });
    if (qs.get('print') === '1') setTimeout(function () { window.print(); }, 700);   // 이미지가 뜰 시간을 잠깐 기다림
  }
  main();
})();
