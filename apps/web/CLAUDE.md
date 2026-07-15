# AI Assistant Instructions for MeetAI Web App

**Version:** 1.0  
**Last Updated:** July 16, 2026  
**Assigned to:** Antigravity AI Assistant  

## 1. Project Overview

**Project Name:** MeetAI  
**Description:** AI-powered meeting assistant platform that records, transcribes, and analyzes video meetings to generate insights, action items, and reports.  
**GitHub Repository:** `https://github.com/abhiram33333/meet-ai-monorepo`

## 2. Coding Standards

### Architecture

- **Monorepo Structure:** The project uses a monorepo with `apps/` and `packages/` directories  
- **Separation of Concerns:**  
  - `apps/web`: Next.js frontend application  
  - `apps/server`: Express.js + TypeScript backend API  
  - `packages/`: Shared libraries and utilities  
- **Microservices Pattern:** Backend is designed as a collection of microservices  
- **API-First:** All frontend-backend communication happens via REST APIs  

### Frontend (apps/web)

- **Framework:** Next.js 16 with TypeScript  
- **Component Architecture:**  
  - Use React Server Components for data fetching  
  - Use Client Components for interactive elements  
  - Create reusable UI components in `components/` directory  
  - Follow atomic design principles where applicable  
- **Styling:**  
  - Use Tailwind CSS for utility-first styling  
  - Create custom components in `components/ui/` directory  
- **State Management:**  
  - Use React Context for global state (auth, theme, etc.)  
  - Use Zustand for local component state management  
- **Data Fetching:**  
  - Use Next.js Server Actions for data mutations  
  - Use React Query for data fetching and caching  
- **Code Quality:**  
  - Use TypeScript strictly with type safety  
  - Follow React functional component patterns  
  - Avoid unnecessary re-renders  

### Backend (apps/server)

- **Framework:** Express.js with TypeScript  
- **API Design:** RESTful API with JSON format  
- **Database:** PostgreSQL (handled by Supabase)  
- **Authentication:** JWT-based authentication with Redis-backed refresh tokens  
- **Message Queues:** RabbitMQ for asynchronous processing  
- **File Storage:** Cloudinary for media storage  
- **Code Quality:**  
  - Strict TypeScript typing  
  - SOLID design principles  
  - Proper error handling  
  - Comprehensive JSDoc documentation  

## 3. Development Workflow

### Running the Project

**To start both frontend and backend:**

```bash
# Start backend
cd apps/server
npm run dev

# Open new terminal
cd apps/web
npm run dev
```

**Backend available at:** `http://localhost:4000`  
**Frontend available at:** `http://localhost:3000`

### Version Control

- **Branch Naming:** `feature/descriptive-name` (e.g., `feature/auth-ui`)  
- **Commit Messages:** Conventional Commits format  
- **Pull Requests:** All changes must go through PR review  

## 4. Environment Variables

**Create a `.env.local` file in each app directory:**

### apps/web/.env.local

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### apps/server/.env

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/meetai
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
JWT_SECRET=your-jwt-secret
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
REFRESH_TOKEN_SECRET=your-refresh-secret
REDIS_URL=redis://localhost:6379
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# AWS S3 (for transcription storage)