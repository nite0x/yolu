'use strict';

// Run before styles and deferred controllers: an embedded conversation must
// never paint the ordinary sidebar/list layout while waiting for its host.
(() => {
  const params = new URLSearchParams(location.search), root = document.documentElement;
  if (!params.has('workspace-page')) return;
  if (params.get('workspace-desktop') === '1') {
    root.setAttribute('data-workhub-desktop','');
    const inset = Number(params.get('workspace-sidebar-inset'));
    if (inset === 0 || inset === 48) root.style.setProperty('--workspace-sidebar-inset',inset + 'px');
  }
  root.setAttribute('data-workspace-page','');
  root.toggleAttribute('data-workspace-navigation',params.has('workspace-navigation'));
  root.toggleAttribute('data-workspace-conversation',params.has('workspace-conversation'));
  root.toggleAttribute('data-workspace-pane',params.has('workspace-pane'));
  if (location.hash === '#/sessions') root.setAttribute('data-workspace-initial-route','sessions');
  const listWidth = Number(params.get('workspace-list-width'));
  if (listWidth >= 220 && listWidth <= 520) root.style.setProperty('--workspace-shared-list-width',listWidth + 'px');
  const sidebarWidth = Number(params.get('workspace-sidebar-width'));
  if (sidebarWidth >= 60 && sidebarWidth <= 520) root.style.setProperty('--workspace-navigation-left',sidebarWidth + 'px');
  performance.mark?.('workhub:page-bootstrap');
})();
