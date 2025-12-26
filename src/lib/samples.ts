export const sampleJson = `{
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
    },
    {
      "id": "Q3",
      "type": "multi",
      "prompt": "웹 표준에 해당하는 것은?",
      "choices": ["HTML", "PNG", "CSS", "MP3"],
      "answer": [0, 2],
      "explanation": "HTML과 CSS는 웹 표준입니다."
    },
    {
      "id": "Q4",
      "type": "ox",
      "prompt": "HTTP는 상태를 유지하지 않는(stateless) 프로토콜이다.",
      "answer": "O",
      "explanation": "HTTP는 기본적으로 stateless입니다."
    }
  ]
}`;

export const sampleText = `문제 1) 1+1은?
① 1
② 2
③ 3
④ 4
정답: ②
해설: 1+1=2

문제 2) 대한민국의 수도는?
정답: 서울

문제 3) 다음 중 브라우저 렌더링에 관여하는 것은?
1) HTML
2) CSS
3) Git
4) Java
정답: 1, 2
해설: HTML/CSS는 렌더링에 직접 관여합니다.

문제 4) O/X - JS는 런타임이 없으면 실행될 수 없다.
정답: O`;

