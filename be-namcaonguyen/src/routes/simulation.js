import { Router } from 'express';
import {
  findSimulationAnswer,
  upsertSimulation,
  listSimulations,
} from '../services/simulationService.js';

const router = Router();

function formatRow(row) {
  return {
    id: row.id,
    situationTitle: row.situation_title,
    situationQuestion: row.situation_question,
    stopSecond: row.stop_second,
    stopPercent: row.stop_percent,
    videoDuration: row.video_duration,
    markColor: row.mark_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * POST /api/simulation/answer
 * Body: {
 *   "situationTitle": "Chương 1: Giao thông trong đô thị",
 *   "situationQuestion": "Xe ô tô từ..."
 * }
 */
router.post('/simulation/answer', async (req, res) => {
  try {
    const { situationTitle, situationQuestion } = req.body || {};

    if (!situationQuestion || typeof situationQuestion !== 'string' || !situationQuestion.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường situationQuestion',
      });
    }

    const result = await findSimulationAnswer(
      situationTitle || null,
      situationQuestion.trim()
    );

    if (!result) {
      return res.json({
        success: true,
        found: false,
        error: 'Chưa có kết quả dừng cho tình huống này',
      });
    }

    return res.json({
      success: true,
      found: true,
      matchedBy: result.matchedBy,
      data: formatRow(result.row),
    });
  } catch (err) {
    console.error('POST /api/simulation/answer error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

/**
 * POST /api/simulation/insert
 * Body: {
 *   "situationTitle": "Chương 1: Giao thông trong đô thị",
 *   "situationQuestion": "Xe ô tô từ...",
 *   "stopSecond": 14.83,
 *   "stopPercent": 58.8754,
 *   "videoDuration": 25.2,
 *   "markColor": "rgb(0, 142, 44)"
 * }
 */
router.post('/simulation/insert', async (req, res) => {
  try {
    const {
      situationTitle,
      situationQuestion,
      stopSecond,
      stopPercent,
      videoDuration,
      markColor,
    } = req.body || {};

    if (!situationQuestion || typeof situationQuestion !== 'string' || !situationQuestion.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường situationQuestion',
      });
    }

    if (stopSecond === undefined || stopSecond === null || typeof stopSecond !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Thiếu trường stopSecond (số)',
      });
    }

    const row = await upsertSimulation(
      situationTitle || null,
      situationQuestion.trim(),
      stopSecond,
      stopPercent ?? null,
      videoDuration ?? null,
      markColor ?? null
    );

    return res.status(201).json({
      success: true,
      data: formatRow(row),
    });
  } catch (err) {
    console.error('POST /api/simulation/insert error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

/** GET /api/simulation/list */
router.get('/simulation/list', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = await listSimulations(limit, offset);

    return res.json({
      success: true,
      data: rows.map((row) => formatRow(row)),
    });
  } catch (err) {
    console.error('GET /api/simulation/list error:', err);
    return res.status(500).json({
      success: false,
      error: 'Lỗi server',
    });
  }
});

export default router;
