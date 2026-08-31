import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.resolve(__dirname, '../../debug/sim-quiz');

function sanitizeFilename(name) {
  return String(name || 'unknown')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'unknown';
}

/**
 * Lưu payload debug từ extension: JSON metadata + file HTML riêng.
 */
export async function saveSimulationQuizDebug(payload = {}) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeStimulus = sanitizeFilename(payload.stimulusTitle);
  const baseName = `${stamp}_${safeStimulus}`;
  const savedFiles = {};

  if (payload.groupHtml && typeof payload.groupHtml === 'string') {
    const groupFile = `${baseName}_group.html`;
    await fs.writeFile(path.join(DEBUG_DIR, groupFile), payload.groupHtml, 'utf8');
    savedFiles.groupHtml = groupFile;
  }

  if (payload.documentHtml && typeof payload.documentHtml === 'string') {
    const docFile = `${baseName}_document.html`;
    await fs.writeFile(path.join(DEBUG_DIR, docFile), payload.documentHtml, 'utf8');
    savedFiles.documentHtml = docFile;
  }

  const panels = Array.isArray(payload.panels) ? payload.panels : [];
  const panelsMeta = [];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i] || {};
    let panelHtmlFile = null;

    if (panel.panelHtml && typeof panel.panelHtml === 'string') {
      panelHtmlFile = `${baseName}_panel${i + 1}.html`;
      await fs.writeFile(path.join(DEBUG_DIR, panelHtmlFile), panel.panelHtml, 'utf8');
      savedFiles[`panel${i + 1}`] = panelHtmlFile;
    }

    panelsMeta.push({
      panelIndex: panel.panelIndex ?? i,
      wrapperId: panel.wrapperId ?? null,
      stimulusTitle: panel.stimulusTitle ?? null,
      question: panel.question ?? null,
      selectedIndex: panel.selectedIndex ?? null,
      correctIndex: panel.correctIndex ?? null,
      correctText: panel.correctText ?? null,
      source: panel.source ?? null,
      hasDefaultMatch: panel.hasDefaultMatch ?? null,
      answerTexts: panel.answerTexts ?? null,
      panelHtmlFile,
    });
  }

  const meta = {
    id: baseName,
    savedAt: new Date().toISOString(),
    stimulusTitle: payload.stimulusTitle ?? null,
    pageUrl: payload.pageUrl ?? null,
    capturedAt: payload.capturedAt ?? null,
    checkSubmitted: payload.checkSubmitted ?? null,
    defaultMatchCount: payload.defaultMatchCount ?? null,
    panelCount: panelsMeta.length,
    groupTextPreview: payload.groupText ?? null,
    panels: panelsMeta,
    savedFiles,
  };

  const metaFile = `${baseName}.json`;
  await fs.writeFile(
    path.join(DEBUG_DIR, metaFile),
    JSON.stringify(meta, null, 2),
    'utf8'
  );

  return {
    id: baseName,
    metaFile,
    savedFiles,
    debugDir: DEBUG_DIR,
    panelCount: panelsMeta.length,
    defaultMatchCount: payload.defaultMatchCount ?? 0,
  };
}

export function getSimulationQuizDebugDir() {
  return DEBUG_DIR;
}
