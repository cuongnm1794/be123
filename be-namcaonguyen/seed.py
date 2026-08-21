import hashlib
import os
import re
import sys

import psycopg2
import requests
from bs4 import BeautifulSoup, NavigableString, Tag
from dotenv import load_dotenv
from psycopg2.extras import execute_batch

load_dotenv()

URL = "https://truongdaotaolaixehcm.com/600-cau-hoi-ly-thuyet-dap-an-thi-sat-hach-lai-xe-oto-moi/"
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/quiznamcaonguyen",
)


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_question(text: str) -> str:
    """Giống src/utils/normalize.js — lowercase + bỏ hết khoảng trắng."""
    return re.sub(r"\s+", "", text or "").lower()


def hash_question(text: str) -> str:
    normalized = normalize_question(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _style_has_blue_color(style: str) -> bool:
    if not style:
        return False
    normalized = re.sub(r"\s+", "", style.lower())
    return (
        "#0000ff" in normalized
        or "color:blue" in normalized
        or "color:rgb(0,0,255)" in normalized
    )


def _is_blue_span(tag: Tag) -> bool:
    if tag.name != "span":
        return False
    if _style_has_blue_color(tag.get("style", "")):
        return True
    return _style_has_blue_color(tag.get("color", ""))


def _p_has_blue_span(tag: Tag) -> bool:
    if tag.name != "p":
        return False
    if _is_blue_span(tag):
        return True
    return any(_is_blue_span(span) for span in tag.find_all("span", recursive=True))


def is_correct_node(node) -> bool:
    """Đáp án đúng: thẻ p chứa span màu #0000ff (fallback strong/b)."""
    parent = getattr(node, "parent", None)

    while parent and isinstance(parent, Tag):
        if parent.name == "p" and _p_has_blue_span(parent):
            return True
        if parent.name in ["strong", "b"]:
            return True
        if _is_blue_span(parent):
            return True
        parent = parent.parent

    return False


def fetch_article_html():
    headers = {"User-Agent": "Mozilla/5.0"}
    res = requests.get(URL, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def parse_questions(html: str):
    soup = BeautifulSoup(html, "html.parser")

    article = (
        soup.select_one("article")
        or soup.select_one(".entry-content")
        or soup.select_one(".post")
        or soup.body
    )

    items = []
    current = None
    current_answer = None

    question_re = re.compile(r"^Câu\s+(\d+)\.\s*(.+)", re.I)
    answer_re = re.compile(r"^([1-4])\.\s*(.+)")

    for node in article.descendants:
        if not isinstance(node, NavigableString):
            continue

        text = clean_text(str(node))
        if not text:
            continue

        q_match = question_re.match(text)
        a_match = answer_re.match(text)

        if q_match:
            if current:
                if current_answer:
                    current["answers"].append(current_answer)
                    current_answer = None
                items.append(current)

            question_number = int(q_match.group(1))
            question_text = clean_text(q_match.group(2))

            current = {
                "question_number": question_number,
                "question": question_text,
                "answers": [],
            }
            current_answer = None
            continue

        if not current:
            continue

        if a_match:
            if current_answer:
                current["answers"].append(current_answer)

            position = int(a_match.group(1))
            answer_text = clean_text(a_match.group(2))
            parent = node.parent
            is_correct = is_correct_node(parent)

            current_answer = {
                "position": position,
                "answer": answer_text,
                "is_correct": is_correct,
            }
            continue

        if current_answer:
            current_answer["answer"] = clean_text(
                current_answer["answer"] + " " + text
            )
            if is_correct_node(node.parent):
                current_answer["is_correct"] = True
        else:
            current["question"] = clean_text(current["question"] + " " + text)

    if current:
        if current_answer:
            current["answers"].append(current_answer)
        items.append(current)

    return items


def to_db_row(item: dict) -> tuple[str, str, int] | None:
    correct_answers = [a for a in item["answers"] if a["is_correct"]]
    if not correct_answers:
        return None

    # Trang web: đáp án 1–4 → backend: correct_answer_index 0–3
    position = correct_answers[0]["position"]
    correct_answer_index = position - 1

    question_text = normalize_question(item["question"])
    question_hash = hash_question(item["question"])

    return question_text, question_hash, correct_answer_index


def fetch_existing_hashes(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT question_hash FROM questions")
        return {row[0] for row in cur.fetchall()}


def save_to_db(conn, questions: list[dict]) -> tuple[int, int, list[dict]]:
    existing_hashes = fetch_existing_hashes(conn)

    rows_to_insert = []
    skipped_existing = 0
    skipped_parse: list[dict] = []

    for item in questions:
        row = to_db_row(item)
        if row is None:
            skipped_parse.append(item)
            continue

        _, question_hash, _ = row
        if question_hash in existing_hashes:
            skipped_existing += 1
            continue

        rows_to_insert.append(row)
        existing_hashes.add(question_hash)

    if rows_to_insert:
        sql = """
            INSERT INTO questions (question_text, question_hash, correct_answer_index)
            VALUES (%s, %s, %s)
        """
        with conn.cursor() as cur:
            execute_batch(cur, sql, rows_to_insert, page_size=200)
        conn.commit()

    return len(rows_to_insert), skipped_existing, skipped_parse


def print_skipped_parse(skipped: list[dict]) -> None:
    if not skipped:
        return

    print(f"\nSkipped {len(skipped)} cau (khong tim thay dap an dung tren trang):")
    for item in skipped:
        num = item["question_number"]
        question = item["question"]
        answers = item.get("answers") or []
        print(f"  - Cau {num}: {question}")
        if answers:
            for ans in answers:
                print(f"      {ans['position']}. {ans['answer']}")
        else:
            print("      (khong co dap an)")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    html = fetch_article_html()
    questions = parse_questions(html)

    conn = psycopg2.connect(DATABASE_URL)
    try:
        inserted, skipped_existing, skipped_parse = save_to_db(conn, questions)
    finally:
        conn.close()

    print(f"Done. Parsed {len(questions)} questions.")
    print(f"Inserted {inserted} cau moi.")
    print(f"Bo qua {skipped_existing} cau da co trong DB.")
    print_skipped_parse(skipped_parse)


if __name__ == "__main__":
    main()
