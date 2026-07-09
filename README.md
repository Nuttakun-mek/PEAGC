# PEAGC

PEA Golf Club (PEAGC) is a Thai-first responsive web application for golf club operations: members, events, registration, payment review, pairing, competition scoring, and future academy workflows.

## Current Scope

This repository is starting with Foundation + MVP 1.

- Foundation: Next.js App Router, TypeScript, Tailwind CSS, responsive admin shell
- Auth: Supabase SSR clients, Google/magic-link login, temporary bypass, protected setup bootstrap
- MVP 1: Employee verification, Member Management, and Event Management started; Registration, Payment Slip Review, Pairing, Check-in, Excel Export next
- Later: Basic Competition, Rule Builder, Smart Score OCR, Academy, Finance, Sponsor, Analytics

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL/Auth/Storage planned
- Vercel deployment planned

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Files

- `src/app/page.tsx` - PEAGC dashboard shell
- `src/app/login` - Supabase magic-link login
- `src/app/member` - member portal preview
- `src/app/admin` - admin portal preview
- `src/app/admin/employees` - employee directory used to verify member applications
- `src/app/admin/events` - admin event list, search, create, and edit workflow
- `src/app/admin/members` - admin member list, search, add, and edit workflow
- `src/app/profile` - member personal profile form
- `src/app/setup` - one-time club admin bootstrap
- `docs/PROJECT_KICKOFF_PLAN.md` - project kickoff plan from the source PRD
- `docs/SUPABASE_SETUP.md` - Supabase environment and migration workflow
- `docs/DATABASE_FOUNDATION_DRAFT.sql` - Supabase foundation schema draft
- `supabase/migrations` - versioned Supabase database migrations
- `.env.example` - required environment variable template

## Notes

- Do not commit real secrets.
- OCR and advanced Rule Builder are intentionally out of the first MVP.
- Critical data such as payments, scores, rules, and published results must be audit logged.
- Supabase foundation migration has been pushed to the remote project.
