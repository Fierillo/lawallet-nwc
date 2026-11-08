# Walletilla verification: development and promotion

## Responsibilities, not interchangeable green checks

| Layer          | Command (web workspace)                               | What is real / what is doubled                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit           | `pnpm --filter @lawallet-nwc/web test:unit`           | Pure logic/component contracts. Existing explicit collaborator mocks remain. Includes the historical root-level domain-onboarding tests.                                                                           |
| Integration    | `pnpm --filter @lawallet-nwc/web test:integration`    | Existing route contracts, usually Prisma/auth doubles. Asserting a `where` argument is **not** proof that real persistence or authentication is isolated.                                                          |
| Critical flows | `pnpm --filter @lawallet-nwc/web test:critical`       | Real browser storage, stores, backfill, component and API-cache lifecycle. Only session/network boundaries are controlled; unexpected network requests fail. No globally authenticated fixture.                    |
| Database       | `node scripts/verify-database.mjs --base origin/main` | Disposable real PostgreSQL, actual Prisma and handlers, real JWT verification/ownership, DB constraints and migration compatibility. Also activates all twelve pre-existing PostgreSQL suites; no skips permitted. |
| Harness        | `pnpm test:harness`                                   | Git selection, orchestration/failure propagation, migration tripwires, complete project discovery, duplicate-project detection, real runner rejection of empty selections, and coverage gaps.                      |

The ordinary web `test`/`test:coverage` commands run unit, integration and critical projects exactly once. Database tests run separately with their own provisioned fixture; they are **not** silently skipped in pre-main. Existing tests were not deleted or broadly rewritten. Shared recipient-session/storage factories replace duplicate seeds, but never fake the stores or authenticated ownership resolution in the new critical/database contracts.

Previously, one broad Vitest configuration mixed these responsibilities, route mocks concealed ownership/persistence boundaries, 44 PostgreSQL tests were opt-in skips, and coverage-only CI depended on every tested package maintaining a coverage script. All current test packages, including CLI, already have one; a past omission is documented in the existing CI comments. CI repeated installation in five jobs. The new CI retains independent lint and one verification job using the same two profiles as local development. Coverage thresholds/artifacts are preserved on promotion, without executing both uninstrumented and instrumented full suites redundantly.

## Fast development

```sh
COREPACK_HOME=/tmp/walletilla-corepack pnpm verify:dev --base origin/main
```

Fetch the intended base first. A base is mandatory and is resolved to a commit; an absent/invalid base fails, rather than selecting nothing. Selection combines merge-base-to-HEAD commits, **all staged and unstaged changes (even inverse edits that cancel in a net HEAD diff)**, and nonignored untracked files. Filenames use NUL-delimited Git output, not shell splitting.

Every fast run executes harness contracts plus critical recipient/session flows, real-signature Preview-origin invariants and recipient route ownership contracts. Changed tests run directly; Vitest's real import graph selects related source tests. An empty affected suite fails: do not add `--passWithNoTests` to make it green. Write the missing contract or use the full profile while reviewing why selection could not establish coverage.

Config, lockfile, scripts, CI, shared packages, schema/migrations, shared test helpers/setup/database cases, auth/public-origin boundaries, deleted paths and unknown file types conservatively trigger the complete monorepo tests/typecheck plus migration and real PostgreSQL contracts. CSS uses the full fallback too. Markdown/docs changes keep critical invariants and docs validation. Fast is an editing feedback loop, **not promotion approval**, and does not normally build or provision a DB. `--base HEAD` checks current index/worktree edits (only smoke invariants when clean); it must not be used to claim review of already committed branch changes.

## Complete pre-main profile

```sh
COREPACK_HOME=/tmp/walletilla-corepack pnpm verify:pre-main --base origin/main
```

In order:

1. Harness tests, including real Git staged/untracked fixtures and actual Vitest discovery/empty-selection checks.
2. Historical migration immutability and conservative additive-SQL tripwires relative to the explicit base.
3. Complete monorepo **coverage** suites and typecheck, forced execution rather than cached green test output. Every workspace with `test` but no `test:coverage` is discovered from the actual workspace and its tests run separately, so future regressions cannot silently omit a package (current CLI already defines `test:coverage`).
4. A private native PostgreSQL cluster: all 72 historical migrations, representative baseline data, new migrations, column compatibility and data-preservation checks, real JWT→owner→recipient API→Prisma→SQL contracts, plus the twelve existing DB suites. Zero selected/pending DB tests is a failure.
5. Complete monorepo build (including docs), with build-time env validation bypass only; no migrations or deploy command.
6. Docs/OpenAPI drift validation (always, even for a supposedly unrelated patch).

`initdb`, `postgres` and `psql` must be available, unprivileged. The runner discovers `/usr/lib/postgresql/*/bin`, `$WALLETILLA_PG_BIN`, or the shared tools directory (`$HERRAMIENTAS_DIR/postgresql-17.11/bin`). No Docker/service/new credentials are needed. Missing binaries fail closed; the script never installs anything or connects to an operator-supplied production URL. It creates its own temporary database and socket-only cluster, strips inherited libpq routing/service/password variables, overrides DB URLs/secrets **only for its synthetic child process**, waits for readiness, and cleans up that cluster after success/failure. Ubuntu CI runners supply native PostgreSQL. Locally a checksum-verified lightweight 17.11 binary bundle can live once in the shared tools directory; no system service is installed.

CI runs fast on dev/non-main PRs, complete on PRs targeting main, main pushes and manual dispatch. Checkout fetches complete history and passes PR base SHA or push-before SHA explicitly. Invalid/missing history fails. Main-push verification is defense in depth **after** the push, not proof of a pre-promotion gate. This change does not configure repository branch protection; require the Verification check on main PRs separately if policy enforcement is desired. Never promote a different SHA than the clean-tree full run reviewed.

## The privacy regression and legacy strategy

The critical contract persists A's recipient, switches to B **without clearing storage**, verifies that B neither reads nor uploads A's recipients, then returns to A and recovers its history. Other contracts retain unattributed legacy bytes without importing them; reject successful late A profile responses after A→B and A→B→A; exercise real `useApi`/recipient UI with a late A response; discard late LNURL submissions on A→B and A→B→A; detach storage on signed-out resume even if cached pubkey remains; and reject late payment/quote metadata at a changed session boundary. Production AuthProvider wiring is checked separately, not replaced by a global default account fixture.

New contacts, alerts and payment destinations use an authenticated-identity namespace. Session cleanup invalidates memory but preserves each identity's records. Legacy global keys are retained unchanged and inert: there is no trustworthy owner to assign automatically. Exposing/migrating legacy data needs a separate explicit ownership/recovery design. Linked identities may have separate local history namespaces; account-level server contacts remain authoritative. This is application-level view/sync isolation, **not encryption against same-origin scripts, XSS or someone inspecting the same browser profile**. A payment already sent is not reversed/retried when its late UI result is discarded.

## Honest review checklist before promoting main

- [ ] Record fetched base and reviewed commit; rerun complete profile on the final clean committed tree. Review all commits promoted, not only the last staged patch.
- [ ] Review missing/duplicate tests and mock boundaries. Existing route mocks and client-code coverage exclusions are not evidence of real session persistence or authorization.
- [ ] Read the actual auth→account-resolution→query/write path. Inspect owner-controlled fields, delegated scopes and cross-account/cache/session races, including delayed success and error responses.
- [ ] Review migrations for narrowing/truncation/backfills, constraints, ordering, old-writer compatibility and real deployment data. The SQL tripwire is intentionally conservative, **not a SQL parser, exhaustive compatibility proof or human security audit**. Unknown/destructive SQL requires a human decision, never a silent bypass. Historical migrations are not rewritten; previously accepted historical note truncation is not newly approved by this script.
- [ ] Inspect secrets/logging, XSS/URL sinks and dependency advisories. A scanner's exit status is not adversarial review, and a green suite is not a security approval.
- [ ] Record a separate local security review with severity, evidence, proposed fixes and limits. Stop on unresolved high/critical findings. Obtain the owner's promotion approval; never label an automated review as a human audit.
- [ ] Confirm Preview health and deployment DB strategy separately. The existing Playwright CI (`e2e.yml`, unchanged, using its existing PostgreSQL service) remains a separate PR/main check. This local profile does not run Playwright or claim WebAuthn/relay/live-payment/live-domain behavior passed, or run payments against real services.

No profile changes `.env`, Vercel variables, main/personalized refs, or production data, or performs a manual deployment. Network/dependency security checks and the independent lint job remain distinct from functional verification.

## Contributor reference retained from the previous guide

The stack remains Vitest 5, happy-dom, Testing Library/jest-dom, MSW and fake-indexeddb; no new test framework was installed. `@/*` resolves to `apps/web/`. Name files `*.test.ts`/`*.test.tsx` and mirror the production path under the appropriate responsibility. The discovery contract fails if a new test falls outside all configured projects or is owned by multiple projects.

| Existing/shared helper                                       | Use and boundary                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tests/helpers/api-helpers.ts`                               | `createNextRequest`, `assertResponse`, `getResponseJson`: actual Request/Response shape.                                       |
| `tests/helpers/route-helpers.ts`                             | `createParamsPromise` for async App Router params; `createDefaultConfig` for focused unit contracts.                           |
| `tests/helpers/fixtures.ts`                                  | Existing model factories; declare fields that the contract depends on rather than coupling to random defaults.                 |
| `tests/helpers/prisma-mock.ts`                               | `prismaMock` / `resetPrismaMock`: query-shape contracts only; its transaction callback is not a database transaction.          |
| `tests/helpers/auth-helpers.ts`                              | Legacy auth stubs and request/payload factories. A stubbed validator must not be counted as an authentication check.           |
| `tests/helpers/recipient-fixtures.ts`                        | Explicit identity switches, namespaced contact seeds, payment data and deferred network replies, using real production stores. |
| `tests/helpers/database-api-fixtures.ts`, `test-database.ts` | Synthetic JWT/config and the runner-owned real SQL client, not Prisma/authenticator stubs.                                     |

Use the existing watch/UI commands (`test:watch`, `test:ui`) for focused work. `vitest run <file>` or `-t <name>` is useful for red/green development, not a substitute for either profile. Keep mocks hoisted before their dependent route loads; logger/config initialization can happen at import time. `vi.clearAllMocks()` clears calls, **not implementations**; `resetPrismaMock()`/`mockReset()` reset stored behavior. Restore env/global/network doubles after every case. Avoid mocking the module under test, and never replace storage/authentication while claiming to verify that boundary. Legacy MSW setup warns on unhandled frames; the critical project deliberately has a stricter network boundary instead of silently reclassifying all existing mocks as real integrations.

Coverage thresholds remain 60% statements / 70% branches / 70% functions / 60% lines. Reports are `apps/web/coverage/index.html` and `lcov.info`. Existing `lib/client/**`, Prisma, config/type and test-file exclusions are not broadened or treated as correctness proof; client correctness is demonstrated by the actual critical contracts. No new regression is skipped or focused. For broader browser and benchmark instructions, retain [TESTING-E2E.md](TESTING-E2E.md) and [BENCHMARK.md](BENCHMARK.md). Examples remain [jwt.test.ts](../apps/web/tests/unit/lib/jwt.test.ts), [cards.test.ts](../apps/web/tests/integration/api/cards.test.ts), and the new critical/database flows.

Obsolete claims from the previous guide (50 files/585 tests, listener as a stub, mock-everything/no-real-DB as a global rule, Codecov upload/secret and assumed branch protection) were intentionally replaced, not retained as misleading instructions. Numeric coverage, artifact upload and branch-protection policy are separate things.

Affected selection includes index changes, but tests execute the working tree, not a hidden copy of the index. Before recording/promoting changes, stage the intended final content and run the complete profile on a clean committed tree.
