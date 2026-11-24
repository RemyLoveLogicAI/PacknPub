export { run } from "./cli.js";
export { init, UsageError, type InitOptions, type InitResult } from "./init.js";
export {
  doctor,
  formatChecks,
  hasReadmeQuickstart,
  nextAfterDoctor,
  sanitizeText,
  type Check,
  type Status,
} from "./doctor.js";
export { verify } from "./verify.js";
export { detectProject, parseGitHubRemote, type Project } from "./detect.js";
export { render, TARGETS, type Target } from "./templates.js";
