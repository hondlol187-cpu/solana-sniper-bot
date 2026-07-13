import type { RouteAssessment } from './route-policy.js';
import type { ApprovedCandidateAssessment } from './approved-candidate-policy.js';

/**
 * Fail-closed gate for approved execution plan creation.
 *
 * Throws when either the route assessment or the approval assessment
 * rejects the candidate. Callers MUST invoke this BEFORE any call to
 * writeApprovedExecutionPlan(...) so that no plan file is persisted,
 * no plan ID is issued, and no success audit is emitted for a
 * rejected candidate.
 *
 * The audit log entry for the rejection (event
 * `candidate.execution.plan-rejected`) is the caller's responsibility,
 * so that the audit shape can include the rejection reasonType
 * explicitly. This helper is intentionally side-effect free so it can
 * be unit-tested in isolation.
 */
export function assertPlanCanBeWritten(
  routeAssessment: RouteAssessment,
  approvalAssessment: ApprovedCandidateAssessment
): void {
  if (!routeAssessment.ok) {
    throw new Error(
      [
        'Quote route does not bind to the approved pool.',
        ...routeAssessment.reasons,
      ].join(' ')
    );
  }

  if (!approvalAssessment.ok) {
    throw new Error(
      [
        'Approved candidate policy checks failed.',
        ...approvalAssessment.reasons,
      ].join(' ')
    );
  }
}
