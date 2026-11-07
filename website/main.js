const translations = {
  en: {
    shotTask:'Task workspace', shotChanges:'Files & changes', shotTerminal:'Terminal', enlarge:'View larger ↗',
    captureCaption:'Real app capture · Mint palette in development · Example data', captureTitle:'Inside the real Yolu app',
    skip: 'Skip to main content', navFeatures: 'Features', navWorkflow: 'How it works', navSource: 'Open source',
    eyebrow: 'YOUR LOCAL DEVELOPMENT WORKSPACE',
    heroTitle: 'Good work starts<br>with a little<br>clarity<span class="mint-period">.</span>',
    heroDescription: 'Projects, branches, terminals, AI conversations.<br>Bring your development context together in Yolu.<br>Less switching. More making.',
    getYolu: 'Get Yolu', seeWorkflow: 'Explore the workspace', platformNote: 'macOS · Windows · Linux', licenseNote: 'Apache 2.0 open source',
    tasks: 'Tasks', projects: 'Projects', conversations: 'Conversations', inProgress: 'IN PROGRESS',
    taskCheckout: 'Refine checkout', taskApi: 'Optimize the API', taskTheme: 'Explore dark mode',
    overview: 'Overview', changes: 'Changes', terminal: 'Terminal', continueConversation: 'Continue with Codex',
    contextReady: 'Context is ready', demoCaption: 'Interactive illustration · Try the tasks and tabs',
    diffNote: 'Review each change in the context of your task.',
    principleOne: 'Start with a task', principleTwo: 'Bring repositories together', principleThree: 'Stay in control, locally', principleFour: 'Keep your favorite tools',
    featuresEyebrow: 'A PLACE FOR YOUR DEVELOPMENT CONTEXT', featuresTitle: 'One task. Many projects.<br>A clear place to work.',
    featuresIntro: 'A feature rarely lives in a single repository.<br>Yolu brings the directories, branches, and tools together,<br>so you know where you are — and where to go next.',
    featureOneTitle: 'One goal, across every repository.', featureOneBody: 'Connect projects to a task. Create isolated Git worktrees or reuse existing directories. Keep cross-project work connected to a clear goal.',
    taskWorkspace: 'Task workspace', taskNotes: 'Goal & notes', featureTwoTitle: 'See what changed. At a glance.',
    featureTwoBody: 'Actual branches, local changes, upstream status, and diffs. Check the state of your Git work right from the task before taking the next step.',
    gitFooter: 'From reviewing changes to preparing a commit.', featureThreeTitle: 'Tools ready. Train of thought intact.',
    featureThreeBody: 'Open a terminal, editor, or Codex conversation in the right directory. Keep your work in tabs and panes, ready for when you return.',
    workflowEyebrow: 'FROM AN IDEA TO YOUR NEXT COMMIT', workflowTitle: 'Make room for the work<br>you came here to do.', readGuide: 'Read the user guide',
    stepOneTitle: 'Bring your projects', stepOneBody: 'Register your existing Git repositories. Your projects stay in the local environment you already use.',
    stepTwoTitle: 'Give your goal a task', stepTwoBody: 'Describe the goal, pick the participating projects, and prepare a branch and working directory for each.',
    stepThreeTitle: 'Find your focus. Start building.', stepThreeBody: 'Review changes, open a terminal, or continue a conversation. Come back to the same task when you are ready.',
    sourceEyebrow: 'LOCAL FIRST. OPEN SOURCE.', sourceTitle: 'Your workspace.<br>Your way forward.',
    sourceBody: 'Application records stay local. Repositories stay in your environment.<br>Yolu is open source under the Apache 2.0 license.<br>Use it, explore the code, and help make it better.', exploreSource: 'Explore the source',
    faqEyebrow: 'BEFORE YOU BEGIN', faqTitle: 'A few things to know.',
    faqOneQ: 'How does Yolu fit with my editor?', faqOneA: 'Yolu organizes tasks, their projects, working directories, and development tools. Keep using your favorite editor and enter the right working environment directly from a task.',
    faqTwoQ: 'What do I need to install?', faqTwoA: 'Install a Yolu package matching your system and processor, and Git in the environment where your repositories live. For integrated Codex conversations, install and authenticate the Codex CLI in that same environment. Installed Yolu packages do not require Go, Rust, or Node.js.',
    faqThreeQ: 'Which account do AI conversations use?', faqThreeA: 'Integrated conversations use the Codex CLI installed and authenticated in the selected environment, with that environment’s account and provider configuration. Model access, network requests, and costs depend on your account and settings. Other CLIs launched in terminals use their own authentication.',
    faqFourQ: 'Can I work inside WSL on Windows?', faqFourA: 'Yes. The Windows app can connect to a WSL distribution and user to execute Git and file operations there. Each task belongs to one execution environment; local and WSL projects are organized separately.',
    downloadEyebrow: 'MAKE ROOM FOR FOCUS.', downloadTitle: 'Your next good idea<br>starts here.', downloadBody: 'Give your development work a clearer starting point.',
    releaseNote: 'Available builds and installation notes are listed on GitHub Releases.', footerTagline: 'Less switching. More making.', documentation: 'Docs', feedback: 'Feedback',
  },
};

const chinese = {};
document.querySelectorAll('[data-i18n]').forEach(element => { chinese[element.dataset.i18n] = element.innerHTML; });
translations.zh = chinese;
let language = 'zh';
let currentShot = 'task';
let currentPlatform = /Windows/i.test(navigator.userAgent) ? 'windows' : /Linux/i.test(navigator.userAgent) ? 'linux' : 'macos';
let copyFeedbackTimer;
const captures = {
 task:{file:'task-workspace.jpg',zh:'Yolu 实际任务工作区：任务列表、目标与两个关联项目',en:'Actual Yolu task workspace with the task list, goal, and two linked projects'},
 changes:{file:'changes.jpg',zh:'Yolu 实际文件与改动查看器：示例项目的 Git 差异',en:'Actual Yolu file and change viewer with a sample project Git diff'},
 terminal:{file:'terminal.jpg',zh:'Yolu 实际终端：在任务工作目录中运行 Git 命令',en:'Actual Yolu terminal running Git commands in the task working directory'},
};
function renderCapture() {
 const capture=captures[currentShot];
 for(const id of ['app-screenshot','large-screenshot']) {
   const image=document.getElementById(id); image.src='./assets/'+capture.file; image.alt=capture[language];
 }
 document.querySelectorAll('[data-shot]').forEach(button => {const selected=button.dataset.shot===currentShot;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
 document.getElementById('screenshot-panel').setAttribute('aria-labelledby','shot-'+currentShot);
}
function renderPlatform() {
 const platforms={macos:{name:'macOS',description:'Apple Silicon / Intel · DMG'},windows:{name:'Windows',description:'Windows 10 / 11 · x64 · NSIS'},linux:{name:'Linux',description:'x64 · DEB / AppImage'}};
 const platform=platforms[currentPlatform];
 document.getElementById('download-label').textContent=language==='zh'?'查看 '+platform.name+' 安装包':'Find Yolu for '+platform.name;
 document.getElementById('platform-description').textContent=platform.description;
 document.querySelectorAll('[data-platform]').forEach(button=>{const selected=button.dataset.platform===currentPlatform;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
 document.getElementById('platform-panel').setAttribute('aria-labelledby','platform-'+currentPlatform);
}
function setLanguage(next) {
 language=next;document.documentElement.lang=language==='zh'?'zh-CN':'en';
 document.querySelectorAll('[data-i18n]').forEach(element=>{const copy=translations[language][element.dataset.i18n];if(copy!==undefined)element.innerHTML=copy;});
 document.title=language==='zh'?'Yolu — 开发，从一个清晰的任务开始':'Yolu — A clearer place for your development work';
 const description=language==='zh'?'Yolu 是以任务为中心的本地开发工作台。把多个项目、Git worktree、终端和 Codex 对话放在同一个上下文里，让开发从容开始。':'Yolu is a local, task-centered desktop workspace. Bring repositories, Git worktrees, terminals, and Codex conversations into one clear development context.';
 document.querySelector('meta[name="description"]').content=description;document.querySelector('meta[property="og:title"]').content=document.title;document.querySelector('meta[property="og:description"]').content=description;
 const languageButton=document.getElementById('language');
 languageButton.innerHTML=language==='zh'?'EN <span aria-hidden="true">↗</span>':'中文 <span aria-hidden="true">↗</span>';
 languageButton.setAttribute('aria-label',language==='zh'?'Switch to English':'切换为中文');
 const copyButton=document.getElementById('copy-clone');copyButton.setAttribute('aria-label',language==='zh'?'复制克隆命令':'Copy clone command');copyButton.title=copyButton.getAttribute('aria-label');
 const enlarge=document.getElementById('enlarge-screenshot');enlarge.setAttribute('aria-label',language==='zh'?'放大应用截图':'Enlarge application screenshot');enlarge.title=enlarge.getAttribute('aria-label');
 document.getElementById('close-screenshot').setAttribute('aria-label',language==='zh'?'关闭截图':'Close screenshot');
 document.getElementById('copy-status').textContent='';
 try{localStorage.setItem('yolu-site-language',language);}catch{}
 renderCapture();renderPlatform();
}
document.getElementById('language').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'));
document.querySelectorAll('[data-shot]').forEach(button=>button.addEventListener('click',()=>{currentShot=button.dataset.shot;renderCapture();}));
document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{currentPlatform=button.dataset.platform;renderPlatform();}));
document.querySelectorAll('[role="tablist"]').forEach(tablist=>tablist.addEventListener('keydown',event=>{
 const tabs=[...tablist.querySelectorAll('[role="tab"]')];const index=tabs.indexOf(document.activeElement);if(index<0)return;
 let next;if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%tabs.length;if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index-1+tabs.length)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next===undefined)return;
 event.preventDefault();tabs[next].focus();tabs[next].click();
}));
const screenshotDialog=document.getElementById('screenshot-dialog');
for(const id of ['enlarge-screenshot','screenshot-details'])document.getElementById(id).addEventListener('click',()=>screenshotDialog.showModal());
document.getElementById('close-screenshot').addEventListener('click',()=>screenshotDialog.close());
screenshotDialog.addEventListener('click',event=>{if(event.target===screenshotDialog)screenshotDialog.close();});
document.getElementById('copy-clone').addEventListener('click',async()=>{
 const status=document.getElementById('copy-status');
 try{await navigator.clipboard.writeText('git clone https://github.com/nite0x/yolu.git');status.textContent=language==='zh'?'已复制，去终端开始吧。':'Copied. Your terminal is ready when you are.';}
 catch{status.textContent=language==='zh'?'请选中上方命令并复制。':'Select and copy the command above.';const range=document.createRange();range.selectNodeContents(document.querySelector('.clone-command code'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
 clearTimeout(copyFeedbackTimer);copyFeedbackTimer=setTimeout(()=>{status.textContent='';},5000);
});
let storedLanguage;try{storedLanguage=localStorage.getItem('yolu-site-language');}catch{}
setLanguage(storedLanguage==='en'?'en':'zh');
