'use strict';
// Typed controllers own async state; this bridge supplies the environment and
// existing request/mutation ports after the page's native controls are mounted.
const workspaceReviewController = window.WorkHubUI.createWorkspaceReviewController({
  document,
  environment: () => activeEnvironment,
  request: api,
  mutation,
  toast,
  reviewMarkup: window.WorkHubUI.workspaceReview,
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  if (button.dataset.action === 'workspace-review') workspaceReviewController.openReview(button.dataset.id);
  if (button.dataset.action === 'changes-open') workspaceReviewController.openChanges(button.dataset.id, button.dataset.path);
});
