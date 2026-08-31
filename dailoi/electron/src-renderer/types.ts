export interface User {
  id: number;
  username: string;
  password: string;
  name?: string;
  user_id?: number;
  is_finish: boolean;
  is_running: boolean;
  created_at?: Date;
}

export interface Course {
  id: number;
  course_name: string;
  description: string;
  link: string;
}

export interface UserCourse {
  id: number;
  user_id: number;
  course_id: number;
  progress: number;
  time: Date;
  course_name?: string;
  description?: string;
  link?: string;
}

export interface Log {
  id: number;
  user_id: number;
  username?: string;
  action: string;
  timestamp: Date;
}

export interface ProgressData {
  show: boolean;
  title: string;
  progress: number;
  message: string;
}

export interface InputDialogData {
  show: boolean;
  title: string;
  defaultValue: string;
  onSubmit: (value: string) => void;
}

// Electron IPC Renderer type
declare global {
  interface Window {
    require: any;
  }
}
