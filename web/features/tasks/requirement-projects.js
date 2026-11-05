'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

let requirementProjectsID = null;

function openRequirementProjects(id) {
  if (state.busy) return;
  const q = state.requirements.find(q => q.id === id);
  if (!q || q.state === 'archived' || q.state === 'creating') return;
  requirementProjectsID = id;
  resetTaskProjectPicker('#requirementProjectPicker');
  $('#requirementProjectsError').hidden = true;
  $('#requirementProjectPicker').innerHTML = '';
  $('#requirementProjectsDialog').showModal();
  refreshRequirementProjectPicker();
}

function refreshRequirementProjectPicker(selectID = null) {
  if (!$('#requirementProjectsDialog').open) return;
  const q = state.requirements.find(q => q.id === requirementProjectsID);
  if (!q) { $('#requirementProjectsDialog').close(); return; }
  const selected = new Set([...$('#requirementProjectPicker').querySelectorAll('input[name="project_ids"]:checked')].map(i => i.value));
  if (selectID) selected.add(selectID);
  const available = state.projects.filter(p => !q.members.some(m => m.project_id === p.id));
  $('#requirementProjectsDescription').textContent = uiText("为“{0}”添加 {1} 中的项目，可使用已有目录或新建工作目录。最多关联 30 个项目，当前已有 {2} 个。", q.name, environmentName(), q.members.length);
  renderTaskProjectPicker('#requirementProjectPicker', available, selected, activeEnvironment, q.branch || 'codex/' + q.slug);
  updateRequirementProjectsPreview();
}

function updateRequirementProjectsPreview() {
  const q = state.requirements.find(q => q.id === requirementProjectsID);
  if (!q) return;
  const selected = [...$('#requirementProjectPicker').querySelectorAll('input[name="project_ids"]:checked:not(:disabled)')].map(i => state.projects.find(p => p.id === i.value)).filter(Boolean);
  const members = taskPickerSelection('#requirementProjectPicker');
  $('#requirementProjectsPreview').textContent = members.length ? members.map(m => {
    const p = state.projects.find(p => p.id === m.project_id);
    return taskCreatesWorktree(m.mode) ? workspaceDisplayPath(q.path, p.folder) + uiText("（新建 · ") + (m.branch || uiText("请选择分支")) + '）' : m.mode === 'project' ? p.path + uiText("（项目原目录）") : m.path || uiText("请选择已有 Worktree");
  }).join('\n') : uiText("请选择要添加的项目");
  $('#requirementProjectsSubmit').disabled = !selected.length || q.members.length + selected.length > 30 || q.state === 'archived' || q.state === 'creating' || !taskProjectPickerReady('#requirementProjectPicker');
}

$('#registerRequirementProject').addEventListener('click', () => openProject(id => refreshRequirementProjectPicker(id)));
$('#requirementProjectPicker').addEventListener('input', event => { taskProjectPickerInput('#requirementProjectPicker', event); updateRequirementProjectsPreview(); });
$('#requirementProjectPicker').addEventListener('change', event => { taskProjectPickerInput('#requirementProjectPicker', event); updateRequirementProjectsPreview(); });
$('#requirementProjectPicker').addEventListener('click', event => {
  const id = event.target.dataset.choiceRetry;
  if (id) { delete taskProjectPickers.get('#requirementProjectPicker').choices.get(id).error; refreshRequirementProjectPicker(); }
});
$('#requirementProjectsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || $('#requirementProjectsSubmit').disabled) return;
  const id = requirementProjectsID;
  const project_ids = [...$('#requirementProjectPicker').querySelectorAll('input[name="project_ids"]:checked:not(:disabled)')].map(i => i.value);
  $('#requirementProjectsSubmit').disabled = true;
  try {
    await mutation(uiText("正在添加项目并准备工作目录"), async () => {
      const q = await api(`/api/requirements/${encodeURIComponent(id)}/projects`, { method: 'POST', body: JSON.stringify({ project_ids, members: taskPickerSelection('#requirementProjectPicker') }) });
      state.requirements = state.requirements.map(current => current.id === id ? q : current);
      $('#requirementProjectsDialog').close();
      toast(q.state === 'ready' ? uiText("项目已添加，全部项目已就绪") : uiText("项目已关联，仍有未就绪项目，可重试失败项"), q.state !== 'ready');
    }, $('#requirementProjectsError'));
  } finally { updateRequirementProjectsPreview(); }
});
