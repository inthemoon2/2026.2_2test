/**
 * 사회문제 해결 기계학습 프로젝트 — 서버 (Google Apps Script)
 *
 * ■ 설치(요약)
 *   1) 구글 시트를 하나 만든다.  2) 확장 프로그램 → Apps Script 에 이 파일 전체를 붙여넣는다.
 *   3) 프로젝트 설정(톱니바퀴) → 스크립트 속성에  ADMIN_PASSWORD = 관리자 비밀번호  를 추가한다.
 *   4) 배포 → 새 배포 → 웹 앱 → 실행 사용자: 나 / 액세스: 모든 사용자 → 배포 → 웹앱 URL 복사.
 *   (자세한 클릭 순서는 README.md 참고)
 *
 * ■ 스크립트 속성 (모두 선택, ADMIN_PASSWORD 만 필수)
 *   ADMIN_PASSWORD  : 관리자 페이지 비밀번호 (필수)
 *   SPREADSHEET_ID  : 시트에 붙여 만든 스크립트가 아니라면 시트 ID 입력
 *   DRIVE_FOLDER_ID : 제출 파일을 모을 드라이브 폴더 ID (없으면 자동 생성)
 *   SESSION_SECRET  : 로그인 서명용 비밀값 (자동 생성됨, 직접 만들 필요 없음)
 *
 * ■ 이 파일의 구성
 *   1. 화면 구성(SCHEMA)·평가 기준(RUBRIC)   ← 항목을 바꾸고 싶으면 여기만 고친다
 *   2. 공통 도구(시트 읽기/쓰기, 로그인 토큰)
 *   3. 학생용 기능   4. 가상 채점   5. 관리자 기능
 *
 * ■ 주의: 항목(필드) id 를 바꾸거나 지우면 이미 쓴 내용과 연결이 끊어진다. 새 항목 추가는 괜찮다.
 */

const VERSION = '1.0';
const BASE_SCORE_DEFAULT = 30;          // 결석 학생 기본 점수 (설정 화면에서 바꿀 수 있음)
const MAX_BYTES = { csv: 5 * 1024 * 1024, img: 5 * 1024 * 1024, ppt: 10 * 1024 * 1024 };
const SESSION_HOURS = { s: 12, a: 8 };

const ROLES = ['프로젝트 매니저', '데이터 엔지니어', '모델 개발자', '도메인 분석가', 'AI 윤리·소통 담당'];

/* ════════════════ 1-A. 시트 정의 ════════════════ */
const SH = {
  teams:    { name: '조현황',   text: true,  headers: ['팀ID', '반', '조', '분야', '비번해시', '비번솔트', '상태', '제출일시', '제출자', '보고서ID', '보고서링크', '변경번호', '마지막수정', '마지막수정자', '진행률', '단계진행', '생성일시'] },
  students: { name: '학생',     text: true,  headers: ['팀ID', '반', '조', '학번', '이름', '역할', '결석', '메모'] },
  content:  { name: '내용',     text: true,  headers: ['키', '팀ID', '필드', '값', '버전', '수정자', '수정일시'] },
  history:  { name: '수정이력', text: true,  headers: ['일시', '팀ID', '반', '조', '학번', '이름', '페이지', '필드', '글자수변화', '종류'] },
  files:    { name: '파일',     text: true,  headers: ['파일ID', '팀ID', '종류', '필드', '파일명', '크기', '링크', '메타', '업로더', '일시', '사용'] },
  tscore:   { name: '조채점',   text: false, headers: ['팀ID', '반', '조', '기획안', '기획안_사유', '전처리', '전처리_사유', '모델생성', '모델생성_사유', '모델평가', '모델평가_사유', '채점일시'] },
  sscore:   { name: '개인채점', text: false, headers: ['팀ID', '이름', '학번', '결석', '조정_기획안', '조정_전처리', '조정_모델생성', '조정_모델평가', '조정사유', '동료원점수', '동료응답수', '동료환산', '수정일시'] },
  view:     { name: '채점표',   text: false, headers: ['반', '조', '분야', '학번', '이름', '역할', '결석', '기획안(20)', '전처리(20)', '모델생성(20)', '모델평가(20)', '동료평가 원점수', '동료평가 환산(20)', '합계', '개인조정', '조정 사유', '상태'] },
  virtual:  { name: '가상채점', text: true,  headers: ['실행일시', '팀ID', '반', '조', '평가요소', '제안점수', '충족한 점검', '미충족 점검', '상세 근거'] },
  peer:     { name: '동료평가', text: true,  headers: ['가져온일시', '평가자', '피평가자', '점수(평균)', '점수들'] },
  settings: { name: '설정',     text: true,  headers: ['키', '값'] },
  logs:     { name: '로그',     text: true,  headers: ['일시', '주체', '행동', '상세'] },
};

/* ════════════════ 1-B. 평가 기준 (HWP 평가 기준표 그대로) ════════════════ */
const ELEMS = ['E1', 'E2', 'E3', 'E4'];
const ELEM_COL = { E1: '기획안', E2: '전처리', E3: '모델생성', E4: '모델평가' };
const RUBRIC = {
  E1: {
    name: '기획안 작성', max: 20,
    levels: [
      { score: 20, text: '지속가능발전목표와 연계된 사회 문제를 구체적이고 명확하게 정의하고, 문제 해결의 필요성과 목적이 타당하게 제시됨. 인공지능 문제 해결 5단계에 따라 데이터 수집부터 모델 평가까지의 수행 절차가 논리적이고 체계적으로 계획됨. 모둠원의 역할과 협업 방법이 구체적으로 설정됨.' },
      { score: 14, text: '지속가능발전목표와 관련된 사회 문제를 정의하고 프로젝트 수행 계획을 수립함. 문제 해결 5단계 중 일부 단계의 연결이 다소 부족하거나, 수행 절차와 역할 분담의 구체성이 부족함.' },
      { score: 8, text: '지속가능발전목표와의 연계 또는 사회 문제의 정의가 불분명함. 프로젝트 수행 절차가 부분적으로만 제시되거나, 인공지능 문제 해결 과정에 따른 계획 수립이 충분히 이루어지지 않음.' },
    ],
  },
  E2: {
    name: '데이터 수집 및 전처리하기', max: 20,
    levels: [
      { score: 20, text: '문제 해결 목적에 적합한 데이터를 신뢰할 수 있는 출처에서 수집하고, 데이터의 특성과 구조를 정확하게 파악함. 이상치와 결측치를 타당한 기준에 따라 처리하고, 필요한 데이터를 선별하여 정규화 또는 변환을 적절하게 수행함. 문제 유형에 맞게 독립변수와 종속변수를 설정하고, 훈련 데이터와 테스트 데이터를 적절한 비율로 분리함.' },
      { score: 16, text: '문제 해결에 적합한 데이터를 수집하고, 이상치와 결측치 처리, 핵심 요소 선별, 변수 설정, 데이터 분할 등 주요 전처리 과정을 대부분 정확하게 수행함. 일부 과정의 근거 제시나 처리의 정교함이 다소 부족함.' },
      { score: 12, text: '데이터를 수집하고 전처리 과정을 수행하였으나, 이상치와 결측치 처리, 변수 설정, 데이터 분할 등에서 일부 오류 또는 누락이 확인됨. 전처리 결과가 모델 학습에 활용 가능한 수준으로 부분적으로 정리됨.' },
      { score: 8, text: '데이터 수집 또는 전처리 과정이 충분하지 않으며, 이상치와 결측치 처리, 변수 설정, 데이터 분할 중 다수의 과정이 누락되거나 부적절하게 수행됨.' },
    ],
  },
  E3: {
    name: '모델 생성 및 학습하기', max: 20,
    levels: [
      { score: 20, text: '분류, 회귀, 군집 등 문제 유형을 정확하게 판단하고, 문제 해결 목적에 적합한 인공지능 모델을 선택하여 생성함. 훈련 데이터를 사용하여 학습을 정상적으로 완료하고, 모델별 주요 설정값을 목적에 맞게 조정함.' },
      { score: 16, text: '문제 유형에 적합한 인공지능 모델을 생성하고 훈련 데이터를 활용하여 학습을 완료함. 모델 설정과 학습 결과를 확인하였으나, 설정값의 근거나 학습 결과에 대한 설명이 일부 부족함.' },
      { score: 12, text: '인공지능 모델을 생성하고 학습을 시도하였으나, 문제 유형과 모델의 적합성 판단 또는 훈련 데이터 사용 과정에서 일부 오류가 발생함. 학습 결과에 대한 확인과 설명이 제한적으로 이루어짐.' },
      { score: 8, text: '문제 유형에 적합하지 않은 모델을 선택하거나, 모델 생성 또는 훈련 데이터 학습 과정이 정상적으로 완료되지 않음. 학습 결과에 대한 확인과 설명이 이루어지지 않음.' },
    ],
  },
  E4: {
    name: '모델 평가하기', max: 20,
    levels: [
      { score: 20, text: '훈련에 사용하지 않은 테스트 데이터를 활용하여 예측을 수행하고, 문제 유형에 적합한 평가 지표와 시각화 결과를 제시함. 그래프, 혼동행렬, 예측 결과 등을 근거로 모델의 성능을 정확하게 해석하고 오차의 원인과 한계를 분석함. 평가 결과를 바탕으로 모델의 개선 방향을 구체적으로 제안함.' },
      { score: 16, text: '테스트 데이터를 활용하여 모델을 평가하고 평가 지표 또는 시각화 결과를 제시함. 모델의 성능과 결과를 해석하였으나, 오차 원인, 한계 또는 개선 방향에 대한 분석이 일부 부족함.' },
      { score: 12, text: '테스트 데이터를 활용한 예측과 모델 평가를 수행하였으나, 평가 지표 선택이나 결과 해석이 충분하지 않음. 모델의 성능을 단순 수치 또는 그래프 수준에서 설명함.' },
      { score: 8, text: '테스트 데이터에 기반한 평가가 제대로 이루어지지 않거나 훈련 데이터로 성능을 평가함. 평가 결과를 제시하였더라도 모델의 성능과 의미에 대한 해석이 충분히 이루어지지 않음.' },
    ],
  },
  E5: {
    name: '동료평가', max: 20,
    levels: [
      { score: 20, text: '맡은 역할을 책임감 있게 수행하고 모둠원과 수행 상황을 지속적으로 공유하며 문제 해결 과정에 적극적으로 참여함. 의견 차이나 수행상의 어려움이 발생한 경우 근거를 바탕으로 조율하고 공동의 해결 방안을 마련함. 프로젝트 결과물의 완성도 향상에 실질적으로 기여한 내용이 동료평가를 통해 확인됨.' },
      { score: 16, text: '맡은 역할을 성실하게 수행하고 모둠 활동에 지속적으로 참여함. 의사소통과 협업이 원활하게 이루어지고 프로젝트 결과물 완성에 기여한 내용이 확인됨.' },
      { score: 12, text: '맡은 역할을 수행하였으나 참여의 지속성이나 협업 과정에서 일부 소극적인 모습이 확인됨. 프로젝트 결과물에 대한 기여가 제한적으로 확인됨.' },
      { score: 8, text: '맡은 역할의 수행이 충분하지 않아 다른 모둠원이 해당 업무를 보완하거나 대신 수행함. 협업 과정에 대한 참여와 프로젝트 결과물에 대한 기여가 충분히 확인되지 않음.' },
    ],
  },
};

/* ════════════════ 1-C. 화면 구성 (학생이 채우는 항목) ════════════════
 * type: text | textarea | select | multiselect | checkbox | number | url | file
 * req: 진행률 계산에 포함되는 필수 항목   min: 권장 글자 수(공백 제외) — 가상 채점 기준과 동일
 * perMember: 조원마다 따로 쓰는 항목(본인만 수정 가능)
 */
const SDG_LIST = ['1. 빈곤 퇴치', '2. 기아 종식', '3. 건강과 웰빙', '4. 양질의 교육', '5. 성평등', '6. 깨끗한 물과 위생', '7. 모두를 위한 깨끗한 에너지', '8. 양질의 일자리와 경제성장', '9. 산업, 혁신과 사회기반시설', '10. 불평등 완화', '11. 지속가능한 도시와 공동체', '12. 책임감 있는 소비와 생산', '13. 기후변화 대응', '14. 해양생태계 보전', '15. 육상생태계 보호', '16. 평화, 정의와 튼튼한 제도', '17. 지구촌 협력 강화'];
const ALGO_TYPES = {
  '단순 선형 회귀': ['회귀'], '다중 선형 회귀': ['회귀'], '로지스틱 회귀': ['분류'],
  'K-최근접 이웃(KNN)': ['분류', '회귀'], '결정트리': ['분류', '회귀'], '랜덤 포레스트': ['분류', '회귀'],
  '서포트 벡터 머신(SVM)': ['분류', '회귀'], 'K-평균 군집': ['군집'], '기타': ['분류', '회귀', '군집'],
};
const METRICS = ['정확도(accuracy)', '정밀도', '재현율', '혼동 행렬', '결정계수(R²)', '평균 절대 오차(MAE)', '평균 제곱 오차(MSE)', '기타'];
const LEVEL3 = ['문제 없음', '우려 있음', '잘 모르겠음'];

function T_(id, label, o) { return Object.assign({ id: id, type: 'textarea', label: label }, o || {}); }

const PAGES = [
  {
    id: 'p1', no: 1, title: '문제 정의 · 수행 계획', owners: ['프로젝트 매니저', '도메인 분석가'], rubric: ['E1'],
    intro: '우리 조가 해결할 사회문제를 정하고, 인공지능 문제 해결 5단계에 따라 어떻게 진행할지 계획합니다.',
    sections: [
      { title: '1-1. 사회문제 정하기', fields: [
        T_('sdg', '연결되는 지속가능발전목표(SDGs) 한 가지', { type: 'select', opts: SDG_LIST, req: true }),
        T_('sdg_why', '이 목표를 고른 이유와 연결 설명', { req: true, min: 40, hint: '우리 진로 분야와 이 목표가 어떻게 이어지는지 적어 보세요.', ph: '예) 간호 분야에서는 환자 안전과 건강이 중요하기 때문에 3번 목표와 연결된다.' }),
        T_('problem', '해결하려는 사회문제 (누가, 어디서, 어떤 어려움을 겪나요?)', { req: true, min: 80, hint: '숫자나 사례가 있으면 더 좋아요. 출처가 있다면 함께 적어요.' }),
        T_('need', '문제 해결이 왜 필요한가요? (필요성과 목적)', { req: true, min: 50 }),
        T_('goal', '인공지능으로 예측하거나 분류할 것을 한 문장으로', { req: true, min: 20, ph: '예) 학생의 하루 수면 시간과 스마트폰 사용 시간으로 피로도를 예측한다.' }),
        T_('ml_type', '문제 유형', { type: 'select', opts: ['분류', '회귀', '군집'], req: true, hint: '분류: 종류를 맞히기 / 회귀: 숫자를 예측하기 / 군집: 비슷한 것끼리 묶기' }),
        T_('ml_type_why', '그렇게 판단한 이유', { req: true, min: 30 }),
      ] },
      { title: '1-2. 수행 계획 (인공지능 문제 해결 5단계)', fields: [
        T_('plan_s1', '1단계 문제 정의: 무엇을 어떻게 정리할까요?', { req: true, min: 20 }),
        T_('plan_s2', '2단계 데이터 수집·전처리: 어떤 데이터를 어디서 구하고 어떻게 다듬을까요?', { req: true, min: 20 }),
        T_('plan_s3', '3단계 모델 개발 및 평가: 어떤 모델로 학습하고 어떻게 평가할까요?', { req: true, min: 20 }),
        T_('plan_s4', '4단계 결과 분석·해결 방안: 결과로 무엇을 알아내고 어떻게 활용할까요?', { req: true, min: 20 }),
        T_('plan_s5', '5단계 AI 윤리 점검: 어떤 윤리 문제를 살펴볼까요?', { req: true, min: 20 }),
      ] },
      { title: '1-3. 역할과 협업', fields: [
        T_('plan_roles', '역할별로 맡은 일을 구체적으로 적어요', { req: true, min: 60, hint: '팀 홈의 역할 표를 보고, 누가 어떤 일을 할지 적어요. 겹치는 역할은 어떻게 나눌지도 적어요.' }),
        T_('plan_collab', '협업 방법 (소통 방식, 진행 상황 공유, 의견이 다를 때 해결 방법)', { req: true, min: 40 }),
      ] },
    ],
  },
  {
    id: 'p2', no: 2, title: '데이터 수집 · 전처리', owners: ['데이터 엔지니어'], rubric: ['E2'],
    intro: '문제 해결에 쓸 데이터를 모으고, 모델이 학습할 수 있도록 다듬습니다. CSV 파일을 이 페이지에 올려요.',
    sections: [
      { title: '2-1. 데이터 수집', fields: [
        T_('data_source', '데이터 출처 (사이트 이름과 주소)', { type: 'text', req: true }),
        T_('data_reliable', '이 출처를 믿을 수 있는 이유', { req: true, min: 30 }),
        T_('data_file', 'CSV 파일 올리기 (5MB 이하)', { type: 'file', kind: 'csv', hint: '올리면 행·열 개수와 결측치를 자동으로 보여 줘요. 한글이 깨지면 안내가 나와요.' }),
        T_('data_link', 'CSV가 5MB보다 크다면 원본 링크', { type: 'url' }),
        T_('data_desc', '데이터 설명 (한 행은 무엇인지, 각 열은 무슨 뜻인지)', { req: true, min: 40 }),
        T_('data_privacy', '이 데이터에는 이름·연락처 같은 개인정보가 없습니다.', { type: 'checkbox', req: true }),
      ] },
      { title: '2-2. 전처리', fields: [
        T_('rows_before', '처리 전 행 개수', { type: 'number' }),
        T_('rows_after', '처리 후 행 개수', { type: 'number' }),
        T_('missing_handle', '결측치(빈 값)는 어떻게 처리했나요? 이유도 적어요', { req: true, min: 30 }),
        T_('outlier_handle', '이상치(너무 튀는 값)는 어떻게 확인하고 처리했나요?', { req: true, min: 30 }),
        T_('scaling', '정규화·변환', { type: 'select', opts: ['하지 않음', '최소-최대 정규화(MinMaxScaler)', '표준화(StandardScaler)', '기타 변환'], req: true }),
        T_('scaling_why', '그렇게 한 이유', { req: true, min: 20 }),
      ] },
      { title: '2-3. 변수 정하기와 데이터 나누기', fields: [
        T_('features', '독립 변수(특징, X)', { type: 'text', req: true, ph: '예) 수면시간, 스마트폰 사용시간' }),
        T_('target', '종속 변수(타깃, y)', { type: 'text', req: true }),
        T_('var_why', '이 변수들을 고른 이유', { req: true, min: 30 }),
        T_('split_ratio', '훈련 : 테스트 비율', { type: 'text', req: true, ph: '예) 7 : 3' }),
        T_('split_seed', 'random_state 값 (사용했다면)', { type: 'text' }),
        T_('data_limit', '이 데이터의 한계 (대표성, 개수, 편향 등)', { min: 30 }),
      ] },
    ],
  },
  {
    id: 'p3', no: 3, title: '모델 개발 · 평가', owners: ['모델 개발자'], rubric: ['E3', 'E4'],
    intro: '코랩에서 모델을 만들어 학습시키고, 학습에 쓰지 않은 테스트 데이터로 평가합니다.',
    sections: [
      { title: '3-1. 모델 생성 및 학습', fields: [
        T_('colab_link', '코랩 노트북 링크 (공유: 링크가 있는 모든 사용자)', { type: 'url', req: true }),
        T_('algos', '사용한 모델(알고리즘)', { type: 'multiselect', opts: Object.keys(ALGO_TYPES), req: true }),
        T_('algo_why', '이 모델을 고른 이유 (문제 유형과 연결해서)', { req: true, min: 30 }),
        T_('params', '주요 설정값과 그렇게 정한 이유', { req: true, min: 20, ph: '예) n_neighbors=5, test_size=0.3 ... 바꿔 본 값이 있으면 함께' }),
        T_('train_result', '학습 결과 확인 (훈련 데이터 점수 등)', { req: true, min: 30 }),
        T_('code_img', '핵심 코드 캡처 (선택)', { type: 'file', kind: 'img' }),
      ] },
      { title: '3-2. 모델 평가', fields: [
        T_('eval_data', '평가에 사용한 데이터', { type: 'select', opts: ['테스트 데이터', '훈련 데이터', '둘 다'], req: true, hint: '성능은 학습에 쓰지 않은 테스트 데이터로 평가해야 해요.' }),
        T_('metrics', '사용한 평가 지표', { type: 'multiselect', opts: METRICS, req: true }),
        T_('metric_value', '평가 결과 수치', { type: 'text', req: true, ph: '예) 정확도 훈련 0.98 / 테스트 0.94' }),
        T_('eval_img', '그래프·혼동 행렬 캡처', { type: 'file', kind: 'img', hint: '코랩 결과 화면을 캡처해서 올려요.' }),
        T_('eval_pred', '예측값과 실제값 비교 (몇 개 골라서)', { min: 30 }),
        T_('improve_try', '성능을 높이려고 시도한 것과 결과', { req: true, min: 40, hint: '무엇을 바꿨더니 점수가 어떻게 변했는지 적어요.' }),
      ] },
    ],
  },
  {
    id: 'p4', no: 4, title: '결과 분석 · 해결 방안', owners: ['도메인 분석가'], rubric: ['E4'],
    intro: '모델 결과가 무엇을 뜻하는지 해석하고, 사회문제를 해결하는 데 어떻게 쓸 수 있는지 정리합니다.',
    sections: [
      { title: '4-1. 결과 분석', fields: [
        T_('interp', '결과 해석: 점수와 그래프는 무엇을 뜻하나요?', { req: true, min: 60 }),
        T_('error_cause', '틀린 예측이 생긴 원인', { req: true, min: 40 }),
        T_('model_limit', '모델의 한계', { req: true, min: 40 }),
        T_('improve_dir', '모델 개선 방향 (구체적으로)', { req: true, min: 60 }),
      ] },
      { title: '4-2. 해결 방안', fields: [
        T_('solution', '이 결과를 사회문제 해결에 어떻게 활용할 수 있나요?', { req: true, min: 60 }),
        T_('effect', '기대 효과와 앞으로 더 할 일', { min: 40 }),
      ] },
    ],
  },
  {
    id: 'p5', no: 5, title: 'AI 윤리 점검', owners: ['AI 윤리·소통 담당'], rubric: ['E4'],
    intro: '우리가 만든 인공지능이 사회에 어떤 영향을 줄 수 있는지 살펴보고, 개선 방안을 제시합니다.',
    sections: [
      { title: '5-1. 윤리 점검표', fields: [
        T_('eth1_level', '① 데이터 편향: 특정 집단이 빠지거나 한쪽으로 치우친 데이터는 아닌가요?', { type: 'select', opts: LEVEL3, req: true }),
        T_('eth1_note', '근거와 설명', { req: true, min: 30 }),
        T_('eth2_level', '② 개인정보: 개인을 알아볼 수 있는 정보가 쓰이지는 않았나요?', { type: 'select', opts: LEVEL3, req: true }),
        T_('eth2_note', '근거와 설명', { req: true, min: 30 }),
        T_('eth3_level', '③ 공정성: 모델이 특정 사람들에게 불리하게 작동하지는 않나요?', { type: 'select', opts: LEVEL3, req: true }),
        T_('eth3_note', '근거와 설명', { req: true, min: 30 }),
        T_('eth4_level', '④ 오류의 영향: 모델이 틀렸을 때 누구에게 어떤 피해가 생기나요? 책임은 누구에게 있나요?', { type: 'select', opts: LEVEL3, req: true }),
        T_('eth4_note', '근거와 설명', { req: true, min: 30 }),
        T_('eth5_level', '⑤ 오남용: 이 기술이 나쁜 목적으로 쓰일 가능성은 없나요?', { type: 'select', opts: LEVEL3, req: true }),
        T_('eth5_note', '근거와 설명', { req: true, min: 30 }),
      ] },
      { title: '5-2. 사회적 영향을 고려한 개선', fields: [
        T_('eth_improve', '위 점검 결과를 반영한 개선 방안', { req: true, min: 40, hint: '데이터·모델·사용 방법을 어떻게 바꾸면 더 안전하고 공정해질까요?' }),
        T_('eth_reflect', '윤리 고찰 종합', { min: 40 }),
      ] },
    ],
  },
  {
    id: 'p6', no: 6, title: '발표 자료 · 제출', owners: ['프로젝트 매니저'], rubric: [],
    intro: '발표 자료를 올리고, 내가 한 일을 기록한 뒤 교사에게 제출합니다.',
    sections: [
      { title: '6-1. 발표 자료', fields: [
        T_('ppt_file', '발표 자료 파일 (PPT 또는 PDF, 10MB 이하)', { type: 'file', kind: 'ppt' }),
        T_('ppt_link', '발표 자료 링크 (구글 슬라이드 등)', { type: 'url' }),
      ] },
      { title: '6-2. 나의 기여 (조원마다 본인이 작성)', fields: [
        T_('contrib_do', '내가 맡아서 한 일', { req: true, min: 40, perMember: true, hint: '구체적으로 적을수록 좋아요. 다른 조원의 칸은 수정할 수 없어요.' }),
        T_('contrib_learn', '배운 점과 어려웠던 점', { req: true, min: 30, perMember: true }),
      ] },
    ],
  },
];

const FIELD_INDEX = {};
PAGES.forEach(function (pg) { pg.sections.forEach(function (sc) { sc.fields.forEach(function (f) { f.page = pg.id; FIELD_INDEX[f.id] = f; }); }); });

/* ════════════════ 2. 공통 도구 ════════════════ */

// 제출 시 한 줄로 저장되는 '제출' 시트: 항목마다 열 하나
SH.submit = {
  name: '제출', text: true,
  headers: ['제출일시', '반', '조', '분야', '조원(역할)', '제출자', '보고서링크', '진행률'].concat(
    PAGES.reduce(function (a, pg) {
      pg.sections.forEach(function (sc) { sc.fields.forEach(function (f) { a.push(f.id + ' | ' + f.label.slice(0, 40)); }); });
      return a;
    }, [])),
};

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function fail_(code, msg) { const e = new Error(msg); e.code = code; return e; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }
function esc_(s) { return String(s == null ? '' : s); }

/* ---- 시트 읽기/쓰기 ---- */
function ss_() {
  let s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { s = null; }
  if (!s && prop_('SPREADSHEET_ID')) s = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  if (!s) throw fail_('NO_SHEET', '연결된 구글 시트를 찾지 못했습니다. 시트에서 Apps Script를 열었는지, 또는 SPREADSHEET_ID 속성을 넣었는지 확인하세요.');
  return s;
}

function sheet_(key) {
  const def = SH[key], n = def.headers.length, ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    sh.getRange(1, 1, 1, n).setValues([def.headers]).setFontWeight('bold').setBackground('#1D6A8A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    // 학생이 쓴 글이 '=' 로 시작해도 수식으로 실행되지 않도록 서식을 텍스트로
    if (def.text) sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), n).setNumberFormat('@');
  }
  return sh;
}

function readAll_(key) {
  const sh = sheet_(key), n = SH[key].headers.length, last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(1, 1, last, n).getValues(), hd = SH[key].headers, out = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    const o = { _row: i + 1 };
    for (let j = 0; j < n; j++) o[hd[j]] = row[j];
    out.push(o);
  }
  return out;
}

function toRow_(key, o) { return SH[key].headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; }); }
function appendObj_(key, o) { sheet_(key).appendRow(toRow_(key, o)); }

function writeRow_(key, row, o) {
  const sh = sheet_(key), n = SH[key].headers.length;
  const cur = sh.getRange(row, 1, 1, n).getValues()[0];
  SH[key].headers.forEach(function (h, i) { if (Object.prototype.hasOwnProperty.call(o, h)) cur[i] = o[h]; });
  sh.getRange(row, 1, 1, n).setValues([cur]);
}

function rewrite_(key, objs) {
  const sh = sheet_(key), n = SH[key].headers.length, last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!objs.length) return;
  if (sh.getMaxRows() < objs.length + 1) sh.insertRowsAfter(sh.getMaxRows(), objs.length + 1 - sh.getMaxRows());
  const rng = sh.getRange(2, 1, objs.length, n);
  if (SH[key].text) rng.setNumberFormat('@');
  rng.setValues(objs.map(function (o) { return toRow_(key, o); }));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { throw fail_('BUSY', '접속자가 많아 잠시 지연되고 있어요. 잠시 뒤 다시 시도해 주세요.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function log_(who, act, detail) { try { appendObj_('logs', { 일시: now_(), 주체: who, 행동: act, 상세: String(detail || '').slice(0, 500) }); } catch (e) { /* 로그 실패는 무시 */ } }

/* ---- 설정 ---- */
function settings_() {
  const s = { schoolName: '', siteUrl: '', baseScore: String(BASE_SCORE_DEFAULT) };
  readAll_('settings').forEach(function (r) { s[r['키']] = String(r['값']); });
  return s;
}
function setSetting_(k, v) {
  const r = readAll_('settings').filter(function (x) { return x['키'] === k; })[0];
  if (r) writeRow_('settings', r._row, { 값: String(v) }); else appendObj_('settings', { 키: k, 값: String(v) });
}
function baseScore_() { const n = Number(settings_().baseScore); return isNaN(n) ? BASE_SCORE_DEFAULT : n; }

/* ---- 로그인 토큰 (서버가 서명한 이름표) ---- */
function secret_() {
  const P = PropertiesService.getScriptProperties();
  let s = P.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('SESSION_SECRET', s); }
  return s;
}
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hmac_(text) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_())); }
function signToken_(payload) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + hmac_(body);
}
function verifyToken_(token, kind) {
  if (!token || String(token).indexOf('.') < 0) throw fail_('BAD_TOKEN', '로그인이 필요합니다.');
  const parts = String(token).split('.');
  if (!safeEq_(hmac_(parts[0]), parts[1] || '')) throw fail_('BAD_TOKEN', '로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.');
  let p;
  try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { throw fail_('BAD_TOKEN', '로그인 정보가 올바르지 않습니다.'); }
  if (p.k !== kind) throw fail_('FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
  if (Date.now() > p.exp) throw fail_('EXPIRED', '로그인 시간이 지났습니다. 다시 로그인해 주세요.');
  return p;
}
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---- 비밀번호 ---- */
function hashPw_(pw, salt) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(pw).toUpperCase().trim()));
}
function genPw_() {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자(0 O 1 I) 제외
  let s = '';
  for (let i = 0; i < 6; i++) s += set.charAt(Math.floor(Math.random() * set.length));
  return s;
}

/* ---- 로그인 시도 제한 ---- */
function failCount_(key) { return Number(CacheService.getScriptCache().get('fail_' + key) || 0); }
function failAdd_(key) { CacheService.getScriptCache().put('fail_' + key, String(failCount_(key) + 1), 600); }
function failClear_(key) { CacheService.getScriptCache().remove('fail_' + key); }

/* ---- 조·학생·내용 읽기 ---- */
function teamById_(tid) {
  const t = readAll_('teams').filter(function (r) { return r['팀ID'] === tid; })[0];
  if (!t) throw fail_('NO_TEAM', '조 정보를 찾을 수 없습니다.');
  return t;
}
function membersOf_(tid) { return readAll_('students').filter(function (r) { return r['팀ID'] === tid; }); }
function contentOf_(tid) {
  const m = {};
  readAll_('content').forEach(function (r) {
    if (r['팀ID'] === tid) m[r['필드']] = { val: String(r['값']), v: Number(r['버전']) || 0, by: r['수정자'], at: r['수정일시'], _row: r._row };
  });
  return m;
}
function filesOf_(tid) {
  const m = {};
  readAll_('files').forEach(function (r) {
    if (r['팀ID'] === tid && r['사용'] === 'Y') {
      let meta = {}; try { meta = JSON.parse(r['메타'] || '{}'); } catch (e) { meta = {}; }
      m[r['필드']] = fileInfo_(r['파일ID'], r['파일명'], Number(r['크기']) || 0, r['종류'], meta, r['업로더'], r['일시']);
    }
  });
  return m;
}
function fileInfo_(id, name, size, kind, meta, by, at) {
  return {
    id: id, name: name, size: size, kind: kind, meta: meta, by: by, at: at,
    view: 'https://drive.google.com/file/d/' + id + '/view',
    thumb: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000',
    download: 'https://drive.google.com/uc?export=download&id=' + id,
  };
}
function rolesOf_(m) { return String(m['역할'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

/* ---- 진행률 ---- */
function isFilled_(f, content, name) {
  const c = content[f.perMember ? f.id + '@' + name : f.id];
  return !!(c && String(c.val).trim() !== '');
}
function calcProgress_(content, members) {
  const pages = {}; let tot = 0, done = 0;
  PAGES.forEach(function (pg) {
    let t = 0, d = 0;
    pg.sections.forEach(function (sc) {
      sc.fields.forEach(function (f) {
        if (!f.req) return;
        if (f.perMember) members.forEach(function (m) { t++; if (isFilled_(f, content, m['이름'])) d++; });
        else { t++; if (isFilled_(f, content)) d++; }
      });
    });
    pages[pg.id] = t ? Math.round(100 * d / t) : 100; tot += t; done += d;
  });
  return { pages: pages, total: tot ? Math.round(100 * done / tot) : 0 };
}

function reportUrl_(rid) {
  const base = settings_().siteUrl;
  return base && rid ? base.replace(/\/+$/, '') + '/report.html?id=' + rid : '';
}

/* ---- 팀ID ---- */
function teamId_(cls, no) { return 'C' + cls + '-' + no; }

/* ════════════════ 진입점과 기능 목록 ════════════════
 * auth: 'pub' 로그인 없이 / 's' 학생(조 로그인) / 'a' 관리자
 * 권한 판단은 모두 서버에서 한다. 화면에서 메뉴를 숨기는 것은 편의일 뿐이다.
 */
const ACTIONS = {
  schema:          { auth: 'pub', run: schema_ },
  login:           { auth: 'pub', run: login_ },
  adminLogin:      { auth: 'pub', run: adminLogin_ },
  getReport:       { auth: 'pub', run: getReport_ },
  // 학생
  loadProject:     { auth: 's', run: loadProject_ },
  pollProject:     { auth: 's', run: pollProject_ },
  saveFields:      { auth: 's', run: saveFields_ },
  uploadFile:      { auth: 's', run: uploadFile_ },
  submitProject:   { auth: 's', run: submitProject_ },
  // 관리자
  adminOverview:   { auth: 'a', run: adminOverview_ },
  importRoster:    { auth: 'a', run: importRoster_ },
  importIds:       { auth: 'a', run: importIds_ },
  setStudent:      { auth: 'a', run: setStudent_ },
  issuePasswords:  { auth: 'a', run: issuePasswords_ },
  reopenTeam:      { auth: 'a', run: reopenTeam_ },
  adminTeam:       { auth: 'a', run: adminTeam_ },
  saveTeamScore:   { auth: 'a', run: saveTeamScore_ },
  saveStudentScore: { auth: 'a', run: saveStudentScore_ },
  runVirtualAll:   { auth: 'a', run: runVirtualAll_ },
  importPeer:      { auth: 'a', run: importPeer_ },
  scoreTable:      { auth: 'a', run: scoreTable_ },
  saveSettings:    { auth: 'a', run: saveSettings_ },
};

function doGet() { return json_({ ok: true, message: 'API가 정상 동작 중입니다.', version: VERSION }); }

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const h = ACTIONS[req.action];
    if (!h) throw fail_('BAD_ACTION', '알 수 없는 요청입니다.');
    let auth = null;
    if (h.auth === 's') auth = verifyToken_(req.token, 's');
    else if (h.auth === 'a') auth = verifyToken_(req.token, 'a');
    return json_({ ok: true, data: h.run(req.payload || {}, auth) });
  } catch (err) {
    return json_({ ok: false, code: err.code || 'ERROR', message: err.message || String(err) });
  }
}

/* ════════════════ 3. 학생용 기능 ════════════════ */

function schema_() {
  return { version: VERSION, roles: ROLES, pages: PAGES, rubric: RUBRIC, elems: ELEMS, elemNames: ELEM_COL };
}

function login_(p) {
  const sid = String(p.sid || '').replace(/\D/g, ''), name = String(p.name || '').trim(), pw = String(p.pw || '').trim();
  if (!sid || !name || !pw) throw fail_('BAD_INPUT', '학번, 이름, 조 비밀번호를 모두 입력해 주세요.');
  if (failCount_('s' + sid) >= 5) throw fail_('LOCKED_OUT', '비밀번호를 여러 번 틀려서 10분 동안 로그인할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
  const generic = fail_('LOGIN_FAIL', '학번, 이름 또는 조 비밀번호가 올바르지 않습니다.');
  const stu = readAll_('students').filter(function (r) { return String(r['학번']) === sid && r['이름'] === name; })[0];
  if (!stu) { failAdd_('s' + sid); throw generic; }
  const team = teamById_(stu['팀ID']);
  if (!team['비번해시']) throw fail_('NO_PW', '아직 조 비밀번호가 발급되지 않았어요. 선생님께 문의해 주세요.');
  if (!safeEq_(hashPw_(pw, team['비번솔트']), team['비번해시'])) { failAdd_('s' + sid); log_(sid + ' ' + name, '로그인 실패', team['팀ID']); throw generic; }
  failClear_('s' + sid);
  log_(sid + ' ' + name, '로그인', team['팀ID']);
  const token = signToken_({ k: 's', tid: team['팀ID'], n: name, sid: sid, exp: Date.now() + SESSION_HOURS.s * 3600 * 1000 });
  return { token: token };
}

function presence_(tid, name, page, touch) {
  const cache = CacheService.getScriptCache(), key = 'pres_' + tid;
  let m = {};
  try { m = JSON.parse(cache.get(key) || '{}'); } catch (e) { m = {}; }
  const t = Date.now();
  if (touch) m[name] = { p: page || '', t: t };
  Object.keys(m).forEach(function (k) { if (t - m[k].t > 40000) delete m[k]; });
  if (touch) cache.put(key, JSON.stringify(m), 120);
  return Object.keys(m).map(function (k) { return { name: k, page: m[k].p }; });
}

function projectState_(auth) {
  const team = teamById_(auth.tid), members = membersOf_(auth.tid), content = contentOf_(auth.tid), files = filesOf_(auth.tid);
  const c = {};
  Object.keys(content).forEach(function (k) { c[k] = { val: content[k].val, v: content[k].v, by: content[k].by, at: content[k].at }; });
  const rev = Number(team['변경번호']) || 0;
  CacheService.getScriptCache().put('rev_' + auth.tid, String(rev), 21600);
  return {
    rev: rev, content: c, files: files, locked: team['상태'] === '제출완료',
    progress: calcProgress_(content, members),
    team: { cls: team['반'], no: team['조'], field: team['분야'], status: team['상태'], submitAt: team['제출일시'], submitBy: team['제출자'], reportId: team['보고서ID'], reportUrl: team['보고서ID'] ? reportUrl_(team['보고서ID']) : '' },
    members: members.map(function (m) { return { name: m['이름'], roles: rolesOf_(m) }; }),
  };
}

function loadProject_(p, auth) {
  const st = projectState_(auth);
  st.me = { name: auth.n, tid: auth.tid };
  st.presence = presence_(auth.tid, auth.n, p.page || 'home', true);
  return st;
}

function pollProject_(p, auth) {
  const pres = presence_(auth.tid, auth.n, p.page || '', true);
  const cache = CacheService.getScriptCache();
  let rev = cache.get('rev_' + auth.tid);
  if (rev === null) { rev = String(Number(teamById_(auth.tid)['변경번호']) || 0); cache.put('rev_' + auth.tid, rev, 21600); }
  if (Number(rev) === Number(p.rev)) return { changed: false, rev: Number(rev), presence: pres };
  const st = projectState_(auth);
  st.changed = true; st.presence = pres;
  return st;
}

/* ---- 항목 값 검사 ---- */
function cleanValue_(f, raw) {
  let v = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  if (f.type === 'file') throw fail_('BAD_FIELD', '파일은 업로드 버튼으로 올려 주세요.');
  if (f.type !== 'textarea') v = v.replace(/\n/g, ' ').trim();
  const max = f.type === 'textarea' ? 6000 : (f.type === 'url' ? 500 : 300);
  if (v.length > max) throw fail_('TOO_LONG', '"' + f.label.slice(0, 30) + '" 항목이 너무 깁니다. (최대 ' + max + '자)');
  if (f.type === 'select' && v && f.opts.indexOf(v) < 0) throw fail_('BAD_VALUE', '선택 항목이 올바르지 않습니다.');
  if (f.type === 'multiselect' && v && v.split('|').some(function (x) { return f.opts.indexOf(x) < 0; })) throw fail_('BAD_VALUE', '선택 항목이 올바르지 않습니다.');
  if (f.type === 'checkbox' && v !== '' && v !== 'Y') throw fail_('BAD_VALUE', '체크 값이 올바르지 않습니다.');
  if (f.type === 'number' && v !== '' && !/^-?\d+(\.\d+)?$/.test(v)) throw fail_('BAD_VALUE', '숫자만 입력해 주세요.');
  if (f.type === 'url' && v !== '' && !/^https?:\/\/\S+$/i.test(v)) throw fail_('BAD_VALUE', '주소는 http:// 또는 https:// 로 시작해야 해요.');
  return v;
}

function fieldOf_(id, auth) {
  const parts = String(id).split('@'), f = FIELD_INDEX[parts[0]];
  if (!f) throw fail_('BAD_FIELD', '알 수 없는 항목입니다.');
  if (f.perMember) { if (parts[1] !== auth.n) throw fail_('FORBIDDEN', '다른 조원의 칸은 수정할 수 없어요.'); }
  else if (parts.length > 1) throw fail_('BAD_FIELD', '알 수 없는 항목입니다.');
  return f;
}

/* 한 항목 저장: 다른 사람이 먼저 고쳤으면(버전이 다르면) 덮어쓰지 않고 충돌로 돌려준다 */
function applyField_(tid, content, id, val, baseV, who, at) {
  const cur = content[id], curV = cur ? cur.v : 0;
  if (cur && cur.val === val) return { status: 'same', v: curV };
  if (curV !== Number(baseV || 0)) return { status: 'conflict', theirs: { val: cur ? cur.val : '', v: curV, by: cur ? cur.by : '', at: cur ? cur.at : '' } };
  if (!cur && val === '') return { status: 'same', v: 0 };
  const nv = curV + 1;
  if (cur) { writeRow_('content', cur._row, { 값: val, 버전: nv, 수정자: who, 수정일시: at }); content[id] = { val: val, v: nv, by: who, at: at, _row: cur._row }; }
  else {
    appendObj_('content', { 키: tid + '|' + id, 팀ID: tid, 필드: id, 값: val, 버전: nv, 수정자: who, 수정일시: at });
    content[id] = { val: val, v: nv, by: who, at: at, _row: sheet_('content').getLastRow() };
  }
  return { status: 'saved', v: nv, delta: val.length - (cur ? cur.val.length : 0) };
}

/* 저장 뒤 조 정보 갱신(변경번호, 진행률). 같은 조원이 변경을 알아채는 신호가 된다 */
function commitTeam_(team, who, content, members) {
  const prog = calcProgress_(content, members), rev = (Number(team['변경번호']) || 0) + 1;
  writeRow_('teams', team._row, { 변경번호: rev, 마지막수정: now_(), 마지막수정자: who, 진행률: prog.total, 단계진행: JSON.stringify(prog.pages) });
  CacheService.getScriptCache().put('rev_' + team['팀ID'], String(rev), 21600);
  team['변경번호'] = rev;
  return { rev: rev, progress: prog };
}

function histo_(team, auth, page, fields, delta, kind) {
  appendObj_('history', { 일시: now_(), 팀ID: team['팀ID'], 반: team['반'], 조: team['조'], 학번: auth.sid, 이름: auth.n, 페이지: page, 필드: fields.join(','), 글자수변화: delta, 종류: kind });
}

function saveFields_(p, auth) {
  const entries = Object.keys(p.fields || {});
  if (!entries.length) return { saved: {}, conflicts: [] };
  if (entries.length > 40) throw fail_('BAD_INPUT', '한 번에 저장할 수 있는 항목 수를 넘었습니다.');
  const checked = entries.map(function (id) { const f = fieldOf_(id, auth); return { id: id, f: f, val: cleanValue_(f, p.fields[id].val), baseV: p.fields[id].baseV }; });
  return withLock_(function () {
    const team = teamById_(auth.tid);
    if (team['상태'] === '제출완료') throw fail_('LOCKED', '이미 제출되어 수정할 수 없어요. 고쳐야 한다면 선생님께 말씀드려 주세요.');
    const content = contentOf_(auth.tid), at = now_(), saved = {}, conflicts = [];
    let delta = 0; const changed = [];
    checked.forEach(function (c) {
      const r = applyField_(auth.tid, content, c.id, c.val, c.baseV, auth.n, at);
      if (r.status === 'conflict') conflicts.push({ id: c.id, theirs: r.theirs });
      else { saved[c.id] = { v: r.v, by: content[c.id] ? content[c.id].by : auth.n, at: content[c.id] ? content[c.id].at : at }; if (r.status === 'saved') { delta += r.delta; changed.push(c.id); } }
    });
    let rev = Number(team['변경번호']) || 0, progress = null;
    if (changed.length) {
      const c2 = commitTeam_(team, auth.n, content, membersOf_(auth.tid));
      rev = c2.rev; progress = c2.progress;
      histo_(team, auth, p.page || FIELD_INDEX[changed[0].split('@')[0]].page, changed, delta, '저장');
    }
    return { saved: saved, conflicts: conflicts, rev: rev, progress: progress };
  });
}

/* ---- 파일 올리기 (CSV·이미지·발표 자료) ---- */
const FILE_RULES = {
  csv: { re: /\.csv$/i, mime: 'text/csv', label: 'CSV' },
  img: { re: /\.(png|jpe?g|gif|webp)$/i, mime: null, label: '이미지(png, jpg, gif, webp)' },
  ppt: { re: /\.(pdf|pptx?)$/i, mime: null, label: 'PDF 또는 PPT' },
};
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv' };

function safeName_(s) { return String(s || 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80); }

function rootFolder_() {
  const P = PropertiesService.getScriptProperties();
  let id = P.getProperty('DRIVE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 아래에서 새로 만든다 */ } }
  const f = DriveApp.createFolder('사회문제해결프로젝트_제출파일');
  P.setProperty('DRIVE_FOLDER_ID', f.getId());
  return f;
}
function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function cleanMeta_(m) {
  if (!m || typeof m !== 'object') return {};
  const o = {};
  o.rows = Number(m.rows) || 0; o.cols = Number(m.cols) || 0;
  o.encoding = m.encoding === 'cp949' ? 'cp949' : 'utf-8';
  o.columns = (Array.isArray(m.columns) ? m.columns : []).slice(0, 60).map(function (x) { return String(x).slice(0, 40); });
  o.missing = {};
  Object.keys(m.missing || {}).slice(0, 60).forEach(function (k) { o.missing[String(k).slice(0, 40)] = Number(m.missing[k]) || 0; });
  o.sample = (Array.isArray(m.sample) ? m.sample : []).slice(0, 5).map(function (r) { return (Array.isArray(r) ? r : []).slice(0, 12).map(function (x) { return String(x).slice(0, 30); }); });
  return o;
}

function uploadFile_(p, auth) {
  const f = FIELD_INDEX[p.field];
  if (!f || f.type !== 'file') throw fail_('BAD_FIELD', '파일을 올릴 수 없는 항목입니다.');
  const rule = FILE_RULES[f.kind], name = safeName_(p.name);
  if (!rule.re.test(name)) throw fail_('BAD_FILE', rule.label + ' 파일만 올릴 수 있어요.');
  let bytes;
  try { bytes = Utilities.base64Decode(String(p.b64 || '')); } catch (e) { throw fail_('BAD_FILE', '파일을 읽을 수 없어요. 다시 시도해 주세요.'); }
  if (!bytes.length) throw fail_('BAD_FILE', '빈 파일입니다.');
  if (bytes.length > MAX_BYTES[f.kind]) throw fail_('TOO_BIG', '파일이 너무 커요. 최대 ' + Math.round(MAX_BYTES[f.kind] / 1048576) + 'MB 입니다.' + (f.kind === 'csv' ? ' 더 큰 파일은 원본 링크를 입력해 주세요.' : ''));
  const team0 = teamById_(auth.tid);
  if (team0['상태'] === '제출완료') throw fail_('LOCKED', '이미 제출되어 파일을 올릴 수 없어요.');

  const ext = name.split('.').pop().toLowerCase();
  const blob = Utilities.newBlob(bytes, MIME_BY_EXT[ext] || 'application/octet-stream', Date.now() + '_' + name);
  const folder = subFolder_(subFolder_(rootFolder_(), team0['반'] + '반'), team0['반'] + '반-' + team0['조'] + '조');
  const file = folder.createFile(blob);
  let shared = true;
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { shared = false; }   // 학교 계정 정책으로 막힐 수 있음
  const meta = f.kind === 'csv' ? cleanMeta_(p.meta) : {};
  meta.shared = shared;

  return withLock_(function () {
    const team = teamById_(auth.tid);
    if (team['상태'] === '제출완료') throw fail_('LOCKED', '이미 제출되어 파일을 올릴 수 없어요.');
    readAll_('files').forEach(function (r) { if (r['팀ID'] === auth.tid && r['필드'] === p.field && r['사용'] === 'Y') writeRow_('files', r._row, { 사용: 'N' }); });
    const at = now_();
    appendObj_('files', { 파일ID: file.getId(), 팀ID: auth.tid, 종류: f.kind, 필드: p.field, 파일명: name, 크기: bytes.length, 링크: 'https://drive.google.com/file/d/' + file.getId() + '/view', 메타: JSON.stringify(meta).slice(0, 8000), 업로더: auth.n, 일시: at, 사용: 'Y' });
    const content = contentOf_(auth.tid);
    const cur = content[p.field];
    applyField_(auth.tid, content, p.field, file.getId(), cur ? cur.v : 0, auth.n, at);
    const c2 = commitTeam_(team, auth.n, content, membersOf_(auth.tid));
    histo_(team, auth, f.page, [p.field], 0, '파일 업로드');
    return { file: fileInfo_(file.getId(), name, bytes.length, f.kind, meta, auth.n, at), version: content[p.field].v, rev: c2.rev, progress: c2.progress, shared: shared };
  });
}

/* ---- 제출 · 보고서 ---- */
function randId_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24); }

function memberLine_(members) { return members.map(function (m) { return m['이름'] + '(' + rolesOf_(m).join('·') + ')'; }).join(', '); }

function upsertSubmitRow_(team, members, content, files, who) {
  const hd = SH.submit.headers, row = {};
  row['제출일시'] = team['제출일시']; row['반'] = team['반']; row['조'] = team['조']; row['분야'] = team['분야'];
  row['조원(역할)'] = memberLine_(members); row['제출자'] = who; row['보고서링크'] = team['보고서링크'] || ''; row['진행률'] = team['진행률'] + '%';
  PAGES.forEach(function (pg) {
    pg.sections.forEach(function (sc) {
      sc.fields.forEach(function (f) {
        const key = f.id + ' | ' + f.label.slice(0, 40);
        let v = '';
        if (f.perMember) v = members.map(function (m) { const c = content[f.id + '@' + m['이름']]; return m['이름'] + ': ' + (c ? c.val : ''); }).join('\n');
        else if (f.type === 'file') v = files[f.id] ? files[f.id].view : '';
        else v = content[f.id] ? content[f.id].val : '';
        row[key] = String(v).slice(0, 45000);
      });
    });
  });
  const ex = readAll_('submit').filter(function (r) { return r['반'] === team['반'] && r['조'] === team['조']; })[0];
  if (ex) writeRow_('submit', ex._row, row); else appendObj_('submit', row);
}

function submitProject_(p, auth) {
  return withLock_(function () {
    const team = teamById_(auth.tid);
    if (team['상태'] === '제출완료') throw fail_('ALREADY', '이미 제출된 프로젝트입니다.');
    const members = membersOf_(auth.tid), content = contentOf_(auth.tid), files = filesOf_(auth.tid);
    const prog = calcProgress_(content, members), at = now_();
    const rid = team['보고서ID'] || randId_();
    const link = reportUrl_(rid);
    writeRow_('teams', team._row, { 상태: '제출완료', 제출일시: at, 제출자: auth.n, 보고서ID: rid, 보고서링크: link, 진행률: prog.total, 단계진행: JSON.stringify(prog.pages) });
    team['상태'] = '제출완료'; team['제출일시'] = at; team['보고서링크'] = link; team['진행률'] = prog.total;
    upsertSubmitRow_(team, members, content, files, auth.n);
    const c2 = commitTeam_(team, auth.n, content, members);
    histo_(team, auth, 'p6', ['submit'], 0, '제출');
    log_(auth.n, '제출', auth.tid);
    return { reportId: rid, reportUrl: link, submitAt: at, rev: c2.rev, progress: prog };
  });
}

function reportItem_(f, content, files, members) {
  if (f.perMember) return { id: f.id, label: f.label, type: 'member', values: members.map(function (m) { const c = content[f.id + '@' + m['이름']]; return { name: m['이름'], val: c ? c.val : '' }; }) };
  if (f.type === 'file') return { id: f.id, label: f.label, type: 'file', kind: f.kind, file: files[f.id] || null };
  const c = content[f.id]; let v = c ? c.val : '';
  if (f.type === 'multiselect') v = v.split('|').filter(Boolean).join(', ');
  if (f.type === 'checkbox') v = v === 'Y' ? '확인함' : '';
  return { id: f.id, label: f.label, type: f.type, val: v };
}

function buildReport_(team) {
  const tid = team['팀ID'], members = membersOf_(tid), content = contentOf_(tid), files = filesOf_(tid);
  return {
    cls: team['반'], no: team['조'], field: team['분야'], status: team['상태'], submitAt: team['제출일시'],
    members: members.map(function (m) { return { name: m['이름'], roles: rolesOf_(m) }; }),
    pages: PAGES.map(function (pg) {
      return { id: pg.id, no: pg.no, title: pg.title, sections: pg.sections.map(function (sc) { return { title: sc.title, items: sc.fields.map(function (f) { return reportItem_(f, content, files, members); }) }; }) };
    }),
    progress: calcProgress_(content, members).total,
  };
}

function getReport_(p) {
  const id = String(p.id || '');
  if (id.length < 16) throw fail_('NOT_FOUND', '보고서를 찾을 수 없습니다.');
  const team = readAll_('teams').filter(function (r) { return r['보고서ID'] === id; })[0];
  if (!team) throw fail_('NOT_FOUND', '보고서를 찾을 수 없습니다. (제출한 적이 있는 보고서만 볼 수 있어요)');
  return buildReport_(team);   // 수정 허용으로 다시 열린 경우에도 링크는 유지되고, 화면에 '수정 중'으로 표시된다
}

/* ════════════════ 4. 가상 채점 ════════════════
 * 학생이 쓴 내용이 평가 기준의 '형식·완성도' 조건을 얼마나 갖췄는지 규칙으로 점검해 점수를 '제안'한다.
 * 내용이 타당한지, 해석이 정확한지는 판단하지 못한다. 최종 점수는 항상 교사가 정한다.
 * 기준을 바꾸고 싶으면 아래 VS_TABLE(점수 구간)과 각 항목의 min(권장 글자 수, 위 PAGES)을 고친다.
 */
const VS_TABLE = {
  E2: [[7, 20], [5, 16], [3, 12], [0, 8]],   // 충족한 점검 개수 → 제안 점수
  E3: [[5, 20], [4, 16], [3, 12], [0, 8]],
  E4: [[7, 20], [5, 16], [3, 12], [0, 8]],
};
const VS_RULE_TEXT = {
  E1: '점검 5개를 모두 충족하면 20점. SDGs 선택·문제/필요성 서술이 충족되고 5단계 계획 중 3단계 이상 작성했으면 14점. 그 외 8점.',
  E2: '점검 7개 중 7개 충족 20점 / 5~6개 16점 / 3~4개 12점 / 2개 이하 8점.',
  E3: '점검 5개 중 5개 충족 20점 / 4개 16점 / 3개 12점 / 2개 이하 8점. 문제 유형과 모델이 맞지 않으면 8점(교사 확인 필요).',
  E4: '점검 8개 중 7개 이상 20점 / 5~6개 16점 / 3~4개 12점 / 2개 이하 8점. 평가에 훈련 데이터만 썼다고 답하면 8점.',
};
const METRIC_FIT = { 분류: ['정확도(accuracy)', '정밀도', '재현율', '혼동 행렬', '기타'], 회귀: ['결정계수(R²)', '평균 절대 오차(MAE)', '평균 제곱 오차(MSE)', '기타'] };

function ck_(id, label, pass, detail) { return { id: id, label: label, pass: !!pass, detail: detail }; }
function byCount_(table, n) { for (let i = 0; i < table.length; i++) if (n >= table[i][0]) return table[i][1]; return table[table.length - 1][1]; }

function virtualScore_(content, files) {
  const g = function (id) { return content[id] ? String(content[id].val) : ''; };
  const n = function (id) { return g(id).replace(/\s+/g, '').length; };
  const mn = function (id) { return FIELD_INDEX[id].min || 1; };
  const ok = function (id) { return n(id) >= mn(id); };
  const d = function (id) { return n(id) + '자(기준 ' + mn(id) + '자 이상)'; };
  const hasFile = function (id) { return !!files[id]; };
  const out = {};

  // E1 기획안
  const stages = ['plan_s1', 'plan_s2', 'plan_s3', 'plan_s4', 'plan_s5'].filter(ok).length;
  const c1 = [
    ck_('a1', 'SDGs를 선택함', !!g('sdg'), g('sdg') || '선택하지 않음'),
    ck_('a2', '사회문제와 해결 필요성을 충분히 서술함', ok('problem') && ok('need'), '문제 ' + d('problem') + ', 필요성 ' + d('need')),
    ck_('a3', 'SDGs 연결 이유와 인공지능 활용 목표를 서술함', ok('sdg_why') && ok('goal'), '연결 이유 ' + d('sdg_why') + ', 목표 ' + d('goal')),
    ck_('a4', '5단계 수행 계획을 모두 작성함', stages === 5, stages + '/5 단계 작성'),
    ck_('a5', '역할 분담과 협업 방법을 구체적으로 작성함', ok('plan_roles') && ok('plan_collab'), '역할 ' + d('plan_roles') + ', 협업 ' + d('plan_collab')),
  ];
  const all1 = c1.every(function (c) { return c.pass; });
  out.E1 = { checks: c1, flags: [], score: all1 ? 20 : (c1[0].pass && c1[1].pass && stages >= 3 ? 14 : 8) };

  // E2 데이터 수집·전처리
  const hasData = hasFile('data_file') || g('data_link') !== '';
  const c2 = [
    ck_('b1', '데이터 출처와 신뢰 근거를 적음', g('data_source') !== '' && ok('data_reliable'), '출처 ' + (g('data_source') ? '입력함' : '없음') + ', 근거 ' + d('data_reliable')),
    ck_('b2', '데이터를 올리고(또는 링크) 구조를 설명하며 개인정보 없음을 확인함', hasData && ok('data_desc') && g('data_privacy') === 'Y', '데이터 ' + (hasData ? '있음' : '없음') + ', 설명 ' + d('data_desc') + ', 개인정보 확인 ' + (g('data_privacy') === 'Y' ? '체크' : '미체크')),
    ck_('b3', '결측치 처리 과정을 기록함', ok('missing_handle'), d('missing_handle')),
    ck_('b4', '이상치 확인·처리 과정을 기록함', ok('outlier_handle'), d('outlier_handle')),
    ck_('b5', '독립·종속 변수를 정하고 이유를 적음', g('features') !== '' && g('target') !== '' && ok('var_why'), '독립 ' + (g('features') ? '입력' : '없음') + ', 종속 ' + (g('target') ? '입력' : '없음') + ', 이유 ' + d('var_why')),
    ck_('b6', '훈련/테스트 분할 비율을 적음', g('split_ratio') !== '', g('split_ratio') || '입력하지 않음'),
    ck_('b7', '정규화·변환을 선택하고 이유를 적음', g('scaling') !== '' && ok('scaling_why'), (g('scaling') || '선택 안 함') + ', 이유 ' + d('scaling_why')),
  ];
  const f2 = [];
  if (g('target') && g('features') && g('features').indexOf(g('target')) >= 0) f2.push('독립 변수에 종속 변수(' + g('target') + ')가 포함되어 있을 수 있어요. 확인하세요.');
  const rb = Number(g('rows_before')), ra = Number(g('rows_after'));
  if (g('rows_before') && g('rows_after') && ra > rb) f2.push('처리 후 행 개수가 처리 전보다 많아요.');
  const fm = files['data_file'] && files['data_file'].meta && files['data_file'].meta.missing;
  if (fm && Object.keys(fm).some(function (k) { return fm[k] > 0; }) && n('missing_handle') === 0) f2.push('올린 CSV에 결측치가 있는데 처리 기록이 없어요.');
  out.E2 = { checks: c2, flags: f2, score: byCount_(VS_TABLE.E2, c2.filter(function (c) { return c.pass; }).length) };

  // E3 모델 생성·학습
  const algos = g('algos').split('|').filter(Boolean), mt = g('ml_type');
  const fits = !mt || !algos.length || algos.some(function (a) { return (ALGO_TYPES[a] || []).indexOf(mt) >= 0; });
  const c3 = [
    ck_('c1', '문제 유형을 판단하고 이유를 적음', mt !== '' && ok('ml_type_why'), (mt || '선택 안 함') + ', 이유 ' + d('ml_type_why')),
    ck_('c2', '모델을 선택하고 이유를 적음', algos.length > 0 && ok('algo_why'), (algos.join(', ') || '선택 안 함') + ', 이유 ' + d('algo_why')),
    ck_('c3', '모델을 만든 증거(코랩 링크 또는 코드 캡처)가 있음', g('colab_link') !== '' || hasFile('code_img'), '코랩 링크 ' + (g('colab_link') ? '있음' : '없음') + ', 코드 캡처 ' + (hasFile('code_img') ? '있음' : '없음')),
    ck_('c4', '학습 결과를 확인하고 설명함', ok('train_result'), d('train_result')),
    ck_('c5', '주요 설정값과 이유를 적음', ok('params'), d('params')),
  ];
  const f3 = [];
  if (!fits) f3.push('문제 유형(' + mt + ')과 선택한 모델(' + algos.join(', ') + ')이 맞지 않아 보여요. 교사 확인이 필요해요.');
  out.E3 = { checks: c3, flags: f3, score: !fits ? 8 : byCount_(VS_TABLE.E3, c3.filter(function (c) { return c.pass; }).length) };

  // E4 모델 평가
  const ed = g('eval_data'), mets = g('metrics').split('|').filter(Boolean);
  const metFit = !mt || !METRIC_FIT[mt] || mets.some(function (m) { return METRIC_FIT[mt].indexOf(m) >= 0; });
  const c4 = [
    ck_('d1', '학습에 쓰지 않은 테스트 데이터로 평가함', ed === '테스트 데이터' || ed === '둘 다', ed || '선택 안 함'),
    ck_('d2', '문제 유형에 맞는 평가 지표와 수치를 제시함', mets.length > 0 && g('metric_value') !== '' && metFit, (mets.join(', ') || '선택 안 함') + (g('metric_value') ? ', 수치 입력함' : ', 수치 없음') + (metFit ? '' : ' (문제 유형과 지표가 맞지 않아 보임)')),
    ck_('d3', '그래프·혼동 행렬 등 시각화 결과를 첨부함', hasFile('eval_img'), hasFile('eval_img') ? '첨부함' : '첨부하지 않음'),
    ck_('d4', '결과를 근거로 성능을 해석함', ok('interp'), d('interp')),
    ck_('d5', '오차의 원인과 한계를 분석함', ok('error_cause') && ok('model_limit'), '원인 ' + d('error_cause') + ', 한계 ' + d('model_limit')),
    ck_('d6', '개선 방향을 구체적으로 제안함', ok('improve_dir'), d('improve_dir')),
    ck_('d7', '성능 개선 시도와 결과를 기록함', ok('improve_try'), d('improve_try')),
    ck_('d8', '사회적 영향(AI 윤리)을 반영한 개선 방안을 제시함', ok('eth_improve'), d('eth_improve')),
  ];
  const f4 = [];
  if (ed === '훈련 데이터') f4.push('평가를 훈련 데이터로만 했다고 답했어요. (평가 기준: 8점 수준)');
  out.E4 = { checks: c4, flags: f4, score: ed === '훈련 데이터' ? 8 : byCount_(VS_TABLE.E4, c4.filter(function (c) { return c.pass; }).length) };

  ELEMS.forEach(function (e) {
    const o = out[e], pass = o.checks.filter(function (c) { return c.pass; }).length;
    o.max = RUBRIC[e].max; o.passCount = pass; o.total = o.checks.length; o.rule = VS_RULE_TEXT[e];
  });
  return out;
}

function runVirtualAll_() {
  const teams = readAll_('teams'), contents = {}, filesBy = {}, at = now_(), rows = [];
  readAll_('content').forEach(function (r) { (contents[r['팀ID']] = contents[r['팀ID']] || {})[r['필드']] = { val: String(r['값']), v: Number(r['버전']) || 0 }; });
  readAll_('files').forEach(function (r) { if (r['사용'] === 'Y') { (filesBy[r['팀ID']] = filesBy[r['팀ID']] || {})[r['필드']] = { name: r['파일명'], meta: (function () { try { return JSON.parse(r['메타'] || '{}'); } catch (e) { return {}; } })() }; } });
  teams.forEach(function (t) {
    const vs = virtualScore_(contents[t['팀ID']] || {}, filesBy[t['팀ID']] || {});
    ELEMS.forEach(function (e) {
      const o = vs[e];
      rows.push({
        실행일시: at, 팀ID: t['팀ID'], 반: t['반'], 조: t['조'], 평가요소: RUBRIC[e].name, 제안점수: o.score,
        '충족한 점검': o.checks.filter(function (c) { return c.pass; }).map(function (c) { return c.label; }).join(' / '),
        '미충족 점검': o.checks.filter(function (c) { return !c.pass; }).map(function (c) { return c.label; }).join(' / '),
        '상세 근거': o.checks.map(function (c) { return (c.pass ? '✓ ' : '✗ ') + c.label + ' — ' + c.detail; }).join('\n') + (o.flags.length ? '\n⚠ ' + o.flags.join('\n⚠ ') : ''),
      });
    });
  });
  rewrite_('virtual', rows);
  return { teams: teams.length, at: at };
}

/* ════════════════ 5. 관리자 기능 ════════════════ */

function adminLogin_(p) {
  const pw = prop_('ADMIN_PASSWORD');
  if (!pw) throw fail_('NO_ADMIN_PW', 'ADMIN_PASSWORD 스크립트 속성이 아직 설정되지 않았습니다. README의 3단계를 확인하세요.');
  if (failCount_('admin') >= 5) throw fail_('LOCKED_OUT', '비밀번호를 여러 번 틀려서 10분 동안 로그인할 수 없어요.');
  if (!safeEq_(String(p.pw || ''), pw)) { failAdd_('admin'); log_('관리자', '로그인 실패', ''); throw fail_('LOGIN_FAIL', '비밀번호가 올바르지 않습니다.'); }
  failClear_('admin');
  log_('관리자', '로그인', '');
  return { token: signToken_({ k: 'a', exp: Date.now() + SESSION_HOURS.a * 3600 * 1000 }) };
}

function sortTeams_(a, b) { return (Number(a['반']) - Number(b['반'])) || (Number(a['조']) - Number(b['조'])); }

function adminOverview_(p) {
  let st = settings_();
  if (p.siteUrl && !st.siteUrl && /^https?:\/\/\S+$/i.test(p.siteUrl)) { setSetting_('siteUrl', String(p.siteUrl).replace(/\/+$/, '')); st = settings_(); }
  const students = readAll_('students'), scored = {};
  readAll_('tscore').forEach(function (r) { if (ELEMS.some(function (e) { return r[ELEM_COL[e]] !== ''; })) scored[r['팀ID']] = true; });
  const teams = readAll_('teams').sort(sortTeams_).map(function (t) {
    const ms = students.filter(function (s) { return s['팀ID'] === t['팀ID']; });
    let pages = {}; try { pages = JSON.parse(t['단계진행'] || '{}'); } catch (e) { pages = {}; }
    return {
      tid: t['팀ID'], cls: t['반'], no: t['조'], field: t['분야'], status: t['상태'], progress: Number(t['진행률']) || 0, pages: pages,
      lastEdit: t['마지막수정'], lastBy: t['마지막수정자'], submitAt: t['제출일시'], hasPw: !!t['비번해시'],
      nStudents: ms.length, noSid: ms.filter(function (s) { return String(s['학번']) === ''; }).length,
      reportUrl: t['보고서ID'] ? reportUrl_(t['보고서ID']) : '', reportId: t['보고서ID'], scored: !!scored[t['팀ID']],
    };
  });
  return { settings: st, teams: teams, pages: PAGES.map(function (pg) { return { id: pg.id, no: pg.no, title: pg.title }; }), version: VERSION };
}

/* ---- 명단 올리기 ---- */
function normRoles_(arr) {
  const out = [];
  (arr || []).forEach(function (r) { if (ROLES.indexOf(r) >= 0 && out.indexOf(r) < 0) out.push(r); });
  return out;
}

function importRoster_(p) {
  const clsN = parseInt(p.cls, 10);
  if (!(clsN >= 1 && clsN <= 99)) throw fail_('BAD_INPUT', '반 번호를 올바르게 입력해 주세요.');
  const cls = String(clsN), input = Array.isArray(p.teams) ? p.teams : [];
  if (!input.length || input.length > 40) throw fail_('BAD_INPUT', '조 정보가 없거나 너무 많습니다.');
  return withLock_(function () {
    const teams = readAll_('teams'), at = now_(), res = { created: 0, updated: 0, students: 0, warnings: [] };
    let stud = readAll_('students');
    input.forEach(function (t) {
      const noN = parseInt(t.no, 10);
      if (!(noN >= 1)) return;
      const no = String(noN), tid = teamId_(cls, no), map = {}, order = [];
      (t.members || []).forEach(function (m) {
        const nm = String(m.name || '').trim().slice(0, 20);
        if (!nm) return;
        if (!map[nm]) { map[nm] = []; order.push(nm); }
        normRoles_(m.roles).forEach(function (r) { if (map[nm].indexOf(r) < 0) map[nm].push(r); });
      });
      if (order.length < 3 || order.length > 5) res.warnings.push(cls + '반 ' + no + '조: 인원이 ' + order.length + '명입니다.');
      ROLES.forEach(function (r) { if (!order.some(function (nm) { return map[nm].indexOf(r) >= 0; })) res.warnings.push(cls + '반 ' + no + '조: "' + r + '" 담당이 비어 있습니다.'); });
      const ex = teams.filter(function (r) { return r['팀ID'] === tid; })[0], field = String(t.field || '').slice(0, 40);
      if (ex) { writeRow_('teams', ex._row, { 분야: field }); res.updated++; }
      else { appendObj_('teams', { 팀ID: tid, 반: cls, 조: no, 분야: field, 상태: '작성중', 변경번호: 0, 진행률: 0, 생성일시: at }); res.created++; }
      const old = {};
      stud.filter(function (r) { return r['팀ID'] === tid; }).forEach(function (r) { old[r['이름']] = r; });
      stud = stud.filter(function (r) { return r['팀ID'] !== tid; });
      order.forEach(function (nm) { const o = old[nm]; stud.push({ 팀ID: tid, 반: cls, 조: no, 학번: o ? o['학번'] : '', 이름: nm, 역할: map[nm].join(','), 결석: o ? o['결석'] : '', 메모: o ? o['메모'] : '' }); });
      Object.keys(old).forEach(function (nm) { if (!map[nm]) res.warnings.push(cls + '반 ' + no + '조: ' + nm + ' 학생이 이번 명단에 없어 조원에서 제외되었습니다.'); });
      res.students += order.length;
    });
    rewrite_('students', stud);
    log_('관리자', '역할표 업로드', cls + '반 조 ' + (res.created + res.updated) + '개');
    return res;
  });
}

function importIds_(p) {
  const clsN = parseInt(p.cls, 10), rows = Array.isArray(p.rows) ? p.rows : [];
  if (!(clsN >= 1 && clsN <= 99)) throw fail_('BAD_INPUT', '반 번호를 올바르게 입력해 주세요.');
  if (!rows.length || rows.length > 500) throw fail_('BAD_INPUT', '학번 명부가 비어 있거나 너무 큽니다.');
  const cls = String(clsN);
  return withLock_(function () {
    const stud = readAll_('students'), res = { matched: 0, unmatched: [], ambiguous: [], warnings: [], missing: [] };
    const byName = {};
    stud.filter(function (s) { return s['반'] === cls; }).forEach(function (s) { (byName[s['이름']] = byName[s['이름']] || []).push(s); });
    rows.forEach(function (r) {
      const sid = String(r.sid || '').replace(/\D/g, ''), nm = String(r.name || '').trim();
      if (!sid || !nm) return;
      const hit = byName[nm];
      if (!hit) { res.unmatched.push(nm + '(' + sid + ')'); return; }
      if (hit.length > 1) { res.ambiguous.push(nm + '(' + sid + ')'); return; }
      if (sid.length === 5 && Number(sid.slice(1, 3)) !== clsN) res.warnings.push(nm + ': 학번 ' + sid + '의 반 자리가 ' + cls + '반과 달라요.');
      hit[0]['학번'] = sid; res.matched++;
    });
    const seen = {};
    stud.forEach(function (s) { const k = String(s['학번']); if (k) { if (seen[k]) res.warnings.push('학번 ' + k + '이(가) 중복됩니다: ' + seen[k] + ', ' + s['이름']); else seen[k] = s['이름']; } });
    stud.filter(function (s) { return s['반'] === cls && String(s['학번']) === ''; }).forEach(function (s) { res.missing.push(s['조'] + '조 ' + s['이름']); });
    rewrite_('students', stud);
    log_('관리자', '학번 명부 업로드', cls + '반 ' + res.matched + '명 일치');
    return res;
  });
}

function setStudent_(p) {
  return withLock_(function () {
    const stud = readAll_('students'), s = stud.filter(function (x) { return x['팀ID'] === p.tid && x['이름'] === p.name; })[0];
    if (!s) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    const upd = {};
    if (p.sid !== undefined) {
      const sid = String(p.sid).replace(/\D/g, '');
      if (sid && (sid.length < 3 || sid.length > 10)) throw fail_('BAD_INPUT', '학번은 숫자 3~10자리로 입력해 주세요.');
      if (sid && stud.some(function (x) { return String(x['학번']) === sid && x !== s; })) throw fail_('DUP', '이미 다른 학생에게 등록된 학번입니다.');
      upd['학번'] = sid;
    }
    if (p.memo !== undefined) upd['메모'] = String(p.memo).slice(0, 200);
    writeRow_('students', s._row, upd);
    return { ok: true };
  });
}

function issuePasswords_(p) {
  return withLock_(function () {
    const teams = readAll_('teams').sort(sortTeams_), students = readAll_('students'), out = [];
    const pick = Array.isArray(p.tids) && p.tids.length ? p.tids : null;
    teams.forEach(function (t) {
      if (pick ? pick.indexOf(t['팀ID']) < 0 : (p.scope !== 'all' && t['비번해시'])) return;
      const pw = genPw_(), salt = Utilities.getUuid().slice(0, 8);
      writeRow_('teams', t._row, { 비번솔트: salt, 비번해시: hashPw_(pw, salt) });
      out.push({ tid: t['팀ID'], cls: t['반'], no: t['조'], field: t['분야'], pw: pw, members: students.filter(function (s) { return s['팀ID'] === t['팀ID']; }).map(function (s) { return s['이름']; }) });
    });
    log_('관리자', '비밀번호 발급', out.length + '개 조');
    return { list: out };
  });
}

function reopenTeam_(p) {
  return withLock_(function () {
    const team = teamById_(p.tid);
    writeRow_('teams', team._row, { 상태: '작성중' });
    commitTeam_(team, '관리자', contentOf_(p.tid), membersOf_(p.tid));
    log_('관리자', '제출 취소(수정 허용)', p.tid);
    return { ok: true };
  });
}

/* ---- 채점 ---- */
function allowed_(e) { return RUBRIC[e].levels.map(function (l) { return l.score; }); }

function effective_(ss, tsc, base) {
  const out = { absent: !!(ss && String(ss['결석']) === 'Y'), E: {}, adj: {}, total: null, complete: false, adjusted: false, peer: null };
  if (out.absent) { out.total = base; out.complete = true; return out; }
  let sum = 0, missing = false;
  ELEMS.forEach(function (e) {
    const a = ss ? ss['조정_' + ELEM_COL[e]] : '', hasAdj = a !== '' && a !== null && a !== undefined;
    const team = tsc[e].score, v = hasAdj ? Number(a) : team;
    out.adj[e] = hasAdj ? Number(a) : null;
    if (v === null || v === undefined || isNaN(v)) { missing = true; out.E[e] = null; } else { out.E[e] = v; sum += v; }
    if (hasAdj && Number(a) !== team) out.adjusted = true;
  });
  const peer = ss && ss['동료환산'] !== '' && ss['동료환산'] !== undefined ? Number(ss['동료환산']) : null;
  if (peer !== null && !isNaN(peer)) { sum += peer; out.peer = peer; } else missing = true;
  out.total = sum; out.complete = !missing;
  return out;
}

function teamScores_() {
  const m = {};
  readAll_('tscore').forEach(function (r) {
    const o = {};
    ELEMS.forEach(function (e) { const v = r[ELEM_COL[e]]; o[e] = { score: v === '' || v === null ? null : Number(v), reason: r[ELEM_COL[e] + '_사유'] || '' }; });
    o._row = r._row; m[r['팀ID']] = o;
  });
  return m;
}
function emptyTsc_() { const o = {}; ELEMS.forEach(function (e) { o[e] = { score: null, reason: '' }; }); return o; }

function refreshView_() {
  const tmap = teamScores_(), base = baseScore_(), teams = {}, ss = {};
  readAll_('teams').forEach(function (t) { teams[t['팀ID']] = t; });
  readAll_('sscore').forEach(function (r) { ss[r['팀ID'] + '|' + r['이름']] = r; });
  const stud = readAll_('students').sort(function (a, b) { return (Number(a['반']) - Number(b['반'])) || (Number(a['조']) - Number(b['조'])); });
  const rows = stud.map(function (s) {
    const s2 = ss[s['팀ID'] + '|' + s['이름']] || null, eff = effective_(s2, tmap[s['팀ID']] || emptyTsc_(), base);
    return {
      반: s['반'], 조: s['조'], 분야: teams[s['팀ID']] ? teams[s['팀ID']]['분야'] : '', 학번: s['학번'], 이름: s['이름'], 역할: s['역할'], 결석: eff.absent ? 'Y' : '',
      '기획안(20)': eff.E.E1 == null ? '' : eff.E.E1, '전처리(20)': eff.E.E2 == null ? '' : eff.E.E2, '모델생성(20)': eff.E.E3 == null ? '' : eff.E.E3, '모델평가(20)': eff.E.E4 == null ? '' : eff.E.E4,
      '동료평가 원점수': s2 ? s2['동료원점수'] : '', '동료평가 환산(20)': eff.peer == null ? '' : eff.peer,
      합계: eff.total == null ? '' : eff.total, 개인조정: eff.adjusted ? 'Y' : '', '조정 사유': s2 ? s2['조정사유'] : '',
      상태: eff.absent ? '결석(기본점수)' : (eff.complete ? '완료' : '채점 중'),
    };
  });
  rewrite_('view', rows);
  return rows;
}

function scoreTable_() { return { headers: SH.view.headers, rows: refreshView_() }; }

const SETEUK_FLAGS = [/[가-힣A-Za-z0-9]*(?:대학교|대학|학원|재단|연구원|연구소|협회|병원|주식회사|\(주\)|㈜)/g, /[가-힣]*(?:초등학교|중학교|고등학교)/g];

function flagWords_(text, school) {
  const set = {};
  SETEUK_FLAGS.forEach(function (re) { (String(text).match(re) || []).forEach(function (w) { set[w] = 1; }); });
  if (school && String(text).indexOf(school) >= 0) set[school] = 1;
  return Object.keys(set).slice(0, 10);
}

function adminTeam_(p) {
  const team = teamById_(p.tid), tid = team['팀ID'], members = membersOf_(tid), content = contentOf_(tid), files = filesOf_(tid);
  const base = baseScore_(), st = settings_(), tmap = teamScores_(), tsc = tmap[tid] || emptyTsc_();
  const ssMap = {}; readAll_('sscore').forEach(function (r) { if (r['팀ID'] === tid) ssMap[r['이름']] = r; });
  const stats = {};
  readAll_('history').forEach(function (h) {
    if (h['팀ID'] !== tid) return;
    const s = stats[h['이름']] = stats[h['이름']] || { saves: 0, chars: 0, pages: {}, last: '' };
    s.saves++; s.chars += Math.max(0, Number(h['글자수변화']) || 0); s.pages[h['페이지']] = (s.pages[h['페이지']] || 0) + 1; s.last = h['일시'];
  });
  const vs = virtualScore_(content, files), fv = function (id) { return content[id] ? String(content[id].val) : ''; };
  const sdgShort = fv('sdg').replace(/^\d+\.\s*/, '');
  const facts = { sdg: sdgShort, mlType: fv('ml_type'), algos: fv('algos').split('|').filter(Boolean).join(', '), metric: fv('metric_value') };
  const out = members.map(function (m) {
    const nm = m['이름'], ss = ssMap[nm] || null, eff = effective_(ss, tsc, base), s = stats[nm] || { saves: 0, chars: 0, pages: {}, last: '' };
    const doTxt = fv('contrib_do@' + nm), learnTxt = fv('contrib_learn@' + nm);
    return {
      name: nm, sid: m['학번'], roles: rolesOf_(m), memo: m['메모'], absent: eff.absent,
      adj: eff.adj, adjReason: ss ? ss['조정사유'] : '', peerRaw: ss ? ss['동료원점수'] : '', peerN: ss ? ss['동료응답수'] : '', peerScaled: ss && ss['동료환산'] !== '' ? Number(ss['동료환산']) : null,
      eff: { E: eff.E, total: eff.total, complete: eff.complete, adjusted: eff.adjusted },
      stat: s, contribDo: doTxt, contribLearn: learnTxt,
      material: {
        facts: facts, flags: flagWords_(doTxt + ' ' + learnTxt + ' ' + facts.metric, st.schoolName),
        skeleton: (facts.sdg ? facts.sdg + ' 관련 ' : '') + '사회문제 해결을 주제로 한 모둠 프로젝트에서 ' + rolesOf_(m).join('·') + '을(를) 맡아 ' + (facts.mlType ? facts.mlType + ' 문제로 정의하고 ' : '') + (facts.algos ? facts.algos + ' 모델을 구현·평가하는 ' : '') + '과정에 참여함. (여기에 교사가 관찰한 이 학생의 구체적 기여와 변화·성장을 직접 서술)',
      },
    };
  });
  const fieldsList = [];
  PAGES.forEach(function (pg) { pg.sections.forEach(function (sc) { sc.fields.forEach(function (f) {
    if (f.perMember) return;
    if (f.type === 'file') fieldsList.push({ id: f.id, page: pg.no, label: f.label, type: 'file', file: files[f.id] || null });
    else fieldsList.push({ id: f.id, page: pg.no, label: f.label, type: f.type, val: fv(f.id), min: f.min || 0 });
  }); }); });
  const online = ELEMS.reduce(function (a, e) { a[e] = tsc[e]; return a; }, {});
  return {
    team: { tid: tid, cls: team['반'], no: team['조'], field: team['분야'], status: team['상태'], submitAt: team['제출일시'], submitBy: team['제출자'], progress: Number(team['진행률']) || 0, reportUrl: team['보고서ID'] ? reportUrl_(team['보고서ID']) : '', reportId: team['보고서ID'] },
    members: out, teamScore: online, virtual: vs, fields: fieldsList, base: base,
    peerNote: '동료평가 환산 점수는 평가 기준이 정해지면 입력하세요(0~20).',
  };
}

function saveTeamScore_(p) {
  return withLock_(function () {
    const team = teamById_(p.tid);
    const row = readAll_('tscore').filter(function (r) { return r['팀ID'] === p.tid; })[0];
    const upd = { 채점일시: now_() };
    ELEMS.forEach(function (e) {
      const x = (p.scores || {})[e]; if (!x) return;
      let v = x.score;
      if (v === null || v === '' || v === undefined) v = '';
      else { v = Number(v); if (allowed_(e).indexOf(v) < 0) throw fail_('BAD_SCORE', RUBRIC[e].name + ': 허용되는 점수(' + allowed_(e).join('/') + ')가 아닙니다.'); }
      upd[ELEM_COL[e]] = v; upd[ELEM_COL[e] + '_사유'] = String(x.reason || '').slice(0, 500);
    });
    if (row) writeRow_('tscore', row._row, upd);
    else appendObj_('tscore', Object.assign({ 팀ID: p.tid, 반: team['반'], 조: team['조'] }, upd));
    refreshView_();
    log_('관리자', '조 채점', p.tid);
    return { ok: true };
  });
}

function saveStudentScore_(p) {
  return withLock_(function () {
    const team = teamById_(p.tid), stu = membersOf_(p.tid).filter(function (m) { return m['이름'] === p.name; })[0];
    if (!stu) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    const upd = { 결석: p.absent ? 'Y' : '', 수정일시: now_() };
    let anyAdj = false;
    ELEMS.forEach(function (e) {
      let v = (p.adj || {})[e];
      if (v === null || v === '' || v === undefined) v = '';
      else { v = Number(v); if (allowed_(e).indexOf(v) < 0) throw fail_('BAD_SCORE', RUBRIC[e].name + ': 허용되는 점수(' + allowed_(e).join('/') + ')가 아닙니다.'); anyAdj = true; }
      upd['조정_' + ELEM_COL[e]] = v;
    });
    const reason = String(p.reason || '').trim().slice(0, 500);
    if (anyAdj && !reason) throw fail_('NEED_REASON', '개인 조정을 입력하면 조정 사유를 꼭 적어야 해요.');
    upd['조정사유'] = reason;
    if (p.peerScaled === null || p.peerScaled === '' || p.peerScaled === undefined) upd['동료환산'] = '';
    else { const pv = Number(p.peerScaled); if (isNaN(pv) || pv < 0 || pv > 20) throw fail_('BAD_SCORE', '동료평가 환산 점수는 0~20 사이로 입력해 주세요.'); upd['동료환산'] = pv; }
    const row = readAll_('sscore').filter(function (r) { return r['팀ID'] === p.tid && r['이름'] === p.name; })[0];
    if (row) writeRow_('sscore', row._row, upd);
    else appendObj_('sscore', Object.assign({ 팀ID: p.tid, 이름: p.name, 학번: stu['학번'] }, upd));
    writeRow_('students', stu._row, { 결석: p.absent ? 'Y' : '' });
    refreshView_();
    log_('관리자', '개인 채점', p.tid + ' ' + p.name);
    return { ok: true, team: team['팀ID'] };
  });
}

function saveSettings_(p) {
  return withLock_(function () {
    const st = settings_();
    if (p.schoolName !== undefined) setSetting_('schoolName', String(p.schoolName).slice(0, 40));
    if (p.baseScore !== undefined) { const b = Number(p.baseScore); if (isNaN(b) || b < 0 || b > 100) throw fail_('BAD_INPUT', '기본 점수는 0~100 사이 숫자로 입력해 주세요.'); setSetting_('baseScore', String(b)); }
    if (p.siteUrl !== undefined) {
      const u = String(p.siteUrl).trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/\S+$/.test(u)) throw fail_('BAD_INPUT', '사이트 주소는 https:// 로 시작해야 해요.');
      setSetting_('siteUrl', u);
      if (u !== st.siteUrl) readAll_('teams').forEach(function (t) { if (t['보고서ID']) writeRow_('teams', t._row, { 보고서링크: reportUrl_(t['보고서ID']) }); });
    }
    refreshView_();
    return { settings: settings_() };
  });
}

/* ---- 동료평가 파일 가져오기 ----
 * 화면에서 열을 골라 보낸 행 목록을 받아 학생별 평균을 계산한다.
 * rows: [{evaluator, target, cls, scores:[숫자...]}]  keyType: 'sid'(학번) | 'name'(이름)
 */
function importPeer_(p) {
  const rows = Array.isArray(p.rows) ? p.rows : [], keyType = p.keyType === 'sid' ? 'sid' : 'name';
  if (!rows.length || rows.length > 5000) throw fail_('BAD_INPUT', '동료평가 행이 없거나 너무 많습니다.');
  return withLock_(function () {
    const stud = readAll_('students'), res = { students: 0, used: 0, skippedSelf: 0, skippedEmpty: 0, unmatched: [], ambiguous: [], noResponse: [] }, acc = {};
    const find = function (r) {
      const key = String(r.target == null ? '' : r.target).trim();
      if (!key) return [];
      let hit = stud.filter(function (s) { return keyType === 'sid' ? String(s['학번']) === key.replace(/\D/g, '') : s['이름'] === key; });
      if (keyType === 'name' && r.cls) { const c = String(parseInt(r.cls, 10)); const h2 = hit.filter(function (s) { return s['반'] === c; }); if (h2.length) hit = h2; }
      return hit;
    };
    const peerRows = [], un = {}, am = {};
    rows.forEach(function (r) {
      const sc = (r.scores || []).map(Number).filter(function (x) { return !isNaN(x); });
      if (!sc.length) { res.skippedEmpty++; return; }
      const hit = find(r);
      if (!hit.length) { un[String(r.target)] = 1; return; }
      if (hit.length > 1) { am[String(r.target)] = 1; return; }
      const s = hit[0], ev = String(r.evaluator == null ? '' : r.evaluator).trim();
      if (p.excludeSelf && ev && (ev === String(s['학번']) || ev === s['이름'])) { res.skippedSelf++; return; }
      const mean = sc.reduce(function (a, b) { return a + b; }, 0) / sc.length, k = s['팀ID'] + '|' + s['이름'];
      (acc[k] = acc[k] || { s: s, sum: 0, n: 0 }); acc[k].sum += mean; acc[k].n++; res.used++;
      peerRows.push({ 가져온일시: now_(), 평가자: ev, 피평가자: s['이름'] + '(' + s['학번'] + ')', '점수(평균)': Math.round(mean * 100) / 100, 점수들: sc.join(',') });
    });
    res.unmatched = Object.keys(un).slice(0, 30); res.ambiguous = Object.keys(am).slice(0, 30);
    // 개인채점 시트 갱신: 기존 동료 원점수는 지우고(환산 점수는 유지) 새로 채운다
    const ssAll = readAll_('sscore'), ssMap = {};
    ssAll.forEach(function (r) { r['동료원점수'] = ''; r['동료응답수'] = ''; ssMap[r['팀ID'] + '|' + r['이름']] = r; });
    Object.keys(acc).forEach(function (k) {
      const a = acc[k], avg = Math.round(a.sum / a.n * 100) / 100;
      if (!ssMap[k]) { ssMap[k] = { 팀ID: a.s['팀ID'], 이름: a.s['이름'], 학번: a.s['학번'] }; ssAll.push(ssMap[k]); }
      ssMap[k]['동료원점수'] = avg; ssMap[k]['동료응답수'] = a.n; ssMap[k]['수정일시'] = now_();
      res.students++;
    });
    stud.forEach(function (s) { if (!acc[s['팀ID'] + '|' + s['이름']]) res.noResponse.push(s['반'] + '반 ' + s['조'] + '조 ' + s['이름']); });
    res.noResponse = res.noResponse.slice(0, 50);
    rewrite_('sscore', ssAll);
    rewrite_('peer', peerRows);
    refreshView_();
    log_('관리자', '동료평가 가져오기', res.used + '건, ' + res.students + '명');
    return res;
  });
}
