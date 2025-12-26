# 기출 문제 풀이 & 채점 스튜디오

## 구현 방식
- A안: React + TypeScript + Vite (프론트엔드만)
- 파일 업로드는 FileReader로 처리하며, 데이터/답안/플래그는 LocalStorage에 저장합니다.
- 입력 모드: 파일 업로드 / 텍스트 붙여넣기 / 직접 입력(정답·해설 포함)

## 로컬 실행
```bash
npm install
npm run dev
```

## 프로젝트 구조
```
.
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── src
    ├── App.tsx
    ├── main.tsx
    ├── styles.css
    ├── vite-env.d.ts
    └── lib
        ├── grading.ts
        ├── parser.ts
        ├── samples.ts
        ├── storage.ts
        ├── types.ts
        └── utils.ts
```

## 샘플 데이터
### JSON 예시
```json
{
  "title": "예시 기출",
  "questions": [
    {
      "id": "Q1",
      "type": "single",
      "prompt": "1+1은?",
      "choices": ["1", "2", "3", "4"],
      "answer": 1,
      "explanation": "1+1=2"
    },
    {
      "id": "Q2",
      "type": "short",
      "prompt": "대한민국의 수도는?",
      "answerText": ["서울", "서울특별시"],
      "explanation": "수도는 서울"
    }
  ]
}
```

### 간편 텍스트 예시
```
문제 1) 1+1은?
① 1
② 2
③ 3
④ 4
정답: ②
해설: 1+1=2

문제 2) 대한민국의 수도는?
정답: 서울
```

## 테스트 시나리오 (5)
1. JSON 업로드 후 파싱 미리보기에서 정답/해설 수정 → 시험 시작 → 채점 결과 확인.
2. 간편 텍스트 붙여넣기 → 문제 번호/정답 파싱 확인 → 오답노트 내보내기(JSON).
3. 복수 선택 문항: 1,3 정답 설정 → 일부 선택 시 오답 처리 확인.
4. 단답형 정규화: "  서울  " 입력 → 정답 처리 확인.
5. 보기 없는 객관식/정답 누락 입력 → 파싱 경고 표시 확인.
