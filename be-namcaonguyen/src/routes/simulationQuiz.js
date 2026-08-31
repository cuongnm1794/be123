import { Router } from 'express';
import {
  findSimulationQuizAnswer,
  listSimulationQuiz,
  upsertSimulationQuiz,
} from '../services/simulationQuizService.js';
import { saveSimulationQuizDebug } from '../services/simulationQuizDebugService.js';

const router = Router();

function formatRow(row) {
  return {
    id: row.id,
    stimulusTitle: row.stimulus_title,
    question: row.question_text,
    correctAnswerIndex: row.correct_answer_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * POST /api/simulation-quiz/answer
 * Body: { "stimulusTitle": "Bò đứng giữa đường", "question": "Tình huống tiềm ẩn..." }
 */
router.post('/simulation-quiz/answer', async (req, res) => {
  try {
    const { stimulusTitle, question } = req.body || {};
    console.log('[sim-quiz] POST /answer', {
      stimulusTitle,
      question: typeof question === 'string' ? question.slice(0, 120) : question,
    });

    if (!stimulusTitle || typeof stimulusTitle !== 'string' || !stimulusTitle.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường stimulusTitle',
      });
    }

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường question',
      });
    }

    const result = await findSimulationQuizAnswer(stimulusTitle.trim(), question.trim());

    if (!result) {
      console.log('[sim-quiz] POST /answer → NOT FOUND', { stimulusTitle });
      return res.json({
        success: true,
        found: false,
        error: 'Chưa có đáp án cho câu hỏi mô phỏng này',
      });
    }

    console.log('[sim-quiz] POST /answer → FOUND', {
      id: result.row.id,
      matchedBy: result.matchedBy,
      correctAnswerIndex: result.row.correct_answer_index,
    });

    return res.json({
      success: true,
      found: true,
      matchedBy: result.matchedBy,
      data: formatRow(result.row),
    });
  } catch (err) {
    console.error('POST /api/simulation-quiz/answer error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Lỗi server',
    });
  }
});

/**
 * POST /api/simulation-quiz/insert
 * Body: {
 *   "stimulusTitle": "Bò đứng giữa đường",
 *   "question": "Tình huống tiềm ẩn...",
 *   "correctAnswerIndex": 2
 * }
 */
router.post('/simulation-quiz/insert', async (req, res) => {
  try {
    const { stimulusTitle, question, correctAnswerIndex } = req.body || {};
    console.log('[sim-quiz] POST /insert', {
      stimulusTitle,
      question: typeof question === 'string' ? question.slice(0, 120) : question,
      correctAnswerIndex,
    });

    if (!stimulusTitle || typeof stimulusTitle !== 'string' || !stimulusTitle.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường stimulusTitle',
      });
    }

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường question',
      });
    }

    if (
      correctAnswerIndex === undefined ||
      correctAnswerIndex === null ||
      !Number.isFinite(Number(correctAnswerIndex))
    ) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường correctAnswerIndex (số)',
      });
    }

    const row = await upsertSimulationQuiz(
      stimulusTitle.trim(),
      question.trim(),
      correctAnswerIndex
    );

    console.log('[sim-quiz] POST /insert → OK', {
      id: row.id,
      stimulusTitle: row.stimulus_title,
      correctAnswerIndex: row.correct_answer_index,
    });

    return res.status(201).json({
      success: true,
      data: formatRow(row),
    });
  } catch (err) {
    console.error('POST /api/simulation-quiz/insert error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Lỗi server',
    });
  }
});

/**
 * POST /api/simulation-quiz/debug
 * Lưu HTML + metadata sau Kiểm tra (chỉ khi SIM_QUIZ_DEBUG=1).
 */
router.post('/simulation-quiz/debug', async (req, res) => {
  try {
    const payload = req.body || {};
    const panelCount = Array.isArray(payload.panels) ? payload.panels.length : 0;
    const defaultMatchCount =
      payload.defaultMatchCount ??
      (Array.isArray(payload.panels)
        ? payload.panels.filter((p) => p?.correctIndex != null).length
        : 0);

    const debugEnabled = process.env.SIM_QUIZ_DEBUG === '1';

    if (!debugEnabled) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Debug tắt — set SIM_QUIZ_DEBUG=1 trong .env để bật lưu HTML',
        panelCount,
        defaultMatchCount,
      });
    }

    console.log('[sim-quiz] POST /debug', {
      stimulusTitle: payload.stimulusTitle,
      pageUrl: payload.pageUrl,
      panelCount,
      defaultMatchCount,
      checkSubmitted: payload.checkSubmitted,
    });

    const saved = await saveSimulationQuizDebug({
      ...payload,
      defaultMatchCount,
    });

    console.log('[sim-quiz] POST /debug → SAVED', {
      id: saved.id,
      metaFile: saved.metaFile,
      panelCount: saved.panelCount,
    });

    return res.status(201).json({
      success: true,
      data: saved,
    });
  } catch (err) {
    console.error('POST /api/simulation-quiz/debug error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Lỗi lưu debug',
    });
  }
});

/**
 * POST /api/simulation-quiz/insert-batch
 * Body: { items: [{ stimulusTitle, question, correctAnswerIndex }] }
 */
router.post('/simulation-quiz/insert-batch', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    console.log('[sim-quiz] POST /insert-batch', { count: items.length });

    if (!items.length) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu mảng items',
      });
    }

    const results = [];
    for (const item of items) {
      const { stimulusTitle, question, correctAnswerIndex } = item || {};
      if (!stimulusTitle?.trim?.() || !question?.trim?.()) {
        results.push({ ok: false, error: 'Thiếu stimulusTitle hoặc question' });
        continue;
      }
      if (!Number.isFinite(Number(correctAnswerIndex))) {
        results.push({ ok: false, error: 'Thiếu correctAnswerIndex', question });
        continue;
      }
      try {
        const row = await upsertSimulationQuiz(
          stimulusTitle.trim(),
          question.trim(),
          correctAnswerIndex
        );
        results.push({ ok: true, data: formatRow(row) });
      } catch (err) {
        results.push({ ok: false, error: err.message, question });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    console.log('[sim-quiz] POST /insert-batch →', { okCount, total: items.length });

    return res.status(201).json({
      success: true,
      inserted: okCount,
      total: items.length,
      results,
    });
  } catch (err) {
    console.error('POST /api/simulation-quiz/insert-batch error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Lỗi server',
    });
  }
});

/** GET /api/simulation-quiz/list */
router.get('/simulation-quiz/list', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = await listSimulationQuiz(limit, offset);

    return res.json({
      success: true,
      data: rows.map((row) => formatRow(row)),
    });
  } catch (err) {
    console.error('GET /api/simulation-quiz/list error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

export default router;
