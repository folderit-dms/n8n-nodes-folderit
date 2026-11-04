# Connector Review Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task.

**Goal:** Correct both n8n review findings without dropping custom-deployment routing or saved workflow safeguards.

**Architecture:** folderitApi extends the built-in oAuth2Api grant. Authenticated requests use the documented n8n helper, while Options values have backwards-compatible fallbacks for old exports.

**Tech Stack:** TypeScript, n8n-node CLI, Node test runner; existing installed dependencies only.

**Spec:** docs/superpowers/specs/2026-11-03-connector-review-design.md

## Global Constraints
- Legacy folderitOAuth2Api remains unchanged. No credentials extracted or new external access created.
- No npm publication, customer writes or Cloud package installation. After native acceptance, prepare a versioned candidate for separate user release approval.
- Preserve private deployment credentials and intentional uncertain-send quarantines.
- Native local acceptance and provider acceptance are distinct claims.

## Review Focus
- Invalid API URL must fail before a credential request targets an unintended host.
- Explicit account selection must reject a different node-level account before sending.
- A credential saved by 0.5.0 must not silently retarget its bound deployment/account.
- Old top-level Version UID/Expected Connection Scope must remain effective after upgrade.
- No automatic retry of an ambiguous write or credential forwarding to signed storage.

### Task 1: Built-in OAuth2 credential and deployment request boundary
**Files:** credentials/FolderitApi.credentials.ts; nodes/Folderit/{api,deployment,discovery,connection-test}.ts; Folderit*.node.ts; tests/deployment.test.cjs
**Interfaces:** existing folderitApi name and fields; built-in oAuth2Api grant/clientCredentials; connectionDeployment/resolveAccount/api/storageRequest contracts preserved.
- [x] Write/run regression tests for derived cloud/custom token URLs, invalid URL rejection, first-save credential test, account guard, old credential binding, node helper routing, storage credential isolation and safe write retries. Watch relevant failures.
- [x] Replace manual OAuth/session exchange with inherited OAuth2 and standard test; simplify request transport without changing deployment/account identities. Remove testedBy adapter.
- [x] Run build, focused tests, then complete suite.
- [x] Commit focused correction with evidence.

### Task 2: Optional field placement and compatibility
**Files:** nodes/Folderit/Folderit.node.ts; tests/{folderit,deployment}.test.cjs; relevant deployment-aware examples and README.
**Interfaces:** options.versionUid and options.expectedConnectionScope; old top-level values still honored when an Options value is absent.
- [x] Write/run failures for nested exact-version behavior, old export compatibility, explicit empty Options override and mismatched nested scope before writes.
- [x] Add collection UI and execution compatibility; update only affected deployment-aware examples/instructions.
- [x] Run build, focused and complete tests plus lint/package validation.
- [x] Perform fresh native import/readback where available; document unverified live acceptance honestly.
- [x] Commit and review entire branch; save concrete release candidate and remaining approval/testing gates.

Native acceptance completed on 3 November 2026. The user explicitly approved the standard OAuth2 access model. Native token URL defaults require $self, while standard credential request expressions use $credentials; a failing then passing full Workflow regression covers this distinction. 111 tests/build/lint and independent review pass. Remote CI and release approval are tracked separately in the delivery evidence. No publication was performed.
