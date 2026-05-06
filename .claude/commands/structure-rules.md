# Project Structure Rules (Next.js 15 App Router)

**CRITICAL**: All code changes must follow these structure rules.

## Directory Structure

### Core Directories
- `src/app/` - Next.js App Router pages, layouts, and route handlers
- `src/app/api/` - API routes (route.ts files only)
- `src/app/[feature]/` - Feature-specific pages and components
- `src/components/` - Shared/reusable components ONLY
- `src/lib/` - Business logic, utilities, services, database
- `src/stores/` - Zustand state management
- `src/hooks/` - Custom React hooks
- `src/types/` - TypeScript type definitions
- `src/lib/queries/` - Database query functions organized by domain

### File Placement Rules

**1. Feature Co-location**
- Keep feature-specific components in their feature folders
- Example: `src/app/goals/GoalsList.tsx` NOT `src/components/GoalsList.tsx`
- Only move components to `src/components/` if used in 3+ features

**2. Business Logic**
- ALL utilities, helpers, and business logic go in `src/lib/`
- Database connections: `src/lib/database.ts`, `src/lib/project_database.ts`
- Managers/Services: `src/lib/processManager.ts`, `src/lib/gitManager.ts`
- Query functions: `src/lib/queries/[domain]Queries.ts`

**3. API Routes**
- Follow Next.js conventions: `src/app/api/[resource]/route.ts`
- Group related routes: `src/app/api/contexts/route.ts`, `src/app/api/contexts/[id]/route.ts`

**4. State Management**
- Each store manages one domain: `src/stores/activeProjectStore.ts`
- Use Zustand for global state, React hooks for component state

## Anti-Patterns (DO NOT USE)

❌ `src/pages/**` - Use App Router (`src/app/`) instead of Pages Router
❌ `src/utils/**` - Use `src/lib/` for consistency
❌ `src/helpers/**` - Use `src/lib/` for consistency
❌ `src/components/[Feature]*.tsx` - Use `src/app/[feature]/` for feature-specific components

## Before Adding/Moving Files

1. **Check if the file is feature-specific** → Use `src/app/[feature]/`
2. **Check if it's business logic** → Use `src/lib/`
3. **Check if it's truly shared** → Only then use `src/components/`
4. **Check if it's an API route** → Use `src/app/api/`

## Examples

✅ Good:
- `src/app/goals/GoalsList.tsx - Feature-specific component`
- `src/app/goals/GoalsDetailModal.tsx - Feature-specific modal`
- `src/lib/database.ts - Database connection`
- `src/lib/queries/goalQueries.ts - Goal-related queries`
- `src/components/ui/Button.tsx - Truly shared UI component`

❌ Bad:
- `src/components/GoalsList.tsx - Should be in `src/app/goals/``
- `src/utils/formatDate.ts - Should be `src/lib/formatDate.ts``
- `src/pages/index.tsx - Should use App Router`

## Enforcement

Before creating or moving any file, verify it follows these rules. Use Structure Scan to detect violations.
