import { createHash } from 'crypto';

/** Chuẩn hóa text: lowercase + bỏ hết khoảng trắng */
export function normalizeText(text) {
  return (text || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function normalizeQuestion(text) {
  return normalizeText(text);
}

export function normalizeTitle(text) {
  return normalizeText(text);
}

export function hashQuestion(text) {
  return hashText(text);
}

export function hashText(text) {
  const normalized = normalizeText(text);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
