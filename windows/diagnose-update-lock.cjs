'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyUpdateLockOwner,
  readWindowsProcessStartTime,
} = require('../native-helper/update_engine.js');

const SAFE_PREINSTALL_PHASES = new Set(['preflight', 'downloading', 'verifying', 'extracting', 'package_verified']);
const TERMINAL_OUTCOMES = new Set(['completed', 'rolled_back', 'failed_before_install']);
const PID_REUSE_TOLERANCE_MS = 5000;

function parseArguments(argv) {
  const parsed = {
    lockPath: path.resolve(__dirname, '..', '.AppraisalToolbox-update.lock'),
    help: false,
    unsupportedApply: false,
    error: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--apply') {
      parsed.unsupportedApply = true;
    } else if (argument === '--lock') {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        parsed.error = 'LOCK_PATH_REQUIRED';
        break;
      }
      parsed.lockPath = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      parsed.error = 'ARGUMENT_UNSUPPORTED';
      break;
    }
  }
  return parsed;
}

function output(value, exitCode = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exitCode = exitCode;
}

function fingerprintNonce(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function safeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value) ? value : null;
}

function readPathStatus(targetPath) {
  const absolute = path.resolve(targetPath);
  const root = path.parse(absolute).root;
  const segments = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { ok: false, code: 'PATH_MISSING', exists: false };
      if (error && error.code === 'EACCES') return { ok: false, code: 'PATH_ACCESS_DENIED', exists: null };
      return { ok: false, code: 'PATH_READ_FAILED', exists: null };
    }
    if (stat.isSymbolicLink()) return { ok: false, code: 'REPARSE_POINT_BLOCKED', exists: true };
    const isFinal = index === segments.length - 1;
    if (isFinal && !stat.isDirectory()) return { ok: false, code: 'LOCK_PATH_NOT_DIRECTORY', exists: true };
    if (!isFinal && !stat.isDirectory()) return { ok: false, code: 'PARENT_PATH_NOT_DIRECTORY', exists: true };
  }
  return { ok: true, code: 'DIRECTORY_PRESENT', exists: true };
}

function readJsonRecord(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'missing', value: null };
    if (error && error.code === 'EACCES') return { status: 'access_denied', value: null };
    return { status: 'read_failed', value: null };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'not_regular_file', value: null };
  if (stat.size > 1024 * 1024) return { status: 'record_too_large', value: null };
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid_record', value: null };
    return { status: 'present', value };
  } catch {
    return { status: 'invalid_json', value: null };
  }
}

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function isVerifiedTerminalState(state) {
  return state && state.recoveryRequired === false
    && state.installerStartPending !== true
    && state.workerStartPending !== true
    && state.recoveryStartPending !== true
    && TERMINAL_OUTCOMES.has(state.terminalOutcome)
    && (!state.installerStarted || state.installerProcess && state.installerProcess.exitObserved === true)
    && (!state.workerProcess || state.workerProcess.exitObserved === true)
    && (!state.recoveryProcess || state.recoveryProcess.exitObserved === true);
}

async function probeProcess(pidValue, expectedStartValue) {
  const pid = Number(pidValue);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { pid: null, status: 'identity_unavailable' };
  }
  let currentStart = null;
  try {
    currentStart = await readWindowsProcessStartTime(pid);
  } catch {
    currentStart = null;
  }
  if (currentStart === 'PROCESS_MISSING') return { pid, status: 'process_missing' };
  const currentMs = Date.parse(currentStart || '');
  if (!Number.isFinite(currentMs)) return { pid, status: 'process_query_unavailable' };
  const expectedMs = Date.parse(expectedStartValue || '');
  if (!Number.isFinite(expectedMs)) return { pid, status: 'process_present_start_unbound' };
  const identityMatches = Math.abs(currentMs - expectedMs) <= PID_REUSE_TOLERANCE_MS;
  return {
    pid,
    status: identityMatches ? 'process_identity_matches' : 'pid_reused_or_identity_mismatch',
  };
}

async function buildDiagnostic(lockPath) {
  const absoluteLockPath = path.resolve(lockPath);
  const checkedPath = readPathStatus(absoluteLockPath);
  const report = {
    schemaVersion: 1,
    mode: 'dry-run-read-only',
    generatedAtUtc: new Date().toISOString(),
    lockPath: absoluteLockPath,
    applySupported: false,
    mutationsPerformed: false,
    path: checkedPath,
    owner: null,
    transaction: null,
    classification: 'manual_review_required',
    processIdentityQueries: [],
    limitations: [
      'This script only diagnoses the supplied lock path and never removes, renames, or writes lock records.',
      'It is a standalone source-side bootstrap diagnostic; a helper already embedded in a SEA does not gain this script automatically.',
      'Legacy owner-only locks have no durable transaction evidence for safe automated recovery.',
    ],
  };
  if (!checkedPath.ok) {
    report.classification = checkedPath.code;
    return report;
  }

  const ownerRecord = readJsonRecord(path.join(absoluteLockPath, 'owner.json'));
  const stateRecord = readJsonRecord(path.join(absoluteLockPath, 'transaction.json'));
  const owner = ownerRecord.value;
  const state = stateRecord.value;

  if (ownerRecord.status !== 'present') {
    report.owner = { status: ownerRecord.status };
  } else {
    const pid = Number(owner.pid);
    const ownerIsValid = Number.isSafeInteger(pid) && pid > 0 && Number.isFinite(Date.parse(owner.startedAtUtc || ''));
    let processStartTimeUtc = null;
    if (ownerIsValid) {
      try { processStartTimeUtc = await readWindowsProcessStartTime(pid); } catch { processStartTimeUtc = null; }
    }
    const ownerStatus = classifyUpdateLockOwner({
      owner,
      processStartTimeUtc,
    });
    const processStatus = ownerStatus.classification === 'owner_pid_reused'
      ? 'pid_reused'
      : processStartTimeUtc === 'PROCESS_MISSING'
      ? 'process_missing'
      : Number.isFinite(Date.parse(processStartTimeUtc || ''))
        ? 'process_present'
        : 'process_query_unavailable';
    const ownerProtocolValid = Number(owner.schemaVersion) === 2;
    report.owner = {
      status: 'present',
      schemaVersion: Number.isSafeInteger(Number(owner.schemaVersion)) ? Number(owner.schemaVersion) : null,
      protocolSchemaValid: ownerProtocolValid,
      pid: ownerIsValid ? pid : null,
      startedAtUtc: Number.isFinite(Date.parse(owner.startedAtUtc || '')) ? owner.startedAtUtc : null,
      noncePresent: typeof owner.nonce === 'string' && owner.nonce.length > 0,
      nonceFingerprint: fingerprintNonce(owner.nonce),
      identityValid: ownerIsValid && typeof owner.nonce === 'string' && owner.nonce.length > 0,
      processStatus,
      processClassification: ownerStatus.classification,
    };
    if (ownerIsValid) {
      report.processIdentityQueries.push({
        role: 'owner',
        pid,
        status: processStatus,
      });
    }
  }

  if (stateRecord.status !== 'present') {
    report.transaction = {
      status: stateRecord.status,
      legacyOwnerOnly: ownerRecord.status === 'present' && owner && owner.schemaVersion === undefined && stateRecord.status === 'missing',
    };
  } else {
    const ownerMatches = ownerRecord.status === 'present'
      && report.owner.identityValid
      && report.owner.protocolSchemaValid
      && Number(state.schemaVersion) === 2
      && Number(state.ownerPid) === Number(owner.pid)
      && state.nonce === owner.nonce
      && state.ownerStartedAtUtc === owner.startedAtUtc;
    const processFields = [
      ['installer', state.installerProcess],
      ['extraction', state.workerProcess],
      ['recovery', state.recoveryProcess],
    ];
    const processes = [];
    for (const [role, processRecord] of processFields) {
      if (!processRecord || typeof processRecord !== 'object') continue;
      const probed = await probeProcess(processRecord.pid, processRecord.spawnedAtUtc);
      processes.push({
        role,
        pid: probed.pid,
        status: probed.status,
        exitObserved: boolOrNull(processRecord.exitObserved),
      });
    }
    report.transaction = {
      status: 'present',
      schemaVersion: Number.isSafeInteger(Number(state.schemaVersion)) ? Number(state.schemaVersion) : null,
      phase: safeToken(state.phase),
      ownerPidMatches: ownerMatches && Number(state.ownerPid) === Number(owner.pid),
      ownerNonceMatches: ownerMatches && state.nonce === owner.nonce,
      ownerStartTimeMatches: ownerMatches && state.ownerStartedAtUtc === owner.startedAtUtc,
      installerStarted: boolOrNull(state.installerStarted),
      installerStartPending: boolOrNull(state.installerStartPending),
      workerStartPending: boolOrNull(state.workerStartPending),
      recoveryStartPending: boolOrNull(state.recoveryStartPending),
      recoveryRequired: boolOrNull(state.recoveryRequired),
      terminalOutcome: TERMINAL_OUTCOMES.has(state.terminalOutcome) ? state.terminalOutcome : null,
      verifiedTerminalState: isVerifiedTerminalState(state),
      processes,
    };
    report.processIdentityQueries.push(...processes.map(item => ({
      role: item.role,
      pid: item.pid,
      status: item.status,
    })));
  }

  const ownerIsDead = report.owner && report.owner.processClassification === 'owner_process_exited';
  const ownerPidReused = report.owner && report.owner.processClassification === 'owner_pid_reused';
  const ownerActive = report.owner && report.owner.processClassification === 'owner_process_active';
  const statePresent = report.transaction && report.transaction.status === 'present';
  const ownerMatchesState = statePresent
    && report.transaction.ownerPidMatches
    && report.transaction.ownerNonceMatches
    && report.transaction.ownerStartTimeMatches;
  const diagnosticTransaction = report.transaction;
  if (ownerActive) {
    report.classification = statePresent && diagnosticTransaction.recoveryRequired === true ? 'active_owner_recovery_in_progress' : 'active_owner';
  } else if (!report.owner || report.owner.status !== 'present' || !report.owner.identityValid) {
    report.classification = 'owner_unverified';
  } else if (ownerPidReused) {
    report.classification = 'owner_pid_reused_manual_review';
  } else if (!statePresent) {
    report.classification = report.transaction.legacyOwnerOnly ? 'legacy_owner_only_manual_review' : 'transaction_unavailable_manual_review';
  } else if (!ownerMatchesState) {
    report.classification = 'owner_transaction_identity_mismatch';
  } else if (diagnosticTransaction.verifiedTerminalState === true) {
    report.classification = 'verified_terminal_state_manual_review';
  } else if (diagnosticTransaction.recoveryRequired === true
    || diagnosticTransaction.installerStartPending === true
    || diagnosticTransaction.installerStarted === true
    || diagnosticTransaction.recoveryStartPending === true
    || diagnosticTransaction.workerStartPending === true
    || diagnosticTransaction.processes.some(item => ['process_identity_matches', 'process_present_start_unbound', 'pid_reused_or_identity_mismatch', 'process_query_unavailable'].includes(item.status) && item.exitObserved !== true)) {
    report.classification = ownerIsDead ? 'dead_owner_recovery_required' : 'transaction_state_requires_recovery';
  } else if (ownerIsDead && SAFE_PREINSTALL_PHASES.has(diagnosticTransaction.phase)
    && diagnosticTransaction.installerStarted === false
    && diagnosticTransaction.installerStartPending === false
    && diagnosticTransaction.recoveryRequired === false) {
    report.classification = 'dead_owner_preinstall_evidence_present_manual_review';
  } else {
    report.classification = 'transaction_state_unverified_manual_review';
  }
  return report;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    output({
      usage: 'node windows/diagnose-update-lock.cjs [--lock <path>] [--help]',
      mode: 'dry-run-read-only',
      applySupported: false,
      note: 'The diagnostic never modifies, removes, or renames a lock. --apply is unsupported.',
    });
    return;
  }
  if (args.unsupportedApply) {
    output({
      schemaVersion: 1,
      mode: 'dry-run-read-only',
      applySupported: false,
      mutationsPerformed: false,
      error: 'APPLY_NOT_SUPPORTED',
      message: 'Legacy lock state is not safe to clear automatically; no apply operation is implemented.',
    }, 2);
    return;
  }
  if (args.error) {
    output({
      schemaVersion: 1,
      mode: 'dry-run-read-only',
      applySupported: false,
      mutationsPerformed: false,
      error: args.error,
    }, 2);
    return;
  }
  output(await buildDiagnostic(args.lockPath));
}

main().catch(() => {
  output({
    schemaVersion: 1,
    mode: 'dry-run-read-only',
    applySupported: false,
    mutationsPerformed: false,
    error: 'DIAGNOSTIC_FAILED',
  }, 1);
});
