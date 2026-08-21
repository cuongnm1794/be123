import { Router } from 'express';
import {
  findAnswerByQuestion,
  insertQuestionOnly,
  listQuestions,
  upsertQuestion,
} from '../services/questionService.js';
import { logMissingQuestion } from '../utils/missingQuestionLog.js';
import {
  parseQuestionLookup,
  parseQuestionWithAnswer,
} from '../utils/parseQuestionBody.js';

const router = Router();

function formatQuestionRow(row) {
  return {
    id: row.id,
    questionTitle: row.question_title,
    question: row.question_text,
    correctAnswerIndex: row.correct_answer_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Extension gọi endpoint này:
 * POST /api/answer
 * Body: {
 *   "questionTitle": "1. Câu hỏi chọn một đáp án",
 *   "question": "Nội dung câu hỏi?"
 * }
 */
router.post('/answer', async (req, res) => {
  try {
    const parsed = parseQuestionLookup(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const { question, questionTitle } = parsed;
    const result = await findAnswerByQuestion(question, questionTitle);

    if (!result) {
      logMissingQuestion(question, questionTitle);

      return res.json({
        success: true,
        found: false,
        error: 'Chưa có đáp án cho câu hỏi này',
      });
    }

    const { row, matchedBy } = result;

    return res.json({
      success: true,
      found: true,
      matchedBy,
      data: {
        id: row.id,
        questionTitle: row.question_title,
        question: row.question_text,
        correctAnswerIndex: row.correct_answer_index,
      },
    });
  } catch (err) {
    console.error('POST /api/answer error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

/**
 * Insert câu hỏi + đáp án đúng
 * POST /api/insert
 */
router.post('/insert', async (req, res) => {
  try {
    const parsed = parseQuestionWithAnswer(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const skipExisting = req.query.mode === 'skip-existing';
    const { question, questionTitle, correctAnswerIndex } = parsed;

    if (skipExisting) {
      const { inserted, row } = await insertQuestionOnly(
        question,
        correctAnswerIndex,
        questionTitle
      );

      if (!inserted) {
        return res.status(409).json({
          success: false,
          error: 'Câu hỏi đã tồn tại trong DB',
          data: formatQuestionRow(row),
        });
      }

      return res.status(201).json({
        success: true,
        inserted: true,
        data: formatQuestionRow(row),
      });
    }

    const row = await upsertQuestion(question, correctAnswerIndex, questionTitle);

    return res.status(201).json({
      success: true,
      inserted: true,
      data: formatQuestionRow(row),
    });
  } catch (err) {
    console.error('POST /api/insert error:', err);
    return res.status(500).json({ success: false, error: 'Lỗi server' });
  }
});

/** POST /api/questions */
router.post('/questions', async (req, res) => {
  try {
    const parsed = parseQuestionWithAnswer(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const row = await upsertQuestion(
      parsed.question,
      parsed.correctAnswerIndex,
      parsed.questionTitle
    );

    return res.status(201).json({
      success: true,
      data: formatQuestionRow(row),
    });
  } catch (err) {
    console.error('POST /api/questions error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

/** GET /api/questions */
router.get('/questions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = await listQuestions(limit, offset);

    return res.json({
      success: true,
      data: rows.map((row) => formatQuestionRow(row)),
    });
  } catch (err) {
    console.error('GET /api/questions error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

export default router;
