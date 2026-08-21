CREATE TABLE IF NOT EXISTS simulation_situations (
    id SERIAL PRIMARY KEY,
    situation_title TEXT,
    situation_question TEXT NOT NULL,
    situation_hash VARCHAR(64) NOT NULL UNIQUE,
    stop_second DECIMAL(10, 3),
    stop_percent DECIMAL(10, 6),
    video_duration DECIMAL(10, 3),
    mark_color VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulation_hash ON simulation_situations (situation_hash);

COMMENT ON TABLE simulation_situations IS 'Tinh huong mo phong giao thong va giay dung dung';
COMMENT ON COLUMN simulation_situations.stop_second IS 'Thoi diem can bam Space/dung (giay)';
COMMENT ON COLUMN simulation_situations.stop_percent IS 'Vi tri % tren thanh tracking bar';
COMMENT ON COLUMN simulation_situations.video_duration IS 'Tong thoi luong video (giay)';
COMMENT ON COLUMN simulation_situations.mark_color IS 'Mau cua mark dung (de debug)';
