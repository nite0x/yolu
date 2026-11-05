'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

const params = new URLSearchParams(location.search);
if (params.has('error')) {
  document.getElementById('title').textContent = uiText("暂时无法打开工作台");
  document.getElementById('message').textContent = params.get('error');
}
