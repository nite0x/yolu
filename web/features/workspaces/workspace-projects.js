'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

let workspaceProjectsID = null;

function openWorkspaceProjects(id) {
  if (state.busy) return;
  const q = state.workspaces.find(q => q.id === id);
  if (!q || q.state === 'archived' || q.state === 'creating') return;
  workspaceProjectsID = id;
  resetWorkspaceProjectPicker('#workspaceProjectPicker');
  $('#workspaceProjectsError').hidden = true;
  $('#workspaceProjectPicker').innerHTML = '';
  $('#workspaceProjectsDialog').showModal();
  refreshWorkspaceProjectPicker();
}

function refreshWorkspaceProjectPicker(selectID = null) {
  if (!$('#workspaceProjectsDialog').open) return;
  const q = state.workspaces.find(q => q.id === workspaceProjectsID);
  if (!q) { $('#workspaceProjectsDialog').close(); return; }
  const selected = new Set([...$('#workspaceProjectPicker').querySelectorAll('input[name="project_ids"]:checked')].map(i => i.value));
  for (const id of Array.isArray(selectID) ? selectID : selectID ? [selectID] : []) selected.add(id);
  const available = state.projects.filter(p => !q.members.some(m => m.project_id === p.id));
  $('#workspaceProjectsDescription').textContent = uiText("为“{0}”添加 {1} 中的项目，可使用已有目录或新建工作目录。最多关联 30 个项目，当前已有 {2} 个。", q.name, environmentName(), q.members.length);
  renderWorkspaceProjectPicker('#workspaceProjectPicker', available, selected, activeEnvironment, q.branch || 'codex/' + q.slug);
  updateWorkspaceProjectsPreview();
}

function updateWorkspaceProjectsPreview() {
  const q = state.workspaces.find(q => q.id === workspaceProjectsID);
  if (!q) return;
  const selected = [...$('#workspaceProjectPicker').querySelectorAll('input[name="project_ids"]:checked:not(:disabled)')].map(i => state.projects.find(p => p.id === i.value)).filter(Boolean);
  const members = workspacePickerSelection('#workspaceProjectPicker');
  $('#workspaceProjectsPreview').textContent = members.length ? members.map(m => {
    const p = state.projects.find(p => p.id === m.project_id);
    return workspaceCreatesWorktree(m.mode) ? workspaceDisplayPath(q.path, p.folder) + uiText("（新建 · ") + (m.branch || uiText("请选择分支")) + '）' : m.mode === 'project' ? p.path + uiText("（项目原目录）") : m.path || uiText("请选择已有 Worktree");
  }).join('\n') : uiText("请选择要添加的项目");
  $('#workspaceProjectsSubmit').disabled = !selected.length || q.members.length + selected.length > 30 || q.state === 'archived' || q.state === 'creating' || !workspaceProjectPickerReady('#workspaceProjectPicker');
}

$('#registerWorkspaceProject').addEventListener('click', () => openProject(id => refreshWorkspaceProjectPicker(id)));
$('#workspaceProjectPicker').addEventListener('input', event => { workspaceProjectPickerInput('#workspaceProjectPicker', event); updateWorkspaceProjectsPreview(); });
$('#workspaceProjectPicker').addEventListener('change', event => { workspaceProjectPickerInput('#workspaceProjectPicker', event); updateWorkspaceProjectsPreview(); });
$('#workspaceProjectPicker').addEventListener('click', event => {
  const id = event.target.dataset.choiceRetry;
  if (id) { delete workspaceProjectPickers.get('#workspaceProjectPicker').choices.get(id).error; refreshWorkspaceProjectPicker(); }
});
$('#workspaceProjectsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || $('#workspaceProjectsSubmit').disabled) return;
  const id = workspaceProjectsID;
  const project_ids = [...$('#workspaceProjectPicker').querySelectorAll('input[name="project_ids"]:checked:not(:disabled)')].map(i => i.value);
  $('#workspaceProjectsSubmit').disabled = true;
  try {
    await mutation(uiText("正在添加项目并准备工作目录"), async () => {
      const q = await api(`/api/workspaces/${encodeURIComponent(id)}/projects`, { method: 'POST', body: JSON.stringify({ project_ids, members: workspacePickerSelection('#workspaceProjectPicker') }) });
      state.workspaces = state.workspaces.map(current => current.id === id ? q : current);
      $('#workspaceProjectsDialog').close();
      toast(q.state === 'ready' ? uiText("项目已添加，全部项目已就绪") : uiText("项目已关联，仍有未就绪项目，可重试失败项"), q.state !== 'ready');
    }, $('#workspaceProjectsError'));
  } finally { updateWorkspaceProjectsPreview(); }
});
