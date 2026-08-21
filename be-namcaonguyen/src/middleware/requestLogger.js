import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, 'api.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendLog(line) {
  ensureLogDir();
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) console.error('Ghi log thất bại:', err.message);
  });
}

function formatPayload(label, data) {
  try {
    return `${label}: ${JSON.stringify(data, null, 2)}`;
  } catch {
    return `${label}: [không serialize được]`;
  }
}

export function requestLogger(req, res, next) {
  if (!req.originalUrl.startsWith('/api')) {
    return next();
  }

  const startedAt = Date.now();
  const { method, originalUrl, ip } = req;

  const originalJson = res.json.bind(res);

  res.json = function jsonWithLog(body) {
    const durationMs = Date.now() - startedAt;
    const timestamp = new Date().toISOString();

    const lines = [
      `[${timestamp}] ${method} ${originalUrl} | ${ip} | ${res.statusCode} | ${durationMs}ms`,
      formatPayload('NHẬN', {
        body: req.body,
        query: Object.keys(req.query).length ? req.query : undefined,
      }),
      formatPayload('TRẢ', body),
      '---',
      '',
    ];

    appendLog(lines.join('\n'));
    return originalJson(body);
  };

  next();
}
