export function parseQuestionTitle(body) {
  const title = body?.questionTitle ?? body?.title;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return null;
  }
  return title.trim();
}

export function parseQuestionLookup(body) {
  const { question } = body ?? {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return { error: 'Thiếu trường question (chuỗi không rỗng)' };
  }

  return {
    question: question.trim(),
    questionTitle: parseQuestionTitle(body),
  };
}

export function parseQuestionWithAnswer(body) {
  const lookup = parseQuestionLookup(body);
  if (lookup.error) {
    return lookup;
  }

  const { correctAnswerIndex, answerPosition } = body ?? {};
  let index = correctAnswerIndex;

  if (answerPosition !== undefined && answerPosition !== null) {
    if (!Number.isInteger(answerPosition) || answerPosition < 0) {
      return { error: 'answerPosition phải là số nguyên >= 0 (index 0-based)' };
    }
    index = answerPosition;
  }

  if (index === undefined || index === null || !Number.isInteger(index) || index < 0) {
    return {
      error:
        'Thiếu correctAnswerIndex hoặc answerPosition (cả hai đều 0-based: 0 = đáp án đầu tiên)',
    };
  }

  return {
    question: lookup.question,
    questionTitle: lookup.questionTitle,
    correctAnswerIndex: index,
  };
}
