<!-- What changed about the world, not which files you touched. -->

## What this changes

## Why

---

- [ ] `npm --prefix server test` green
- [ ] `npm --prefix server run typecheck` green
- [ ] `npm --prefix app run typecheck` green
- [ ] New behaviour has a test — and if this is a bug fix, the test was written
      first and watched to fail
- [ ] New table added to `OWNED_TABLES` in `server/src/__tests__/tenancy.test.ts`
- [ ] Migration is additive: no `drop`, no `truncate`, no in-place rewrite
- [ ] New user-facing strings are in `app/src/lib/locale.ts`, German **and**
      English
- [ ] New tool is declared in `llm/tools.ts` and dispatches to an existing
      service — not a second write path
- [ ] Native capability touched? Read `docs/deploy.md` § "Adding a native
      capability" **before** building

**What I did not test:**
