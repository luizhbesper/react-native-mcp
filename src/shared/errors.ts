// spec: 000 — stable error codes + the structured error envelope
export type ErrorCode =
  // gating / environment (spec 002)
  | 'IOS_UNAVAILABLE'
  | 'ANDROID_UNAVAILABLE'
  | 'PROJECT_NOT_FOUND'
  // devices (specs 010-013)
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_NOT_BOOTED'
  | 'BOOT_TIMEOUT'
  | 'EMULATOR_BINARY_MISSING'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_PLATFORM_MISMATCH'
  | 'INSTALL_FAILED'
  | 'APP_NOT_INSTALLED'
  | 'SCREENSHOT_FAILED'
  // runtime bridge (specs 020-023)
  | 'METRO_NOT_RUNNING'
  | 'NO_TARGETS'
  | 'TARGET_AMBIGUOUS'
  | 'DEBUGGER_OCCUPIED'
  | 'INVALID_REGEX'
  | 'EVALUATE_TIMEOUT'
  | 'EVALUATE_EXCEPTION'
  // build (specs 030-032)
  | 'JOB_NOT_FOUND'
  | 'PREBUILD_REQUIRED'
  | 'WORKSPACE_NOT_FOUND'
  | 'BUILD_ALREADY_RUNNING'
  | 'POD_INSTALL_FAILED'
  | 'LOG_NOT_FOUND'
  | 'LOG_TOO_LARGE'
  | 'INVALID_INPUT'
  // catch-all
  | 'COMMAND_FAILED'
  | 'INTERNAL_ERROR';

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly remediation: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    remediation: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.remediation = remediation;
    this.details = details;
  }
}
