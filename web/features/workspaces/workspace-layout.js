'use strict';

// Workspace refreshes preserve the workspace's working position. Conversations have
// their own shared host and never participate in the workspace's layout.
const workspaceDetailMemory = new Map();
let workspaceDetailCurrent = null;
function saveWorkspaceDetail() {
  if (!workspaceDetailCurrent) return;
  workspaceDetailCurrent.scrollTop = $('#workspaceProjectsView').scrollTop;
  workspaceDetailCurrent.details = [...document.querySelectorAll('#content details[data-workspace-detail][open]')].map(node => node.dataset.workspaceDetail);
  workspaceDetailMemory.set(workspaceDetailCurrent.key, workspaceDetailCurrent);
}
function suspendWorkspaceDetail() { saveWorkspaceDetail(); workspaceDetailCurrent = null; }
function syncWorkspaceDetail(workspace) {
  if (!workspace) { workspaceDetailCurrent = null; return; }
  const key = JSON.stringify([activeEnvironment, workspace.id]);
  workspaceDetailCurrent = workspaceDetailMemory.get(key) || { key, scrollTop: 0, details: [] };
  $('#workspaceProjectsView').scrollTop = workspaceDetailCurrent.scrollTop;
  document.querySelectorAll('#content details[data-workspace-detail]').forEach(node => { node.open = workspaceDetailCurrent.details.includes(node.dataset.workspaceDetail); });
  window.WorkHubAssistant?.updateWorkspace?.(workspace);
}
$('#workspaceProjectsView').addEventListener('scroll', saveWorkspaceDetail, { passive: true });
window.addEventListener('pagehide', saveWorkspaceDetail);
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.workspace-more[open]')) if (!menu.contains(event.target)) menu.open = false;
});
