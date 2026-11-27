const root=document.createElement("div");root.className="jarvis-hud";
const faceSvg='<svg viewBox="0 0 150 180"><path class="face-outline" d="M75 12C42 12 27 37 29 70l5 41 17 29 24 16 24-16 17-29 5-41C123 37 108 12 75 12Z"/><path class="face-path" d="M75 8V171M22 72H128M30 43L120 133M120 43L30 133M48 17L102 163M102 17L48 163"/><path class="face-grid" d="M38 58q37-24 74 0M35 88q40-16 80 0M42 119q33 17 66 0M55 36q20 9 40 0M53 99q22 8 44 0"/><path class="face-path" d="M50 73q9-7 18 0M82 73q9-7 18 0M62 111q13 9 26 0"/><path class="scanline" d="M20 0H130" stroke="currentColor" stroke-width="1.5"/></svg>';
const botSvg='<svg viewBox="0 0 80 58"><ellipse class="wing" cx="40" cy="29" rx="35" ry="13"/><path d="M22 25 30 14 50 14 58 25 54 39 40 45 26 39Z"/><path d="M25 25 13 18 8 24 21 34M55 25 67 18 72 24 59 34"/><circle cx="30" cy="22" r="4"/><circle cx="50" cy="22" r="4"/><circle class="core" cx="40" cy="30" r="5"/><path d="M30 42 24 52M50 42 56 52"/></svg>';
root.innerHTML='<div class="j-corner j-c1"></div><div class="j-corner j-c2"></div><div class="j-corner j-c3"></div><div class="j-orbit"></div><div class="j-face jf1">'+faceSvg+'<span class="j-face-label">BIO SCAN 01 // ACTIVE</span></div><div class="j-face jf2">'+faceSvg+'<span class="j-face-label">BIO SCAN 02 // ACTIVE</span></div><div class="j-face jf3">'+faceSvg+'<span class="j-face-label">BIO SCAN 03 // ACTIVE</span></div><span class="j-drone" style="--x:18%;--y:28%;--dur:7s"></span><span class="j-drone" style="--x:83%;--y:22%;--dur:9s;--delay:-3s"></span><span class="j-drone" style="--x:68%;--y:77%;--dur:6s;--delay:-1s"></span><span class="j-drone" style="--x:37%;--y:82%;--dur:11s;--delay:-5s"></span><span class="j-bot" style="--x:31%;--y:18%;--dur:9s">'+botSvg+'</span><span class="j-bot" style="--x:74%;--y:28%;--dur:12s;--delay:-3s">'+botSvg+'</span><span class="j-bot" style="--x:58%;--y:72%;--dur:8s;--delay:-4s">'+botSvg+'</span><span class="j-bot" style="--x:12%;--y:65%;--dur:11s;--delay:-6s">'+botSvg+'</span><div class="j-readout">ARC REACTOR FIELD // 3 NODES TRACKED · 4 MICRO-DRONES IN FLIGHT</div><aside class="j-codefeed"><div class="j-code-head"><span>FACE SCAN / LIVE CODE</span><b id="j-code-state">SYSTEM READY</b></div><pre id="j-code-text"></pre></aside>';
document.body.append(root);
const faces=[...root.querySelectorAll(".j-face")];
function scanAll(){faces.forEach((f,i)=>{setTimeout(()=>f.classList.add("is-scanning"),i*260);setTimeout(()=>f.classList.remove("is-scanning"),1700+i*260)})}
const codeText=root.querySelector("#j-code-text"),codeState=root.querySelector("#j-code-state");
const codeSamples={
 about:"profile = operator.scan()\nidentity.match(profile)\nstatus = 'VERIFIED'",
 projects:"repo = github.archive()\nprojects.filter('analytics')\nselected = repo.open()",
 stack:"skills = ['Excel','SQL','Power BI']\nlearning = ['Python','Statistics']\nstack.render()",
 face:"landmarks = ['eyes','nose','cheeks']\ntracking = 'ON DEVICE'\nsignal = 'GREEN / LOCKED',
 contact:"links = ['email','github','linkedin']\ncontact.route('public')",
 home:"import portfolio.system as jarvis\nscanner.initialize(mode='demo')\noperator.link(status='online')"
};
let typingTimer=0;
function typeCode(mode="home"){
 const code=codeSamples[mode]||codeSamples.home;
 clearInterval(typingTimer);codeText.textContent="";codeState.textContent="SCANNING";
 root.querySelector(".j-codefeed").classList.add("is-active");
 let at=0;typingTimer=setInterval(()=>{codeText.textContent=code.slice(0,++at);if(at>=code.length){clearInterval(typingTimer);codeState.textContent="MATCH / OK"}},24);
 scanAll();
}
window.addEventListener("portfolio:scan",event=>typeCode(event.detail?.mode||"home"));
document.addEventListener("click",event=>{
 const target=event.target instanceof Element?event.target.closest(".hero-module,.wheel-item"):null;
 if(!target)return;
 const label=(target.dataset.dest||target.getAttribute("aria-label")||target.textContent||"").toLowerCase();
 const mode=/stack|skill/.test(label)?"stack":/project|archive/.test(label)?"projects":/contact|email/.test(label)?"contact":/about|whoami|identity|profile/.test(label)?"about":"home";
 typeCode(mode);
});
typeCode("home");setInterval(scanAll,4200);
