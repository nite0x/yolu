const translations = {
  en: {
    shotConversation:'Conversation', shotChanges:'Files & changes', shotTerminal:'Terminal', enlarge:'View larger ↗',
    captureCaption:'Real app capture · Mint palette in development · Example data', captureTitle:'Inside the real Yolu app',
    skip: 'Skip to main content', navFeatures: 'Features', navWorkflow: 'How it works', navSource: 'Open source',
    eyebrow: 'LOCAL AI DEVELOPMENT',
    heroTitle: 'Open a project.<br>Start a conversation<span class="mint-period">.</span>',
    heroDescription: 'Add projects and local directories as you work. See their branches, permissions and changes in one conversation.',
    getYolu: 'Get Yolu', seeWorkflow: 'Explore the conversation', platformNote: 'macOS · Windows · Linux', licenseNote: 'Apache 2.0 open source',
    principleOne: 'Start from a project', principleTwo: 'Bring repositories together', principleThree: 'Stay in control, locally', principleFour: 'Keep your favorite tools',
    featuresEyebrow: 'A PLACE FOR YOUR DEVELOPMENT CONTEXT', featuresTitle: 'One conversation, several projects',
    featuresIntro: 'A feature rarely lives in a single repository.<br>Yolu brings the directories, branches, and tools together,<br>so you know where you are — and where to go next.',
    featureOneTitle: 'One goal, across every repository.', featureOneBody: 'Attach projects to a conversation. Reuse existing checkouts or create independent Git worktrees for parallel development.',
    conversationLabel: 'Conversation', readAccess: 'Read only', featureTwoTitle: 'See what changed. At a glance.',
    featureTwoBody: 'Actual branches, local changes, upstream status, and diffs. Inspect Git status from the conversation or the project.',
    gitFooter: 'From reviewing changes to preparing a commit.', featureThreeTitle: 'Tools ready. Train of thought intact.',
    featureThreeBody: 'Open a terminal, editor, or Codex conversation in the right directory. Keep your work in tabs and panes, ready for when you return.',
    workflowEyebrow: 'FROM AN IDEA TO YOUR NEXT COMMIT', workflowTitle: 'Make room for the work<br>you came here to do.', readGuide: 'Read the user guide',
    stepOneTitle: 'Bring your projects', stepOneBody: 'Register your existing Git repositories. Your projects stay in the local environment you already use.',
    stepTwoTitle: 'Start from a project', stepTwoBody: 'Use the current checkout, choose an existing worktree or create an independent one.',
    stepThreeTitle: 'Find your focus. Start building.', stepThreeBody: 'Attach other projects or directories, inspect the changes and open the terminal when you need it.',
    sourceEyebrow: 'LOCAL FIRST. OPEN SOURCE.', sourceTitle: 'Local projects.<br>Local conversation records.',
    sourceBody: 'Application records stay local. Repositories stay in your environment.<br>Yolu is open source under the Apache 2.0 license.<br>Use it, explore the code, and help make it better.', exploreSource: 'Explore the source',
    faqEyebrow: 'BEFORE YOU BEGIN', faqTitle: 'A few things to know.',
    faqOneQ: 'How does Yolu fit with my editor?', faqOneA: 'Yolu keeps project and directory context for development conversations. Open your preferred editor in the selected project directory.',
    faqTwoQ: 'What do I need to install?', faqTwoA: 'Install a Yolu package matching your system and processor, and Git in the environment where your repositories live. For integrated Codex conversations, install and authenticate the Codex CLI in that same environment. Installed Yolu packages do not require Go, Rust, or Node.js.',
    faqThreeQ: 'Which account do AI conversations use?', faqThreeA: 'Integrated conversations use the Codex CLI installed and authenticated in the selected environment, with that environment’s account and provider configuration. Model access, network requests, and costs depend on your account and settings. Other CLIs launched in terminals use their own authentication.',
    faqFourQ: 'Can I work inside WSL on Windows?', faqFourA: 'Yes. The Windows app can connect to a WSL distribution and user to execute Git and file operations there. Each conversation runs in one execution environment.',
    downloadEyebrow: 'MAKE ROOM FOR FOCUS.', downloadTitle: 'Your next good idea<br>starts here.', downloadBody: 'Give your development work a clearer starting point.',
    releaseNote: 'Available builds and installation notes are listed on GitHub Releases.', footerTagline: 'Less switching. More making.', documentation: 'Docs', feedback: 'Feedback',
  },
};

const chinese = {};
document.querySelectorAll('[data-i18n]').forEach(element => { chinese[element.dataset.i18n] = element.innerHTML; });
translations.zh = chinese;
let language = 'zh';
let currentShot = 'conversation';
let currentPlatform = /Windows/i.test(navigator.userAgent) ? 'windows' : /Linux/i.test(navigator.userAgent) ? 'linux' : 'macos';
let copyFeedbackTimer;
const captures = {
 conversation:{file:'conversation.jpg',zh:'Yolu 对话及其关联的项目和目录',en:'Yolu conversation with attached projects and directories'},
 changes:{file:'changes.jpg',zh:'Yolu 实际文件与改动查看器：示例项目的 Git 差异',en:'Actual Yolu file and change viewer with a sample project Git diff'},
 terminal:{file:'terminal.jpg',zh:'Yolu 实际终端：在项目目录中运行 Git 命令',en:'Actual Yolu terminal running Git commands in the project directory'},
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
 document.title=language==='zh'?'Yolu — 从项目开始对话':'Yolu — A clearer place for your development work';
 const description=language==='zh'?'Yolu 是面向多项目开发的本地 AI 对话工具。打开项目即可对话，按需添加仓库、Git Worktree 和本地目录。':'Yolu is a local AI conversation tool for development across repositories and directories.';
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
