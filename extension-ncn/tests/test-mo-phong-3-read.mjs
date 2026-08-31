/**
 * Test đọc đáp án đúng từ mo_phong_3.html (sau Kiểm tra).
 * Chạy: npm install && npm run test:mo-phong-3
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseHTML } from "linkedom";
import xpath from "xpath";
import { DOMParser } from "@xmldom/xmldom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, "../../html/mo_phong_3.html");

const SELECTOR_ANSWER = ".mc-text-question__radio-answer";
const DEFAULT_MATCH_XPATH =
  ".//div[contains(@class,'mc-text-question__radio-answer') and contains(@class,'default-match')]//input[@type='radio']";

function normalizeText(t) {
  return String(t || "").replace(/\s+/g, " ").trim();
}

function getAnswerBoxes(panel) {
  return [...panel.querySelectorAll(SELECTOR_ANSWER)];
}

function getAnswerOptionText(box) {
  const display = box.querySelector(".content-display");
  return normalizeText(display?.textContent || box.textContent);
}

function findDefaultMatchAnswerIndex(panel) {
  const answers = getAnswerBoxes(panel);

  for (let i = 0; i < answers.length; i++) {
    const box = answers[i];
    if (
      box.classList.contains("default-match") &&
      box.querySelector('input[type="radio"]')
    ) {
      return {
        index: i,
        source: "default-match",
        correctText: getAnswerOptionText(box),
      };
    }
  }

  const byQuery = panel.querySelector(
    `${SELECTOR_ANSWER}.default-match input[type="radio"]`
  );
  if (byQuery) {
    const matchBox = byQuery.closest(SELECTOR_ANSWER);
    const idx = answers.indexOf(matchBox);
    if (idx >= 0) {
      return {
        index: idx,
        source: "default-match-query",
        correctText: getAnswerOptionText(matchBox),
      };
    }
  }

  const xmlDoc = new DOMParser().parseFromString(panel.outerHTML, "text/html");
  const nodes = xpath.select(DEFAULT_MATCH_XPATH, xmlDoc);
  if (nodes?.length) {
    const radioId = nodes[0].getAttribute?.("id");
    if (radioId) {
      const liveRadio = panel.querySelector(`#${CSS.escape(radioId)}`);
      const matchBox = liveRadio?.closest(SELECTOR_ANSWER);
      if (matchBox) {
        const idx = answers.indexOf(matchBox);
        if (idx >= 0) {
          return {
            index: idx,
            source: "default-match-xpath",
            correctText: getAnswerOptionText(matchBox),
          };
        }
      }
    }
  }

  return { index: null, source: null, correctText: null };
}

function getStimulusText(group) {
  const stimulus = group.querySelector(".practice-group-question__stimulus");
  if (!stimulus) return "";
  for (const span of stimulus.querySelectorAll("span.content-display")) {
    if (span.closest(".mc-text-question")) continue;
    const text = normalizeText(span.textContent);
    if (text.length > 2 && text.length <= 120) return text;
  }
  return "";
}

function getQuestionText(panel) {
  const display = panel.querySelector(".question-content .content-display");
  return normalizeText(display?.textContent || "");
}

const EXPECTED = [
  { index: 1, text: "Đường cong khuất" },
  { index: 0, text: "Có vật che tầm nhìn" },
  { index: 1, text: "Không thấy phía trước" },
  { index: 2, text: "Giảm tốc, giữ khoảng cách an toàn" },
];

const html = fs.readFileSync(HTML_PATH, "utf8");
const { document } = parseHTML(html);
const group = document.querySelector(".practice-group-question");
if (!group) {
  console.error("FAIL: không có .practice-group-question");
  process.exit(1);
}

const stimulus = getStimulusText(group);
const panels = [...group.querySelectorAll(".question-panel")].filter((p) =>
  p.querySelector(".mc-text-question")
);

console.log("Stimulus:", stimulus);
console.log("Panels:", panels.length);

let failed = 0;
panels.forEach((panel, i) => {
  const q = getQuestionText(panel);
  const got = findDefaultMatchAnswerIndex(panel);
  const exp = EXPECTED[i];
  const ok =
    got.index === exp.index &&
    normalizeText(got.correctText) === normalizeText(exp.text);

  console.log(
    `\nCâu ${i + 1}: ${ok ? "OK" : "FAIL"}`,
    `\n  Q: ${q.slice(0, 60)}`,
    `\n  expected [${exp.index}] "${exp.text}"`,
    `\n  got      [${got.index}] "${got.correctText}" (${got.source})`
  );
  if (!ok) failed += 1;
});

if (failed > 0) {
  console.error(`\n${failed}/${panels.length} FAILED`);
  process.exit(1);
}

console.log(`\nAll ${panels.length} panels passed (default-match).`);
