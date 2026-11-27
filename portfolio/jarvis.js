(() => {
  const button = document.getElementById("voice");
  const toast = document.getElementById("toast");
  const scanBox = document.getElementById("scanCode");
  const scanState = document.getElementById("scanState");
  const scanText = document.getElementById("scanText");
  const synthesis = window.speechSynthesis;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let enabled = false;
  let recognition = null;
  let restartTimer = 0;
  let toastTimer = 0;
  let typingTimer = 0;
  const showToast = (message) => {
    toast.textContent = "J.A.R.V.I.S. // " + message.toUpperCase();
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  };
  const snippets = {
    home: ["face_mesh = scanner.capture_demo()", "operator = profile.load('devanshu')", "identity.match(operator)  # verified"],
    about: ["profile = operator.load()", "degree = 'Computer Science'", "status = 'Open to opportunities'"],
    skills: ["skills = ['Excel', 'SQL', 'Power BI']", "learning = ['Python', 'Statistics']", "signal = analytics.readiness()"],
    projects: ["archive = github.repositories()", "scan(projects, 'analytics')", "match = archive.open(selected_repo)"],
    contact: ["channel = contact.available()", "links = ['email', 'github', 'linkedin']", "route = channel.open('email')"]
  };
  function typeScan(section = "home") {
    if (!scanBox || !scanText) return;
    const lines = snippets[section] || snippets.home;
    const text = lines.join("\n");
    clearInterval(typingTimer);
    scanBox.dataset.state = "SCANNING";
    scanState.textContent = "SCANNING";
    scanText.textContent = "";
    let i = 0;
    typingTimer = setInterval(() => {
      scanText.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(typingTimer);
        scanBox.dataset.state = "MATCH";
        scanState.textContent = "MATCH";
      }
    }, 17);
  }
  function speak(message) {
    showToast(message);
    if (!enabled || !synthesis || !message) return;
    if (recognition) recognition.stop();
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = .9;
    utterance.pitch = .82;
    utterance.volume = 1;
    const voices = synthesis.getVoices();
    const voice = voices.find(v => /^en-IN$/i.test(v.lang))
      || voices.find(v => /Google UK English Male|Microsoft David|Daniel/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (enabled) startListening(); };
    utterance.onerror = () => { if (enabled) startListening(); };
    synthesis.speak(utterance);
  }
  function scrollToSection(id, section, message) {
    const target = document.getElementById(id);
    if (!target) return;
    typeScan(section);
    target.scrollIntoView({behavior:"smooth", block:"start"});
    speak(message);
  }
  function handleCommand(raw) {
    const command = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\\s+/g, " ").trim();
    if (!command) return;
    const project = [...document.querySelectorAll(".project-tile")].find(tile => {
      const label = (tile.dataset.project + " " + tile.textContent).toLowerCase().replace(/[^a-z0-9 ]/g, " ");
      return /\\b(open|kholo)\\b/.test(command) && label.split(/\\s+/).some(word => word.length > 4 && command.includes(word));
    });
    if (project) {
      typeScan("projects");
      speak("Opening " + project.querySelector("strong").textContent + ".");
      setTimeout(() => window.open("https://github.com/devanshudwivedi619/" + project.dataset.project, "_blank", "noopener"), 300);
      return;
    }
    if (/\\b(home|top|start|ghar)\\b/.test(command)) return scrollToSection("home","home","Opening home.");
    if (/\\b(profile|about|identity|who am i)\\b/.test(command)) return scrollToSection("about","about","Opening your profile.");
    if (/\\b(skill|skills|technology|tech stack)\\b/.test(command)) return scrollToSection("skills","skills","Opening your skills.");
    if (/\\b(project|projects|repository|repositories|work)\\b/.test(command)) return scrollToSection("projects","projects","Opening your projects.");
    if (/\\b(contact|email|reach me)\\b/.test(command)) return scrollToSection("contact","contact","Opening contact details.");
    speak("I can open home, profile, skills, projects, or contact. Try one of those commands.");
  }
  function startListening() {
    if (!enabled || !recognition || synthesis?.speaking) return;
    clearTimeout(restartTimer);
    try { recognition.start(); } catch {}
  }
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => {
      if (enabled) { button.textContent = "LISTENING // SPEAK A COMMAND"; button.setAttribute("aria-label","Jarvis is listening for a website command"); }
    };
    recognition.onresult = event => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) handleCommand(result[0].transcript);
    };
    recognition.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        enabled = false;
        button.setAttribute("aria-pressed","false");
        button.textContent = "MIC BLOCKED // CHECK PERMISSION";
        showToast("Microphone permission is needed for voice commands.");
      }
    };
    recognition.onend = () => {
      if (enabled && !synthesis?.speaking) restartTimer = setTimeout(startListening, 350);
      else if (enabled) button.textContent = "JARVIS // VOICE ON";
    };
  }
  button.addEventListener("click", () => {
    enabled = !enabled;
    button.setAttribute("aria-pressed", String(enabled));
    if (!enabled) {
      clearTimeout(restartTimer);
      recognition?.stop();
      synthesis?.cancel();
      button.textContent = "JARVIS // START";
      button.setAttribute("aria-label","Start Jarvis voice and microphone");
      showToast("Voice and microphone off.");
      return;
    }
    button.textContent = SpeechRecognition ? "JARVIS // VOICE ON" : "JARVIS // MIC UNSUPPORTED";
    button.setAttribute("aria-label","Turn Jarvis voice and microphone off");
    typeScan("home");
    speak("Voice interface online. At your service. Say home, profile, skills, projects, or contact.");
    if (!SpeechRecognition) showToast("Voice replies are ready; speech recognition is not supported in this browser.");
    else startListening();
  });
  document.querySelectorAll(".mission-card").forEach(card => card.addEventListener("click", () => {
    const section = card.dataset.target === "about" ? "about" : card.dataset.target === "projects" ? "projects" : "skills";
    typeScan(section);
    if (enabled) speak(card.dataset.speech || "Mission selected.");
    setTimeout(() => document.getElementById(card.dataset.target)?.scrollIntoView({behavior:"smooth"}), 450);
  }));
  document.querySelectorAll(".project-tile").forEach(tile => tile.addEventListener("click", () => {
    typeScan("projects");
    if (enabled) speak(tile.dataset.speech);
    setTimeout(() => window.open("https://github.com/devanshudwivedi619/" + tile.dataset.project, "_blank", "noopener"), 450);
  }));
  document.querySelectorAll("nav a").forEach(link => link.addEventListener("click", () => {
    const section = (link.getAttribute("href") || "").slice(1);
    typeScan(snippets[section] ? section : "home");
    if (enabled) speak("Navigation initiated. Opening " + link.textContent.toLowerCase() + ".");
  }));
  document.querySelectorAll("[data-speech]").forEach(control => {
    if (control.matches(".mission-card,.project-tile")) return;
    control.addEventListener("click", () => { typeScan("projects"); if (enabled) speak(control.dataset.speech); });
  });
  typeScan("home");
  addEventListener("pagehide", () => { recognition?.stop(); synthesis?.cancel(); });
})();