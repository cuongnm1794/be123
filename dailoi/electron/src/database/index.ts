import { Pool } from 'pg';

export interface User {
  id?: number;
  username: string;
  password: string;
  name?: string;
  user_id?: number;
  is_finish: boolean;
  is_running: boolean;
  created_at?: Date;
}

export interface Course {
  id?: number;
  course_name: string;
  description: string;
  link: string;
}

export interface UserCourse {
  id?: number;
  user_id: number;
  course_id: number;
  progress: number;
  time: Date;
}

export interface Log {
  id?: number;
  user_id: number;
  action: string;
  timestamp: Date;
}

export interface LessonCheckpoint {
  id?: number;
  user_id: number;
  course_id: number;
  last_slide_id: number;
  last_lesson_name?: string;
  last_lesson_index?: number;
  updated_at?: Date;
}

class Database {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'auto_learning',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });
  }

  private getStudyDateString(baseDate: Date = new Date()): string {
    return new Date(baseDate.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          is_finish BOOLEAN DEFAULT FALSE,
          is_running BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Migration: Add is_running column if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='is_running'
          ) THEN
            ALTER TABLE users ADD COLUMN is_running BOOLEAN DEFAULT FALSE;
          END IF;
        END $$;
      `);

      // Migration: Add created_at column if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='created_at'
          ) THEN
            ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
          END IF;
        END $$;
      `);

      // Migration: Add user_id column if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='user_id'
          ) THEN
            ALTER TABLE users ADD COLUMN user_id INTEGER;
          END IF;
        END $$;
      `);

      // Migration: Add name column if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='name'
          ) THEN
            ALTER TABLE users ADD COLUMN name VARCHAR(255);
          END IF;
        END $$;
      `);

      // Create courses table
      await client.query(`
        CREATE TABLE IF NOT EXISTS courses (
          id SERIAL PRIMARY KEY,
          course_name VARCHAR(255) NOT NULL,
          description TEXT,
          link VARCHAR(500) NOT NULL
        )
      `);

      // Create user_courses table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_courses (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
          progress FLOAT DEFAULT 0,
          time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, course_id)
        )
      `);

      // Create logs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create study_hours table to track daily study hours
      await client.query(`
        CREATE TABLE IF NOT EXISTS study_hours (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          study_date DATE NOT NULL,
          hours_studied FLOAT DEFAULT 0,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, study_date)
        )
      `);

      // Migration: Add study_hours table if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name='study_hours'
          ) THEN
            CREATE TABLE study_hours (
              id SERIAL PRIMARY KEY,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              study_date DATE NOT NULL,
              hours_studied FLOAT DEFAULT 0,
              last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(user_id, study_date)
            );
            CREATE INDEX IF NOT EXISTS idx_study_hours_user_date ON study_hours(user_id, study_date);
          END IF;
        END $$;
      `);

      // Migration: align legacy `hours` column with Electron/hermes-bridge schema
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='study_hours' AND column_name='hours'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='study_hours' AND column_name='hours_studied'
          ) THEN
            ALTER TABLE study_hours RENAME COLUMN hours TO hours_studied;
          ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='study_hours' AND column_name='hours'
          ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='study_hours' AND column_name='hours_studied'
          ) THEN
            UPDATE study_hours
            SET hours_studied = COALESCE(hours_studied, 0) + COALESCE(hours, 0)
            WHERE hours IS NOT NULL AND hours <> 0;
            ALTER TABLE study_hours DROP COLUMN hours;
          ELSIF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='study_hours' AND column_name='hours_studied'
          ) THEN
            ALTER TABLE study_hours ADD COLUMN hours_studied FLOAT DEFAULT 0;
          END IF;
        END $$;
      `);

      // Create index for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_study_hours_user_date ON study_hours(user_id, study_date);
      `);

      // Create lesson checkpoints table for resume support
      await client.query(`
        CREATE TABLE IF NOT EXISTS lesson_checkpoints (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
          last_slide_id INTEGER NOT NULL,
          last_lesson_name VARCHAR(500),
          last_lesson_index INTEGER,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, course_id)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_lesson_checkpoints_user_course
        ON lesson_checkpoints(user_id, course_id);
      `);

      console.log('Database initialized successfully');
    } finally {
      client.release();
    }
  }

  // User operations
  async createUser(user: User): Promise<User> {
    const result = await this.pool.query(
      'INSERT INTO users (username, password, is_finish, is_running) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.username, user.password, user.is_finish, user.is_running || false]
    );
    return result.rows[0];
  }

  async getAllUsers(): Promise<User[]> {
    const result = await this.pool.query('SELECT * FROM users ORDER BY id DESC');
    return result.rows;
  }

  async getUserById(id: number): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async updateUser(id: number, user: Partial<User>): Promise<User | null> {
    const fields = [];
    const values = [];
    let index = 1;

    if (user.username !== undefined) {
      fields.push(`username = $${index++}`);
      values.push(user.username);
    }
    if (user.password !== undefined) {
      fields.push(`password = $${index++}`);
      values.push(user.password);
    }
    if (user.name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(user.name);
    }
    if (user.is_finish !== undefined) {
      fields.push(`is_finish = $${index++}`);
      values.push(user.is_finish);
    }
    if (user.is_running !== undefined) {
      fields.push(`is_running = $${index++}`);
      values.push(user.is_running);
    }
    if (user.user_id !== undefined) {
      fields.push(`user_id = $${index++}`);
      values.push(user.user_id);
    }

    if (fields.length === 0) return null;

    values.push(id);
    const result = await this.pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Course operations
  async createCourse(course: Course): Promise<Course> {
    const result = await this.pool.query(
      'INSERT INTO courses (course_name, description, link) VALUES ($1, $2, $3) RETURNING *',
      [course.course_name, course.description, course.link]
    );
    return result.rows[0];
  }

  async getAllCourses(): Promise<Course[]> {
    const result = await this.pool.query('SELECT * FROM courses');
    return result.rows;
  }

  async getCourseById(id: number): Promise<Course | null> {
    const result = await this.pool.query('SELECT * FROM courses WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  // UserCourse operations
  async createUserCourse(userCourse: UserCourse): Promise<UserCourse> {
    const result = await this.pool.query(
      'INSERT INTO user_courses (user_id, course_id, progress, time) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, course_id) DO UPDATE SET progress = $3, time = $4 RETURNING *',
      [userCourse.user_id, userCourse.course_id, userCourse.progress, userCourse.time]
    );
    return result.rows[0];
  }

  async getUserCourses(userId: number): Promise<UserCourse[]> {
    const result = await this.pool.query(
      'SELECT uc.*, c.course_name, c.description, c.link FROM user_courses uc JOIN courses c ON uc.course_id = c.id WHERE uc.user_id = $1 order by c.id ASC',
      [userId]
    );
    return result.rows;
  }

  async getIncompleteCourses(userId: number): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT uc.*, c.course_name, c.description, c.link FROM user_courses uc JOIN courses c ON uc.course_id = c.id WHERE uc.user_id = $1 AND uc.progress < 100 order by c.id ASC',
      [userId]
    );
    return result.rows;
  }

  async getUserCourseStats(userId: number): Promise<{ completed: number; total: number }> {
    const result = await this.pool.query(
      'SELECT COUNT(*) as total, COUNT(CASE WHEN progress >= 100 THEN 1 END) as completed FROM user_courses WHERE user_id = $1',
      [userId]
    );
    return {
      total: Number.parseInt(result.rows[0].total, 10),
      completed: Number.parseInt(result.rows[0].completed, 10)
    };
  }

  async updateCourseProgress(userId: number, courseId: number, progress: number): Promise<UserCourse | null> {
    const result = await this.pool.query(
      'UPDATE user_courses SET progress = $1, time = CURRENT_TIMESTAMP WHERE user_id = $2 AND course_id = $3 RETURNING *',
      [progress, userId, courseId]
    );
    return result.rows[0] || null;
  }

  async getLessonCheckpoint(userId: number, courseId: number): Promise<LessonCheckpoint | null> {
    const result = await this.pool.query(
      'SELECT * FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    return result.rows[0] || null;
  }

  async upsertLessonCheckpoint(checkpoint: LessonCheckpoint): Promise<LessonCheckpoint> {
    const result = await this.pool.query(
      `INSERT INTO lesson_checkpoints
       (user_id, course_id, last_slide_id, last_lesson_name, last_lesson_index, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, course_id)
       DO UPDATE SET
         last_slide_id = EXCLUDED.last_slide_id,
         last_lesson_name = EXCLUDED.last_lesson_name,
         last_lesson_index = EXCLUDED.last_lesson_index,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        checkpoint.user_id,
        checkpoint.course_id,
        checkpoint.last_slide_id,
        checkpoint.last_lesson_name || null,
        checkpoint.last_lesson_index ?? null,
      ]
    );
    return result.rows[0];
  }

  async clearLessonCheckpoint(userId: number, courseId: number): Promise<void> {
    await this.pool.query(
      'DELETE FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
  }

  // Log operations
  async createLog(log: Log): Promise<Log> {
    const result = await this.pool.query(
      'INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3) RETURNING *',
      [log.user_id, log.action, log.timestamp]
    );
    return result.rows[0];
  }

  async getUserLogs(userId: number, limit: number = 100): Promise<Log[]> {
    const result = await this.pool.query(
      'SELECT * FROM logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  }

  async getAllLogs(limit: number = 100): Promise<Log[]> {
    const result = await this.pool.query(
      'SELECT l.*, u.username FROM logs l JOIN users u ON l.user_id = u.id ORDER BY l.timestamp DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  // Study hours operations
  async getTodayStudyHours(userId: number): Promise<number> {
    const adjustedDate = this.getStudyDateString();

    const result = await this.pool.query(
      "SELECT hours_studied FROM study_hours WHERE user_id = $1 AND study_date = $2",
      [userId, adjustedDate]
    );
    return result.rows[0]?.hours_studied || 0;
  }

  async addStudyHours(userId: number, hours: number): Promise<number> {
    const today = this.getStudyDateString();
    const result = await this.pool.query(
      `INSERT INTO study_hours (user_id, study_date, hours_studied, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, study_date) 
       DO UPDATE SET hours_studied = study_hours.hours_studied + $3, last_updated = CURRENT_TIMESTAMP
       RETURNING hours_studied`,
      [userId, today, hours]
    );
    return result.rows[0]?.hours_studied || 0;
  }

  async resetDailyStudyHours() {
    // This can be called at midnight to reset daily hours
    // For now, we rely on the date-based unique constraint

  }

  async close() {
    await this.pool.end();
  }
}

export default Database;
