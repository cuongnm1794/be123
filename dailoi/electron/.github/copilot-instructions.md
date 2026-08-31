# Electron Auto Learning System - Project Instructions

## Project Overview
This is an Electron application with TypeScript for automated learning management with PostgreSQL database and Playwright automation.

## Tech Stack
- Electron (Desktop application framework)
- TypeScript (Type-safe JavaScript)
- PostgreSQL (Database)
- Playwright (Browser automation)
- Node.js (Backend runtime)

## Database Schema
- **user**: username, password, is_finish
- **course**: course_name, description, link
- **user_course**: user_id, course_id, progress, time
- **log**: user_id, action, timestamp

## Key Features
- Multi-user management with Chrome profiles
- Auto login and course enrollment
- Progress tracking and resumable automation
- Multi-browser/multi-user concurrent execution
- Action logging

## Development Guidelines
- Use TypeScript for type safety
- Follow async/await patterns for Playwright
- Implement proper IPC communication between main and renderer
- Store Chrome profiles separately per user
- Handle graceful shutdown and progress saving
