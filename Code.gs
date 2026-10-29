/****************************************************
 * 수업 활동 보고서 — 저장 + 자동 피드백 + 세특 서버
 *
 * [이 코드가 하는 일]
 *  1) 학생이 제출하면 구글 시트에 한 줄 저장
 *  2) 올린 그림은 내 구글 드라이브 폴더에 저장
 *  3) 제출 즉시 AI 피드백을 자동 생성 (학생이 볼 내용)
 *  4) 세특 문장도 함께 생성 (선생님만 보는 칸)
 *  5) 학생 고유 링크로 보고서·피드백을 다시 볼 수 있게 함
 *
 * [설치 순서]
 *  1) 아래 SHEET_ID 에 내 시트 ID 붙여넣기
 *  2) ⚙ 프로젝트 설정 → 스크립트 속성 → GEMINI_API_KEY 등록
 *  3) 저장 → 함수 목록에서 setup 선택 → ▶ 실행 → 권한 허용
 *  4) [배포] → [새 배포] → 웹 앱
 *       실행 계정: 나 / 액세스: 모든 사용자  ← 꼭!
 *  5) 나온 주소(.../exec)를 index.html 의 submitUrl 에 붙여넣기
 ****************************************************/

// ===== ★수정 1) 내 시트 ID =====
// 시트 주소 docs.google.com/spreadsheets/d/[이_부분]/edit
var SHEET_ID = '여기에_내_시트_ID_붙여넣기';

// ===== ★수정 2) 탭 이름 · 그림 저장 폴더 이름 (그대로 둬도 됨) =====
var SHEET_NAME = '제출';
var IMG_FOLDER = '수업보고서_그림';

// ===== ★수정 3) AI 모델 (404 오류가 나면 이 줄만 교체) =====
var MODEL = 'gemini-3.5-flash-lite';

// ===== ★수정 4) 피드백 성격 — 우리 반에 맞게 고치세요 =====
var FEEDBACK_STYLE =
  '당신은 따뜻한 고등학교 선생님입니다. 학생이 올린 그림 설명을 읽고 피드백을 씁니다.\n' +
  '다음 세 소제목을 그대로 사용하고 각 2~3문장으로 쓰세요.\n' +
  '잘한 점\n더 살펴볼 점\n다음에 해볼 것\n' +
  '규칙: 정답을 대신 써주지 말고 방향만 알려줄 것. 격려하는 말투. ' +
  '별표(**) 같은 기호는 쓰지 말 것.';

// ===== ★수정 5) 세특 작성 규칙 =====
var SAENGTEUK_STYLE =
  '당신은 고등학교 교사입니다. 아래 학생의 활동 내용을 근거로 학교생활기록부 ' +
  '과목별 세부능력 및 특기사항(세특) 문장을 작성하세요.\n' +
  '규칙: 공백 포함 200자 내외. 개조식 종결("~함", "~을 보임"). ' +
  '학생 이름이나 인칭을 쓰지 말 것. 과장·추측 금지. ' +
  '관찰 가능한 활동과 역량 중심으로. 세특 본문만 출력.';

var HEADERS = ['제출시각','학번','이름','그림설명','그림(드라이브)','고유링크','고유토큰',
               'AI피드백','세특(교사용)'];


/* ═══════ 학생 제출 받기 (쓰기) ═══════ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.tryLock(30000); } catch (ig) {}
  try {
    var d = JSON.parse(e.postData.contents);
    var sh = getSheet_();

    // 1) 그림을 드라이브에 저장
    var imgUrl = saveImage_(d.img, (d.sid || '') + '_' + (d.name || '') + '_' + Date.now());

    // 2) AI 피드백 · 세특 자동 생성
    var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    var fb = '', st = '';
    if (!key) {
      fb = st = '[생성 실패] GEMINI_API_KEY 가 등록되지 않았습니다.';
      Logger.log('피드백 건너뜀: API 키 없음');
    } else if (!d.desc) {
      fb = st = '[생성 안 함] 학생이 설명을 작성하지 않았습니다.';
    } else {
      var info = '학생이 쓴 그림 설명:\n' + d.desc;
      var r1 = callGemini_(key, FEEDBACK_STYLE, info);
      // ★ 실패해도 그냥 비우지 않고, 원인을 칸에 남깁니다 (선생님이 바로 알 수 있게)
      fb = r1.error ? ('[생성 실패] ' + r1.error) : r1.text;
      if (r1.error) Logger.log('피드백 실패: ' + r1.error);
      var r2 = callGemini_(key, SAENGTEUK_STYLE, info);
      st = r2.error ? ('[생성 실패] ' + r2.error) : r2.text;
      if (r2.error) Logger.log('세특 실패: ' + r2.error);
    }

    // 3) 시트에 저장
    sh.appendRow([ new Date(), d.sid || '', d.name || '', d.desc || '',
                   imgUrl, d.link || '', d.token || '', fb, st ]);
    return out_({ ok: true });
  } catch (err) {
    Logger.log('doPost ERROR: ' + err);
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ig) {}
  }
}


/* ═══════ 보고서 조회 (읽기 · 학생 링크용) ═══════ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action === 'load') out = { ok: true, record: loadRecord_(p.id) };
    else out = { ok: true, msg: 'OK - 수업 보고서 서버 작동 중' };
  } catch (err) { out = { ok: false, error: String(err) }; }

  var json = JSON.stringify(out);
  if (p.callback)
    return ContentService.createTextOutput(p.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// 고유토큰으로 한 줄 찾기 — 세특은 학생에게 넘기지 않습니다
function loadRecord_(token) {
  if (!token) throw new Error('토큰 없음');
  var sh = getSheet_();
  var v = sh.getDataRange().getValues();
  var h = v[0], c = function (n) { return h.indexOf(n); };
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][c('고유토큰')]) === String(token)) {
      return {
        submittedAt: String(v[r][c('제출시각')]),
        sid:  v[r][c('학번')],
        name: v[r][c('이름')],
        desc: v[r][c('그림설명')],
        imgUrl: v[r][c('그림(드라이브)')],
        feedback: v[r][c('AI피드백')]
        // ※ 세특(교사용) 은 일부러 빼두었습니다 — 학생에게 보이면 안 되므로
      };
    }
  }
  throw new Error('기록을 찾을 수 없습니다.');
}


/* ═══════ 최초 1회 실행: 권한 승인 + 준비 확인 ═══════ */
function setup() {
  var sh = getSheet_();                       // 시트 권한
  Logger.log('시트 준비 완료: ' + sh.getName());
  var folder = getFolder_(IMG_FOLDER);        // 드라이브 권한
  Logger.log('그림 폴더 준비 완료: ' + folder.getName());
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (key) {
    var r = callGemini_(key, '한 문장으로 답하세요.', '준비되었나요?');   // 외부 요청 권한
    Logger.log(r.error ? ('AI 연결 실패: ' + r.error) : ('AI 연결 성공: ' + r.text));
  } else {
    Logger.log('주의: GEMINI_API_KEY 가 없습니다. (프로젝트 설정 → 스크립트 속성)');
  }
  Logger.log('=== 준비 완료! 이제 배포하세요 ===');
}

// 학생 없이 내가 직접 넣어보는 테스트
function testWrite() {
  doPost({ postData: { contents: JSON.stringify({
    token: 'testtoken123', link: '(테스트)', name: '연결테스트', sid: 'TEST',
    desc: '막대그래프로 월별 강수량을 나타냈고, 여름에 크게 늘어나는 것을 알 수 있었다.', img: ''
  })}});
  Logger.log('시트를 확인하세요. 피드백과 세특까지 채워지면 성공입니다.');
}


/* ═══════ Gemini 호출 ═══════ */
function callGemini_(key, system, user) {
  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + MODEL + ':generateContent?key=' + key;
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }]
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200)
      return { error: 'API 오류(' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200) };
    var data = JSON.parse(res.getContentText());
    var t = data.candidates[0].content.parts.map(function (x) { return x.text || ''; }).join('\n').trim();
    return { text: t };
  } catch (err) { return { error: String(err) }; }
}


/* ═══════ 헬퍼 ═══════ */
function getSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}
function getFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function saveImage_(dataUrl, filename) {
  if (!dataUrl) return '';
  var m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  if (!m) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename + '.jpg');
  var file = getFolder_(IMG_FOLDER).createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (ig) {}
  return file.getUrl();
}
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/****************************************************
 * 🔍 AI 연결 진단 — Code.gs 맨 아래에 붙여넣고 실행
 *
 * [실행 방법]
 *  1) 이 내용을 Code.gs 맨 아래에 붙여넣고 저장
 *  2) 상단 함수 목록에서  checkAI  선택 → ▶ 실행
 *  3) 왼쪽 [실행 기록] 또는 하단 로그 확인
 *
 * 로그에 ①키 등록 여부 ②사용 가능한 모델 목록 ③실제 오류 내용이
 * 모두 표시됩니다. 그대로 읽으면 원인을 알 수 있습니다.
 ****************************************************/
function checkAI() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  // ── 1) API 키가 등록되어 있나?
  if (!key) {
    Logger.log('❌ 원인 발견: GEMINI_API_KEY 가 등록되지 않았습니다.');
    Logger.log('   → ⚙ 프로젝트 설정 → 스크립트 속성 → [속성 추가]');
    Logger.log('      속성: GEMINI_API_KEY   /   값: AIza... (내 키)');
    return;
  }
  Logger.log('✅ 1단계 — API 키 등록됨 (앞 6자리: ' + key.substring(0, 6) + '...)');
  if (key.indexOf('AIza') !== 0) {
    Logger.log('⚠️  주의: 보통 키는 AIza 로 시작합니다. 키를 잘못 복사했을 수 있습니다.');
  }

  // ── 2) 내 키로 "실제 사용 가능한 모델" 목록 받아오기
  Logger.log('--- 2단계 — 사용 가능한 모델 목록 조회 중 ---');
  var listRes = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?key=' + key,
    { muteHttpExceptions: true });

  if (listRes.getResponseCode() !== 200) {
    Logger.log('❌ 모델 목록 조회 실패 (' + listRes.getResponseCode() + ')');
    Logger.log('   응답: ' + listRes.getContentText().slice(0, 500));
    Logger.log('   → 키가 잘못되었거나, 사용 설정이 안 된 키일 수 있습니다.');
    return;
  }

  var models = JSON.parse(listRes.getContentText()).models || [];
  var usable = [];
  models.forEach(function (m) {
    var methods = m.supportedGenerationMethods || [];
    if (methods.indexOf('generateContent') >= 0) {
      usable.push(m.name.replace('models/', ''));
    }
  });

  Logger.log('✅ 2단계 — 내 키로 쓸 수 있는 모델 ' + usable.length + '개:');
  usable.forEach(function (n) { Logger.log('      ' + n); });

  // ── 3) 지금 코드에 적힌 모델이 그 목록에 있나?
  Logger.log('--- 3단계 — 현재 설정 확인 ---');
  Logger.log('   코드에 적힌 MODEL = ' + MODEL);
  if (usable.indexOf(MODEL) === -1) {
    Logger.log('❌ 원인 발견: 이 모델은 내 키로 사용할 수 없습니다.');
    Logger.log('   → 위 목록에서 이름을 하나 골라 Code.gs 의 MODEL 값을 바꾸세요.');
    if (usable.length) Logger.log('   → 추천: ' + recommend_(usable));
    return;
  }
  Logger.log('✅ 3단계 — 모델 이름 정상');

  // ── 4) 실제로 문장을 만들어 보기
  Logger.log('--- 4단계 — 실제 생성 테스트 ---');
  var r = callGemini_(key, '한 문장으로만 답하세요.', '연결 테스트입니다. "연결 성공"이라고 답해 주세요.');
  if (r.error) {
    Logger.log('❌ 생성 실패: ' + r.error);
  } else {
    Logger.log('✅ 4단계 — 생성 성공! 응답: ' + r.text);
    Logger.log('🎉 모든 단계 정상입니다. 이제 학생이 제출하면 피드백이 만들어집니다.');
  }
}

// 목록 중 수업용으로 적당한 모델 하나 추천
function recommend_(list) {
  var prefer = ['flash-lite', 'flash'];
  for (var i = 0; i < prefer.length; i++) {
    for (var j = 0; j < list.length; j++) {
      if (list[j].indexOf(prefer[i]) >= 0 && list[j].indexOf('preview') === -1) return list[j];
    }
  }
  return list[0];
}
