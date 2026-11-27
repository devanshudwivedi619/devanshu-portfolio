import { createArchive } from "./archive.js";
import { createWatch } from "./watch.js";
import { createBar } from "./bar.js";
import { createWheel } from "./wheel.js";
import { createTerminal } from "./terminal.js";
import { createBlueprint } from "./blueprint.js";
import { createTips } from "./tip.js";
import { createLightbox } from "./lightbox.js";
import { createFaceScanner } from "./face-scan.js";

const $ = (selector) => document.querySelector(selector);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const key = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const fmt = (value) => Math.round(value).toLocaleString("en-US").replace(/,/g, "'");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 700px)");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const editor = $(".editor");
const wheelHost = $(".wheel");
const buffer = $(".buffer");
const winbar = $(".winbar");
const tabline = $(".tabline");
const tabFile = $(".tab-file");
const tabToggle = $(".tab-toggle");
const barHost = $(".bar");
const cmdNode = $(".bar .cmd");

const load = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  });
const [content, themeData, snapshot, stack, months] = await Promise.all([load("content.json"), load("../themes.json"), load("../github-snapshot.json"), load("stack.json").catch(() => null), load("months.json").catch(() => null)]);
const themes = themeData.themes;
const palettes = new Map(content.palettes.map((theme) => [key(theme.name), theme]));
const days = snapshot.contributions.days;

const fileLabel = (image, index) => {
  const base = image.source.split("/").pop().split("?")[0];
  if (!/^[0-9a-f-]{24,}(\.[a-z]+)?$/i.test(base)) return base;
  return image.alt && image.alt.length <= 40 ? image.alt : `image ${index + 1}`;
};
const hex = (value) => [1, 3, 5].map((k) => parseInt(value.slice(k, k + 2), 16));
const LINK_SLOTS = [3, 4, 5, 8];
const luminance = (value) => {
  const [r, g, b] = hex(value).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const lab = (value) => {
  const [r, g, b] = hex(value).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const distance = (a, b) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const chroma = (value) => Math.hypot(lab(value)[1], lab(value)[2]);
const mix = (a, b, t) => `#${hex(a).map((v, n) => Math.round(v * (1 - t) + hex(b)[n] * t).toString(16).padStart(2, "0")).join("")}`;

const DEFAULT_THEME = "sora";
const THEME_KEY = "devanshu-portfolio.scheme.v2";
const WORM_KEY = "devanshu-portfolio.worm";
let currentTheme = DEFAULT_THEME;
let openEntry = null;
let booted = false;
let cleanup = null;
let typingToken = 0;
let clearTimer = 0;
let command = null;
let watch = null;
let wheel = null;
let hero = null;
let typingBar = false;
let typingTerm = false;

function applyTheme(name, remember = false) {
  const theme = palettes.get(key(name));
  if (!theme) return false;
  const fg = theme.fg || theme.kinds.text;
  const vars = {
    "--bg": theme.bg,
    "--ink": fg,
    "--dim": theme.kinds.comment || mix(fg, theme.bg, 0.55),
    "--accent": theme.accent,
    "--line": theme.cursorline || mix(fg, theme.bg, 0.9),
    "--kw": theme.kinds.keyword,
    "--str": theme.kinds.string,
    "--fn": theme.kinds.function,
    "--ty": theme.kinds.type,
    "--num": theme.kinds.number,
    "--chrome": mix(fg, theme.bg, 0.3),
    "--color1": theme.color1,
  };
  (theme.ansi || []).forEach((value, n) => {
    vars[`--color${n}`] = value;
  });
  const links = LINK_SLOTS.map((n) => theme.ansi?.[n]).filter((value) => value && contrast(value, theme.bg) >= 3 && distance(value, fg) >= 15);
  vars["--link"] = links.sort((a, b) => chroma(b) - chroma(a))[0] || fg;
  for (const [name, value] of Object.entries(vars)) if (value) document.body.style.setProperty(name, value);
  document.documentElement.style.colorScheme = theme.light ? "light" : "dark";
  currentTheme = key(name);
  hero?.recolor?.();
  watch?.recolor();
  wheel?.recolor();
  bar?.recolor();
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch {}
  }
  return true;
}

const about = (() => {
  const lines = content.about.lines;
  const links = lines.map((line) => line.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)).filter(Boolean).map((m) => ({ name: m[1].toLowerCase(), url: m[2] }));
  const text = lines.filter((line) => line.trim() && !/^#|^\[/.test(line));
  return { name: content.about.repo, bio: text, links };
})();

const MORE = new Set(content.more || []);
const OMARCHY = new Set();
const projectEntries = content.projects.map((project) => ({ id: project.repo, label: project.repo, kind: "project", data: project, parent: MORE.has(project.repo) ? "more" : OMARCHY.has(project.repo) ? "omarchy" : null }));
const children = projectEntries.filter((entry) => entry.parent);
const childrenOf = (id) => children.filter((entry) => entry.parent === id);
const shipped = themes.filter((theme) => theme.included);
const entries = [
  { id: "about", label: "whoami", kind: "about", tile: "about" },
  ...projectEntries.filter((entry) => !entry.parent),
  ...(content.work?.length ? [{ id: "work", label: "work/", kind: "work", tile: "work" }] : []),
  ...(content.talks?.length ? [{ id: "talks", label: "talks/", kind: "talks", tile: "talks" }] : []),
  ...(childrenOf("more").length ? [{ id: "more", label: "more/", kind: "more" }] : []),
  ...(stack ? [{ id: "stack", label: "stack/", kind: "stack", tile: "stack" }] : []),
  { id: "themes", label: "themes/", kind: "themes", tile: "themes" },
  ...children,
];
const items = entries.filter((entry) => !entry.parent).map((entry) =>
  entry.kind === "project" ? { entry, label: entry.label, src: entry.data.images[0]?.file, pushed: entry.data.pushed } : { entry, label: entry.label, tile: entry.tile },
);

const bar = createBar(barHost);
let seenAt = 0;
function loadSeen() {
  if (document.hidden || Date.now() - seenAt < 600e3) return;
  seenAt = Date.now();
  load("/api/seen")
    .then((data) => bar.setSeen(data))
    .catch(() => {});
}
function markSeen() {
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(() => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", arm);
      navigator.sendBeacon?.("/api/seen");
    }, 1000);
  };
  document.addEventListener("visibilitychange", arm);
  arm();
}
document.addEventListener("visibilitychange", loadSeen);
loadSeen();
markSeen();
const KEYS = { wide: "↑↓ project · ←→ shot · ↩ enter · : cmd", touch: "swipe the wheel · tap to open", closed: "tap ~/Projects ↓ to browse" };
const paintKeys = () => bar.setKeys(narrow.matches ? (editor.classList.contains("is-tree-open") ? KEYS.touch : KEYS.closed) : matchMedia("(pointer: fine)").matches ? KEYS.wide : KEYS.touch);
paintKeys();

function paintTyping() {
  bar.setTyping(typingBar || typingTerm);
}

const lightbox = createLightbox({ onOpen: () => tips.hide() });
const terminal = createTerminal(buffer, {
  lightbox,
  get watch() {
    return watch;
  },
  onTyping(on) {
    typingTerm = on;
    paintTyping();
  },
});

function clearSoon(ms = 2400) {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (command === null && !typingBar) cmdNode.textContent = "";
  }, ms);
}

async function typeCmd(text, pace = 11) {
  const token = ++typingToken;
  clearTimeout(clearTimer);
  typingBar = true;
  barHost.classList.add("is-typing");
  paintTyping();
  try {
    if (reduced.matches) cmdNode.textContent = text;
    else {
      cmdNode.textContent = "";
      for (let n = 1; n <= text.length; n++) {
        if (token !== typingToken) return;
        cmdNode.textContent = text.slice(0, n);
        watch?.pressChar(text[n - 1]);
        const rect = cmdNode.getBoundingClientRect();
        if (rect.width) watch?.focus(rect.right + 4, rect.top + rect.height / 2);
        await sleep(pace);
      }
    }
    await sleep(160);
    if (token !== typingToken) return;
    watch?.pressKey("Enter");
  } finally {
    if (token === typingToken) {
      typingBar = false;
      barHost.classList.remove("is-typing");
      paintTyping();
      clearSoon();
    }
  }
}

function say(text) {
  typingToken++;
  typingBar = false;
  barHost.classList.remove("is-typing");
  paintTyping();
  cmdNode.textContent = text;
  clearSoon(text ? 3200 : 0);
}

const GAUGE = 16;

const filledOf = (share, cells) => (share > 0 ? Math.max(1, Math.min(cells, Math.round(share * cells))) : 0);

function gauge(share, used) {
  const cells = room(used);
  const filled = filledOf(share, cells);
  const on = () => {
    const bar = make("span", "t-gauge", "█".repeat(filled));
    bar.dataset.share = share;
    bar.dataset.used = used;
    return bar;
  };
  return [{ node: on }, ["░".repeat(cells - filled), "t-gauge-off"]];
}

function refit() {
  for (const bar of buffer.querySelectorAll(".t-gauge[data-used]")) {
    const off = bar.nextElementSibling;
    const cells = room(Number(bar.dataset.used));
    if (!off || bar.textContent.length + off.textContent.length === cells) continue;
    const filled = filledOf(Number(bar.dataset.share), cells);
    bar.textContent = "█".repeat(filled);
    off.textContent = "░".repeat(cells - filled);
  }
}

const pad = (label) => label.padEnd(9);
const num = (value) => fmt(value ?? 0).padStart(6);
const fact = (label, value, extra = []) => ({ segments: [[pad(label), "t-key"], [num(value), "md-num"], ...extra] });
const month = (iso) => iso.slice(0, 7);

function starShare(stars) {
  const total = snapshot.stars?.total || 0;
  if (!total) return { share: 0, note: "" };
  const share = Math.round((stars / total) * 100);
  return { share: share || (stars ? 0.5 : 0), note: `  ${share || (stars ? "<1" : 0)}% of all stars` };
}

function room(used) {
  const style = getComputedStyle(buffer);
  const cell = parseFloat(style.getPropertyValue("--cell-w")) || 7.2;
  const chars = Math.floor((buffer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 1) / cell) - 3;
  return Math.max(6, Math.min(GAUGE, chars - used));
}

function projectSpec(project) {
  const out = [
    { segments: [[project.repo, "md-h md-h1"]] },
    ...(project.description ? [{ segments: [project.description], className: "t-dim" }] : []),
    { segments: [[pad("type"), "t-key"], [project.tag || "project", "md-code"]] },
    { segments: [[pad("stack"), "t-key"], [(project.stack || []).join(" · ") || "—", "md-code"]] },
  ];
  const url = project.url;
  return {
    cwd: `~/P/${project.repo}`,
    branch: project.branch || "main",
    shots: project.images.map((image, index) => ({ ...image, repo: project.repo, file: image.file, name: image.label || fileLabel(image, index) })),
    blocks: [
      { cmd: `fetch ${project.repo}`, out },
      { cmd: `open ${url.replace(/^https:\/\//, "")}`, link: { text: url.replace(/^https:\/\//, ""), href: url } },
    ],
  };
}

function calendarBlock() {
  return { cmd: `node calendar.mjs ${snapshot.contributions.from.slice(0, 4)}`, calendar: { days, months: months && months.from === snapshot.contributions.from && months.to === snapshot.contributions.to ? months.months : [], done: `// done · ${new Set(days.map((day) => day.date.slice(0, 7))).size} months · ${fmt(snapshot.contributions.total)} contributions` } };
}

function aboutSpec() {
  return {
    cwd: "~",
    branch: null,
    blocks: [
      {
        cmd: "whoami",
        out: [
          ...about.bio.map((line) => ({ segments: [line], className: "t-dim" })),
        ],
      },
      { cmd: "ls links/", out: [{ segments: about.links.flatMap((link, k) => [...(k ? ["   "] : []), [link.name, "", link.url]]) }] },
    ],
  };
}

function stackSpec() {
  const groups = stack.skills || [];
  return {
    cwd: "~/skills",
    branch: null,
    blocks: [
      { cmd: "skills --overview", out: [
        { segments: ["Data Analyst skill map", "t-key"] },
        { segments: ["Practical foundations: Excel · SQL fundamentals · Power BI", "t-dim"] },
        { segments: ["Other topics are marked as learning / developing.", "t-dim"] },
      ] },
      ...groups.map((group) => ({
        cmd: `skills --${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        out: [
          { segments: [group.level, "t-dim"] },
          ...group.items.map((item) => ({ segments: ["• ", item] })),
        ],
      })),
    ],
  };
}

function themesSpec() {
  const out = [{ segments: [[pad("palettes"), "t-key"], [String(themes.length), "md-num"], ["  click one to recolor the editor", "t-dim"]] }];
  return {
    cwd: "~/themes",
    branch: null,
    blocks: [
      { cmd: "fetch themes/", out },
      {
        cmd: "git log --graph themes/",
        mount(host) {
          const archive = createArchive(host, themes, {
            stats: content.themeStats || {},
            thumbs: content.themeThumbs || {},
            current: themes.find((theme) => key(theme.slug) === currentTheme)?.slug,
            viewport: buffer,
            lightbox,
            onPick(theme) {
              if (applyTheme(theme.slug, true)) typeCmd(`:colorscheme ${key(theme.slug)}`);
            },
          });
          return archive.destroy;
        },
      },
    ],
  };
}

function triptych(files) {
  const loaded = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = file;
      }),
  );
  return Promise.all(loaded).then((images) => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 188;
    const g = canvas.getContext("2d");
    const gap = 4;
    const w = (canvas.width - gap * (images.length - 1)) / images.length;
    images.forEach((img, k) => {
      const scale = Math.max(w / img.naturalWidth, canvas.height / img.naturalHeight);
      const sw = w / scale;
      const sh = canvas.height / scale;
      g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, k * (w + gap), 0, w, canvas.height);
    });
    return canvas.toDataURL("image/png");
  });
}

const WHEN_W = 24;
function workSpec() {
  const list = content.work || [];
  const jobs = list.filter((item) => item.kind !== "talk");
  const out = list.filter((item) => item.kind !== "talk").flatMap((item) => [
    { segments: [[item.when.padEnd(WHEN_W), "t-dim"], item.url ? [item.title, "", item.url] : [item.title, "t-key"], ...(item.org ? [["  @ " + item.org, "t-dim"]] : []), ...(item.where ? [["  · " + item.where, "t-dim"]] : [])] },
    { segments: [[" ".repeat(WHEN_W)], [item.desc || ""]], className: "t-hang" },
  ]);
  return {
    cwd: "~/work",
    branch: null,
    blocks: [
      { cmd: "fetch work/", out: [fact("entries", jobs.length), fact("programs", jobs.filter((item) => /summer of|google summer/i.test(item.title)).length)] },
      { cmd: "git log --format='%ad  %s' work/", out },
    ],
  };
}

function talksSpec() {
  const list = content.talks || [];
  const out = list.flatMap((talk) => [
    { segments: [[talk.when.padEnd(10), "t-dim"], talk.url ? [talk.name, "", talk.url] : [talk.name, "t-key"], ["  · " + talk.place, "t-dim"]] },
    { segments: [[" ".repeat(10)], [talk.desc || ""]], className: "t-hang" },
  ]);
  return {
    cwd: "~/talks",
    branch: null,
    blocks: [
      { cmd: "fetch talks/", out: [fact("talks", list.length), { segments: [[pad("places"), "t-key"], [[...new Set(list.map((talk) => talk.place.split(", ").pop()))].join(", ")]] }] },
      { cmd: "git log --format='%ad  %s' talks/", out },
      {
        cmd: "ls photos/",
        mount(host) {
          const cards = list.map((talk) => ({ repo: talk.name, slug: talk.name, name: talk.name, description: talk.place, included: false, palette: [], note: talk.when }));
          const archive = createArchive(host, cards, {
            stats: {},
            thumbs: Object.fromEntries(list.map((talk) => [talk.name, talk.photo])),
            current: "",
            viewport: buffer,
            lightbox,
            onPick(card) {
              const talk = list.find((item) => item.name === card.slug);
              if (talk?.url) window.open(talk.url, "_blank", "noopener");
            },
          });
          return archive.destroy;
        },
      },
    ],
  };
}

function moreSpec() {
  const list = childrenOf("more").map((entry) => entry.data);
  const stars = list.reduce((sum, project) => sum + (project.stars || 0), 0);
  const { share, note } = starShare(stars);
  const out = [
    fact("stars", stars, ["  ", ...gauge(share / 100, 17 + note.length), ...(note ? [[note, "t-dim"]] : [])]),
    fact("forks", list.reduce((sum, project) => sum + (project.forks || 0), 0)),
    { segments: [[pad("since"), "t-key"], month(list.map((project) => project.created).sort()[0]), ["  pushed ", "t-dim"], month(list.map((project) => project.pushed).sort().at(-1))] },
  ];
  return {
    cwd: "~/P",
    branch: null,
    blocks: [
      { cmd: "fetch more/", out },
      {
        cmd: "git log --graph more/",
        mount(host) {
          const cards = list.map((project) => ({ repo: project.repo, slug: project.repo, name: project.repo, description: project.description || "", included: false, palette: [], note: [project.language, project.license].filter(Boolean).join(" · ") }));
          const archive = createArchive(host, cards, {
            stats: Object.fromEntries(list.map((project) => [project.repo, { stars: project.stars || 0, forks: project.forks || 0, created: project.created, pushed: project.pushed }])),
            thumbs: Object.fromEntries(list.map((project) => [project.repo, project.images[0]?.file])),
            current: lastChild,
            viewport: buffer,
            onPick(card) {
              goTo(entries.find((entry) => entry.id === card.slug));
            },
          });
          if (document.activeElement === buffer) archive.focus();
          return archive.destroy;
        },
      },
    ],
  };
}

function textOf(entry) {
  if (entry.kind === "work") return (content.work || []).map((item) => `${item.title} ${item.org || ""} ${item.desc || ""}`).join(" ");
  if (entry.kind === "talks") return (content.talks || []).map((item) => `${item.name} ${item.place} ${item.desc || ""}`).join(" ");
  if (entry.kind === "more") return childrenOf("more").map((child) => `${child.data.repo} ${child.data.description || ""}`).join(" ");
  if (entry.kind === "project") return [entry.data.repo, entry.data.description, entry.data.language, entry.data.lines.join(" ")].join(" ");
  if (entry.kind === "about") return content.about.lines.join(" ");
  if (entry.kind === "themes") return themes.map((theme) => `${theme.name} ${theme.description}`).join(" ");
  return [...stack.languages, ...stack.tools, ...(stack.ai || []), ...stack.site].map((item) => item.name).join(" ");
}

function barView(entry) {
  if (entry.kind === "project") {
    const p = entry.data;
    return [["TYPE", p.tag || "PROJECT"], ["TOOLS", String(p.stack?.length || 0)]];
  }
  if (entry.kind === "themes") return [["THEMES", String(themes.length)], ["BUILT-IN", String(themes.filter((theme) => theme.included).length)]];
  if (entry.kind === "work") return [["ROLES", String((content.work || []).filter((item) => item.kind !== "talk").length)]];
  if (entry.kind === "talks") return [["TALKS", String((content.talks || []).length)]];
  if (entry.kind === "more") return [["PROJECTS", String(childrenOf("more").length)]];
  if (entry.kind === "stack") return [["LANGS", String(stack.languages.length)], ["TOOLS", String(stack.tools.length)], ["AI", String(stack.ai?.length ?? 0)]];
  return [["PROJECTS", String(content.projects.length)], ["THEMES", String(themes.length)]];
}

function open(entry) {
  if (entry === openEntry) return;
  if (cleanup) cleanup();
  cleanup = null;
  hero = null;
  openEntry = entry;
  if (entry.parent) lastChild = entry.id;
  history.replaceState(null, "", `#${entry.id}`);
  buffer.scrollTop = 0;
  buffer.dataset.kind = entry.kind;
  watch?.setText(textOf(entry));
  bar.setView(barView(entry));
  if (entry.kind === "project") {
    const project = entry.data;
    winbar.textContent = `fish — ~/Projects/${project.repo}`;
    tabFile.textContent = `/${project.repo}`;
    terminal.show(projectSpec(project));
    cleanup = () => terminal.destroy();
  } else if (entry.kind === "about") {
    winbar.textContent = `fish — ~ · ${about.name}`;
    tabFile.textContent = "/";
    hero = terminal.show(aboutSpec());
    cleanup = () => {
      terminal.destroy();
      hero = null;
    };
  } else if (entry.kind === "stack") {
    winbar.textContent = `fish — ~ · stack`;
    tabFile.textContent = "/stack/";
    terminal.show(stackSpec());
    cleanup = () => terminal.destroy();
  } else if (entry.kind === "work") {
    const orgs = (content.work || []).map((w) => w.org).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    winbar.textContent = orgs.length ? `work/ — ${orgs.join(" · ")}` : "work/";
    tabFile.textContent = "/work/";
    terminal.show(workSpec());
    cleanup = () => terminal.destroy();
  } else if (entry.kind === "talks") {
    winbar.textContent = `talks/ — ${(content.talks || []).length} talks`;
    tabFile.textContent = "/talks/";
    terminal.show(talksSpec());
    cleanup = () => terminal.destroy();
  } else if (entry.kind === "more") {
    winbar.textContent = `more/ — ${childrenOf("more").length} projects`;
    tabFile.textContent = "/more/";
    terminal.show(moreSpec());
    cleanup = () => terminal.destroy();
  } else if (entry.kind === "themes") {
    const included = themes.filter((theme) => theme.included).length;
    winbar.textContent = `themes/ — ${themes.length} themes · ${included} built-in`;
    tabFile.textContent = "/themes/";
    terminal.show(themesSpec());
    cleanup = () => terminal.destroy();
    typeCmd(":e themes/");
  }
}

function openDrawer() {
  editor.classList.add("is-tree-open");
  tabline.setAttribute("aria-expanded", "true");
  tabToggle.textContent = "↑";
  paintKeys();
  requestAnimationFrame(() => wheel?.layout());
}

function closeDrawer() {
  editor.classList.remove("is-tree-open");
  tabline.setAttribute("aria-expanded", "false");
  tabToggle.textContent = "↓";
  paintKeys();
}

function paintFade() {
  const rest = narrow.matches ? buffer.scrollHeight - buffer.clientHeight - buffer.scrollTop - parseFloat(getComputedStyle(buffer).paddingBottom) : 0;
  buffer.classList.toggle("is-cut", rest > 1);
  buffer.style.setProperty("--fade", `${Math.round(Math.min(40, Math.max(0, rest)))}px`);
}

let fadeFrame = 0;
const queueFade = () => {
  if (fadeFrame) return;
  fadeFrame = requestAnimationFrame(() => {
    fadeFrame = 0;
    paintFade();
  });
};
new MutationObserver(queueFade).observe(buffer, { childList: true });
buffer.addEventListener("scroll", queueFade, { passive: true });
window.addEventListener("resize", queueFade);

let fitFrame = 0;
const queueFit = () => {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    refit();
  });
};
window.addEventListener("resize", queueFit);

tabline.addEventListener("click", () => (editor.classList.contains("is-tree-open") ? closeDrawer() : openDrawer()));

function findEntry(name) {
  const wanted = key(name.replace(/\/README\.md$/i, "").replace(/^~\/Projects\/?/, ""));
  if (!wanted || ["readmemd", "about", "whoami", "home"].includes(wanted)) return entries.find((entry) => entry.kind === "about");
  if (["git", "gitlog", "log"].includes(wanted)) return entries.find((entry) => entry.kind === "stack") || entries.find((entry) => entry.kind === "about");
  return entries.find((entry) => key(entry.id) === wanted || key(entry.label) === wanted);
}

let child = null;
let lastChild = "";
function goTo(entry) {
  const parent = entries.find((candidate) => candidate.id === entry.parent);
  const k = items.findIndex((item) => item.entry === (parent || entry));
  if (k < 0) return;
  child = parent ? entry : null;
  wheel.select(k);
  wheel.commitNow();
  child = null;
  open(entry);
}

function schemes(name) {
  const wanted = key(name);
  if (!wanted) return [];
  if (palettes.has(wanted)) return [wanted];
  return [...palettes.keys()].filter((candidate) => candidate.startsWith(wanted));
}

function scheme(name) {
  const found = schemes(name);
  if (found.length === 1 && applyTheme(found[0], true)) return say(`:colorscheme ${found[0]}`);
  if (found.length > 1) return say(`E185: ${found.slice(0, 4).join(" · ")}${found.length > 4 ? " …" : ""}`);
  return say(`E185: Cannot find color scheme '${name}'`);
}

function run(text) {
  const [name, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  if (!name) return say("");
  if (/^q(a|all)?!?$/.test(name) || name === "wq" || name === "x") {
    location.href = "/";
    return;
  }
  if (name === "colorscheme" || name === "colo" || name === "theme") {
    if (!arg) {
      if (name === "theme") return goTo(entries.find((entry) => entry.kind === "themes"));
      return say(currentTheme);
    }
    return scheme(arg);
  }
  if (name === "e" || name === "edit" || name === "cd") {
    if (arg === ".." && openEntry?.parent) return goTo(entries.find((entry) => entry.id === openEntry.parent));
    const entry = findEntry(arg);
    if (entry) {
      say("");
      return goTo(entry);
    }
    return say(`E484: Can't open file ${arg}`);
  }
  if (name === "Git" || name === "git") return goTo(entries.find((entry) => entry.kind === "stack") || entries.find((entry) => entry.kind === "about"));
  const entry = !arg && key(name) && findEntry(name);
  if (entry) {
    say("");
    return goTo(entry);
  }
  if (!arg && schemes(name).length) return scheme(name);
  return say(`E492: Not an editor command: ${text.trim()}`);
}

function startCommand() {
  typingToken++;
  clearTimeout(clearTimer);
  command = "";
  typingBar = false;
  barHost.classList.add("is-typing");
  cmdNode.textContent = ":";
}

function commandKey(event) {
  event.preventDefault();
  if (event.key === "Escape") {
    command = null;
    barHost.classList.remove("is-typing");
    say("");
  } else if (event.key === "Enter") {
    const text = command;
    command = null;
    barHost.classList.remove("is-typing");
    run(text);
  } else if (event.key === "Backspace") {
    if (!command) {
      command = null;
      barHost.classList.remove("is-typing");
      say("");
      return;
    }
    command = command.slice(0, -1);
    cmdNode.textContent = `:${command}`;
  } else if (event.key.length === 1) {
    command += event.key;
    cmdNode.textContent = `:${command}`;
  }
}

document.addEventListener("keydown", (event) => {
  if (!event.repeat) watch?.pressKey(event.code, event.shiftKey);
  if (event.ctrlKey || event.metaKey || event.altKey || !booted) return;
  if (command !== null) {
    commandKey(event);
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".rack") || (target?.closest(".frame.is-xray") && ["Escape", "Enter", " "].includes(event.key))) return;
  if (event.key === ":") {
    event.preventDefault();
    startCommand();
    return;
  }
  const inBuffer = target && (target === buffer || buffer.contains(target));
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    if (inBuffer) wheel.focus();
    else buffer.focus({ preventScroll: true });
    return;
  }
  if (inBuffer) {
    const scroller = buffer.querySelector(".arc") || buffer;
    const lines = { j: 13, ArrowDown: 13, k: -13, ArrowUp: -13, d: scroller.clientHeight / 2, u: -scroller.clientHeight / 2 };
    if (event.key in lines) {
      event.preventDefault();
      scroller.scrollBy({ top: lines[event.key] });
    } else if (event.key === "g") scroller.scrollTo({ top: 0 });
    else if (event.key === "G") scroller.scrollTo({ top: scroller.scrollHeight });
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      terminal.step(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === " " && !target.closest("button, a") && terminal.toggle()) event.preventDefault();
    else if (event.key === "Enter" && !target.closest("button, a") && terminal.zoom()) event.preventDefault();
    else if (event.key === "h" || event.key === "Escape") wheel.focus();
    return;
  }
  if (target?.closest("a, button:not(.wheel-item)") && event.key === "Enter") return;
  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    wheel.step(1);
  } else if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    wheel.step(-1);
  } else if (event.key === "l" || event.key === "ArrowRight") {
    event.preventDefault();
    terminal.step(1);
  } else if (event.key === "h" || event.key === "ArrowLeft") {
    event.preventDefault();
    terminal.step(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    wheel.commitNow();
    const { item } = wheel.current();
    if (openEntry?.parent === item.entry.id) open(item.entry);
    if (openEntry?.kind === "more" || openEntry?.kind === "talks") (buffer.querySelector(".arc-card") || buffer).focus({ preventScroll: true });
    else if (openEntry?.kind !== "themes") buffer.focus({ preventScroll: true });
    closeDrawer();
  } else if (event.key === "Escape") closeDrawer();
});

window.addEventListener("hashchange", () => {
  const entry = entries.find((item) => item.id === decodeURIComponent(location.hash.slice(1)));
  if (entry && entry !== openEntry) goTo(entry);
});

narrow.addEventListener("change", () => {
  closeDrawer();
  paintKeys();
});

const tips = createTips();
const family = { box: () => (openEntry?.kind === "about" && hero?.family?.()) || null, fire: (ms) => hero?.fire?.(ms) };
const den = $(".den");
let wormOn = false;
try {
  wormOn = localStorage.getItem(WORM_KEY) === "on";
} catch {}
const paintDen = () => {
  den.setAttribute("aria-pressed", String(wormOn));
  den.dataset.tip = wormOn ? "switch the worm off" : "wake the worm";
};
paintDen();
den.addEventListener("click", () => {
  wormOn = !wormOn;
  paintDen();
  watch?.setWorm(wormOn);
  try {
    if (wormOn) localStorage.setItem(WORM_KEY, "on");
    else localStorage.removeItem(WORM_KEY);
  } catch {}
});
watch = createWatch({ layer: $(".overlay"), deskHost: $(".desk"), eyeHost: $(".eye-host"), buffer, status: barHost, onState: (state) => bar.setState(state), family, den, wormOn });
let saved = null;
try {
  saved = localStorage.getItem(THEME_KEY);
} catch {}
applyTheme(saved && palettes.has(saved) ? saved : DEFAULT_THEME);

const initialEntry = entries.find((entry) => entry.id === decodeURIComponent(location.hash.slice(1))) || entries[0];
const initialItem = entries.find((entry) => entry.id === initialEntry.parent) || initialEntry;
wheel = createWheel(wheelHost, {
  items,
  days,
  palettes: content.palettes,
  stack,
  initial: Math.max(0, items.findIndex((item) => item.entry === initialItem)),
  onChange(item) {
    tabFile.textContent = `/${item.entry.kind === "project" ? item.entry.id : item.label}`;
  },
  onCommit(item) {
    if (!booted) return;
    open(child?.parent === item.entry.id ? child : item.entry);
    const center = wheel.centerOf();
    if (center) watch?.focus(center.x, center.y);
  },
  onPick(item) {
    if (openEntry?.parent === item.entry.id) open(item.entry);
    if (!narrow.matches) return;
    setTimeout(() => {
      wheel.commitNow();
      closeDrawer();
    }, reduced.matches ? 0 : 170);
  },
});
const moreAt = items.findIndex((item) => item.entry.kind === "more");
if (moreAt >= 0)
  triptych(childrenOf("more").map((entry) => entry.data.images[0]?.file).filter(Boolean))
    .then((src) => wheel.setSrc(moreAt, src))
    .catch(() => {});
if (!reduced.matches) await typeCmd(":e ~/Projects", 18);
wheelHost.classList.add("is-in");
wheel.form();
booted = true;
child = initialEntry.parent ? initialEntry : null;
wheel.commitNow();
child = null;
if (!openEntry) {
  const { item } = wheel.current();
  open(item.entry);
}


// Hero-grade holographic command deck. Original superhero-tech aesthetic, not character replicas.
(() => {
  const stage = document.querySelector(".stage");
  if (!stage || document.querySelector(".hero-deck")) return;
  const deck = document.createElement("section");
  deck.className = "hero-deck";
  deck.setAttribute("aria-label", "Futuristic portfolio command deck");
  deck.innerHTML = `
    <div class="deck-top"><span class="deck-live"><i></i> STARK-CLASS INTERFACE</span><span class="deck-coordinate">DD / 2026</span></div>
    <div class="deck-title">SELECT YOUR <b>MISSION</b></div>
    <div class="hero-orbits" aria-hidden="true">
      <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
      <div class="hero-core"><span class="core-light"></span><small>AI</small></div>
      <span class="orbit-dot dot-one"></span><span class="orbit-dot dot-two"></span><span class="orbit-dot dot-three"></span>
    </div>
    <div class="hero-modules">
      <button class="hero-module arc-module" type="button" data-dest="about"><span class="module-art arc-art"><i></i></span><span class="module-label">01 / ARC CORE</span><b>IDENTITY</b><small>Meet the operator</small></button>
      <button class="hero-module web-module" type="button" data-dest="projects"><span class="module-art web-art"><i></i></span><span class="module-label">02 / WEB MATRIX</span><b>PROJECTS</b><small>Explore the archive</small></button>
      <button class="hero-module gamma-module" type="button" data-dest="stack"><span class="module-art gamma-art"><i></i></span><span class="module-label">03 / GAMMA CORE</span><b>TECH STACK</b><small>Skills & systems</small></button>
    </div>
    <div class="deck-foot"><span>HOLOGRAPHIC NAVIGATION</span><span>CLICK A MODULE TO INITIATE JUMP <b>↗</b></span></div>`;
  stage.append(deck);

  const voiceEngine = window.speechSynthesis;
  let voiceEnabled = false;
  let voiceList = [];
  let preferredVoice = null;
  const voiceToggle = document.createElement("button");
  voiceToggle.className = "deck-voice-toggle";
  voiceToggle.type = "button";
  voiceToggle.textContent = "JARVIS // OFF";
  voiceToggle.setAttribute("aria-pressed", "false");
  voiceToggle.setAttribute("aria-label", "Turn on Jarvis voice commands");
  document.querySelector(".switch")?.append(voiceToggle);
  const coreOrb = deck.querySelector(".hero-core");
  const refreshVoices = () => {
    voiceList = voiceEngine ? voiceEngine.getVoices() : [];
    preferredVoice = voiceList.find(v => /david|ryan|daniel|arthur|male/i.test(v.name) && /^en/i.test(v.lang))
      || voiceList.find(v => /^en-IN$/i.test(v.lang))
      || voiceList.find(v => /^en-GB$/i.test(v.lang))
      || voiceList.find(v => /^en-US$/i.test(v.lang))
      || voiceList.find(v => /^en/i.test(v.lang)) || null;
  };
  if (voiceEngine) {
    refreshVoices();
    voiceEngine.addEventListener?.("voiceschanged", refreshVoices);
  } else {
    voiceEnabled = false;
    voiceToggle.textContent = "JARVIS // OFF";
  }
  coreOrb.setAttribute("role", "button");
  coreOrb.setAttribute("tabindex", "0");
  coreOrb.setAttribute("aria-label", "Activate the portfolio voice assistant");
  let activeJarvisSpeech = "";
  let lastJarvisSpeech = "";
  let lastJarvisSpeechAt = 0;
  let welcomeSpoken = false;
  let faceScanActive = false;
  const sayWithDeck = (message, onDone) => {
    if (faceScanActive) return;
    if (!voiceEnabled || !voiceEngine) {
      onDone?.();
      return;
    }
    voiceEngine.cancel();
    refreshVoices();
    activeJarvisSpeech = message;
    lastJarvisSpeech = message;
    lastJarvisSpeechAt = Date.now();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = preferredVoice?.lang || "en-IN";
    utterance.rate = 1.08;
    utterance.pitch = 0.7;
    utterance.volume = 1;
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.onstart = () => coreOrb.classList.add("is-speaking");
    utterance.onend = () => { activeJarvisSpeech = ""; coreOrb.classList.remove("is-speaking"); startListening(); onDone?.(); };
    utterance.onerror = () => { activeJarvisSpeech = ""; coreOrb.classList.remove("is-speaking"); startListening(); onDone?.(); };
    voiceEngine.speak(utterance);
  };
  const faceScanner = createFaceScanner({
    onSignal() {
      faceScanActive = false;
      showWakeSky("SCAN COMPLETE // GREEN", "LANDMARK CHECK COMPLETE");
      let closeGuard = window.setTimeout(() => faceScanner.stop(), 2600);
      sayWithDeck("Welcome, sir.", () => {
        clearTimeout(closeGuard);
        faceScanner.stop();
      });
    },
    onStop() {
      faceScanActive = false;
      if (jarvisAwake) showWakeSky("AWAKE // LISTENING", "READY FOR A COMMAND");
    },
  });
  const speakWelcome = () => {
    if (welcomeSpoken || !voiceEngine) return;
    welcomeSpoken = true;
    refreshVoices();
    const utterance = new SpeechSynthesisUtterance("Welcome to the Devanshu Portfolio.");
    utterance.lang = preferredVoice?.lang || "en-IN";
    utterance.rate = 1.08;
    utterance.pitch = 0.7;
    utterance.volume = 1;
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.onstart = () => coreOrb.classList.add("is-speaking");
    utterance.onend = () => {
      coreOrb.classList.remove("is-speaking");
      startListening();
    };
    utterance.onerror = () => {
      welcomeSpoken = false;
      coreOrb.classList.remove("is-speaking");
      startListening();
    };
    voiceEngine.speak(utterance);
  };
  const moduleSpeech = {
    about: "Identity protocol activated. I am Devanshu Dwivedi, a Computer Science graduate focused on Data Analytics. I am open to opportunities across India.",
    projects: "Projects archive activated. Explore my analytics work, including sales and customer analytics, IT spend and asset utilization, Superstore sales insights, and hotel booking demand analysis. Each project links to its source repository.",
    stack: "Technology systems online. My practical foundations are Excel, SQL fundamentals, and Power BI. I am actively developing skills in Python, statistics, data cleaning, PySpark, and Amazon Web Services."
  };
  const greeting = () => {
    if (welcomeSpoken) return;
    welcomeSpoken = true;
    sayWithDeck("Welcome to the Devanshu Portfolio.");
  };
  coreOrb.addEventListener("click", greeting);
  coreOrb.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      greeting();
    }
  });
  const showWakeSky = (state = "AWAKE // LISTENING", command = "VOICE CHANNEL READY") => {
    let layer = document.querySelector(".jarvis-wake-sky");
    if (!layer) {
      const style = document.createElement("style");
      style.textContent = `
        .jarvis-wake-sky{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;overflow:hidden;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .38s ease,visibility .38s ease;background:linear-gradient(180deg,rgba(2,8,17,.24),rgba(2,12,23,.10) 48%,rgba(1,8,16,.30));color:#c7f7ff;font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em}
        .jarvis-wake-sky.is-awake{opacity:1;visibility:visible}
        .jarvis-video-backdrop{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.34;filter:saturate(1.25) contrast(1.08);mix-blend-mode:screen;pointer-events:none}
        .jarvis-wake-sky:after{content:"";position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,rgba(2,8,17,.25),rgba(2,12,23,.34) 48%,rgba(1,8,16,.4));pointer-events:none}
        .jarvis-wake-stars,.jarvis-wake-nebula,.jarvis-wake-orbit,.jarvis-wake-horizon{z-index:1}
        .jarvis-holo-shell{z-index:2}
        .jarvis-wake-stars{position:absolute;inset:0;background-image:radial-gradient(#d7f8ff 1px,transparent 1.6px),radial-gradient(#7de9ff 1px,transparent 1.8px);background-size:97px 97px,163px 163px;background-position:9px 21px,63px 87px;opacity:.58;animation:wakeStars 8s linear infinite}
        .jarvis-wake-nebula{position:absolute;inset:-20%;background:radial-gradient(ellipse at 22% 25%,#185aff26,transparent 34%),radial-gradient(ellipse at 78% 36%,#00d9ff1c,transparent 34%),radial-gradient(ellipse at 53% 12%,#bf45ff17,transparent 29%);filter:blur(18px);animation:wakeNebula 7s ease-in-out infinite alternate}
        .jarvis-wake-horizon{position:absolute;left:-15%;right:-15%;bottom:-12%;height:48%;transform:perspective(420px) rotateX(55deg);transform-origin:bottom center;border-top:1px solid #59ddff62;background:repeating-linear-gradient(0deg,transparent 0 22px,#44dfff19 23px 24px),repeating-linear-gradient(90deg,transparent 0 48px,#44dfff14 49px 50px),radial-gradient(ellipse at 50% 0,#126b9555,transparent 68%);box-shadow:0 -8px 38px #21cfff22;animation:wakeOcean 6s ease-in-out infinite alternate}
        .jarvis-wake-horizon:before,.jarvis-wake-horizon:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(177deg,transparent 0 34px,#79eaff26 35px 36px);transform:translateY(12px);animation:wakeWaves 3s linear infinite}
        .jarvis-wake-horizon:after{opacity:.42;filter:blur(5px);transform:translateY(26px);animation-duration:4.5s}
        .jarvis-wake-orbit{position:absolute;left:50%;top:38%;width:min(62vw,660px);aspect-ratio:1;border:1px solid #63eaff38;border-radius:50%;transform:translate(-50%,-50%) rotateX(68deg);box-shadow:0 0 35px #14dfff22,inset 0 0 45px #6554ff14;animation:wakeOrbit 24s linear infinite}
        .jarvis-wake-orbit:before,.jarvis-wake-orbit:after{content:"";position:absolute;inset:13%;border:1px solid #73eaff32;border-radius:50%;transform:rotate(45deg) scaleX(.58)}
        .jarvis-wake-orbit:after{inset:0;border-left-color:transparent;border-right-color:transparent;transform:rotate(-35deg)}
        .jarvis-holo-shell{position:relative;z-index:2;width:min(1040px,92vw);max-height:88vh;overflow:auto;padding:clamp(12px,2.1vw,24px);border:1px solid #59eaff4c;background:linear-gradient(145deg,rgba(4,17,29,.38),rgba(3,9,20,.28));box-shadow:0 0 48px #12dfff18,inset 0 0 32px #12dfff08;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);clip-path:polygon(0 0,97% 0,100% 8%,100% 100%,3% 100%,0 92%)}
        .jarvis-holo-head{display:flex;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #4bd5f82c;color:#70eaff;font-size:8px;letter-spacing:.15em}
        .jarvis-holo-head span:last-child{color:#75ffbd}
        .jarvis-holo-grid{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(240px,1.3fr) minmax(150px,.8fr);gap:12px;margin-top:12px}
        .jarvis-holo-card{position:relative;min-width:0;padding:11px;border:1px solid #3dcce83b;background:rgba(2,11,20,.28);box-shadow:inset 0 0 18px #0edfff08}
        .jarvis-holo-title{display:flex;justify-content:space-between;gap:6px;margin-bottom:9px;color:#78e9ff;font-size:7px;letter-spacing:.13em}
        .jarvis-holo-title b{color:#72ffb3;font-weight:400}
        .jarvis-face-holo{position:relative;display:grid;place-items:center;height:120px;overflow:hidden;border:1px solid #58eaff25;background:radial-gradient(ellipse,#0e566744,transparent 68%)}
        .jarvis-face-holo svg{height:110px;max-width:100%;fill:none;stroke:#69e9ff;stroke-width:1.2;stroke-dasharray:3 5;filter:drop-shadow(0 0 5px #20dfff);animation:faceFloat 4s ease-in-out infinite}
        .jarvis-face-sweep{position:absolute;left:8%;right:8%;height:1px;background:#80ffc1;box-shadow:0 0 10px #54ffbd;animation:faceSweep 2.5s ease-in-out infinite alternate}
        .jarvis-face-label{position:absolute;bottom:5px;left:7px;color:#87ffbf;font-size:6px}
        .jarvis-threat-row{display:flex;justify-content:space-between;gap:4px;margin-top:8px;color:#94aeb7;font-size:7px}
        .jarvis-threat-row b{color:#79ffb9;font-weight:400}
        .jarvis-command-core{display:flex;flex-direction:column;justify-content:center;text-align:center;background:radial-gradient(ellipse at 50% 40%,rgba(8,68,91,.25),rgba(2,11,20,.18) 70%)}
        .jarvis-core-ring{position:relative;isolation:isolate;display:grid;place-items:center;width:clamp(88px,12vw,126px);aspect-ratio:1;margin:3px auto 13px;border:1px solid #ffcc6a7a;border-radius:50%;background:radial-gradient(circle at 50% 49%,#fff8d7 0 2%,#ffc85c 4%,#ff9e2c 9%,#f47d17 15%,#b94b1b 24%,#322044 38%,#07101b 60%);box-shadow:0 0 13px #ffbd4d,0 0 30px #ff8b2b99,0 0 68px #ff6b2552,inset 0 0 20px #ffd078aa;animation:corePulse 2s ease-in-out infinite}
        .jarvis-core-ring:before,.jarvis-core-ring:after{content:"";position:absolute;inset:-10%;border:1px solid #ffcb6b9c;border-left-color:#ff7c3b;border-right-color:#ffe8a8;border-radius:50%;transform:rotateX(68deg) rotateZ(-18deg);box-shadow:0 0 9px #ffae4477;animation:holoSpin 8s linear infinite}
        .jarvis-core-ring:after{inset:-19% -5%;border-color:#74e9ff77;border-top-color:#fff1bb;border-bottom-color:#ff9e4477;transform:rotateX(72deg) rotateZ(46deg);animation:holoSpin 11s linear infinite reverse}
        .jarvis-core-ring i{position:absolute;z-index:2;width:4px;height:4px;border-radius:50%;background:#fff4c7;box-shadow:0 0 8px 3px #ffb947;animation:holoParticle 2.4s ease-in-out infinite alternate}
        .jarvis-core-ring .orb-a{top:15%;left:28%}.jarvis-core-ring .orb-b{right:16%;top:42%;animation-delay:-.8s}.jarvis-core-ring .orb-c{bottom:17%;left:39%;animation-delay:-1.5s}
        .jarvis-wake-sky.is-listening .jarvis-core-ring{animation:holoBlink .72s steps(2,end) infinite}
        .jarvis-wake-sky.is-processing .jarvis-core-ring{animation:holoPulse .58s ease-in-out infinite}
        .jarvis-wake-sky.is-listening .jarvis-core-ring:before,.jarvis-wake-sky.is-processing .jarvis-core-ring:before{border-color:#fff0ad;box-shadow:0 0 18px #ffae44}
        .jarvis-wake-sky.is-listening .jarvis-core-ring:after,.jarvis-wake-sky.is-processing .jarvis-core-ring:after{border-color:#72edff;box-shadow:0 0 16px #33dfff}
        .jarvis-holo-state{margin:2px 0;color:#ebfbff;font:700 clamp(12px,2vw,17px)/1.3 ui-monospace,monospace;letter-spacing:.15em;text-shadow:0 0 18px #22dfff5c}
        .jarvis-holo-command{margin:6px 0 11px;color:#8fb2c1;font-size:8px;letter-spacing:.12em}
        .jarvis-holo-code{min-height:78px;margin:0;padding:8px;border:1px solid #3dcce82b;background:rgba(0,5,11,.42);color:#b7d6df;text-align:left;font:8px/1.55 ui-monospace,monospace;letter-spacing:.02em;white-space:pre-wrap}
        .jarvis-holo-code:after{content:"▌";color:#71f2ff;animation:deck-blink .8s steps(2,end) infinite}
        .jarvis-holo-code span{color:#83ffc1}
        .jarvis-data-bars{height:92px;display:flex;align-items:end;justify-content:space-around;gap:5px;padding:7px;border-bottom:1px solid #54eaff35;background:repeating-linear-gradient(0deg,transparent 0 20px,#55deff12 21px 22px)}
        .jarvis-data-bars i{flex:1;max-width:12px;height:var(--bar);background:linear-gradient(0deg,#328eff55,#7affd9);box-shadow:0 0 9px #27eaff65;transform-origin:bottom;animation:dataPulse var(--speed,1.5s) ease-in-out infinite alternate}
        .jarvis-sparkline{display:block;width:100%;height:34px;margin-top:10px;overflow:visible}
        .jarvis-sparkline path{fill:none;stroke:#ff79d2;stroke-width:2;stroke-dasharray:150;stroke-dashoffset:150;filter:drop-shadow(0 0 5px #ff4fbe);animation:chartDraw 2.8s linear infinite}
        .jarvis-ocean{position:relative;height:clamp(62px,10vh,100px);margin-top:10px;overflow:hidden;border:1px solid #58dfff28;background:linear-gradient(180deg,rgba(3,24,42,.10),rgba(0,45,72,.25) 55%,rgba(0,10,24,.34));}
        .jarvis-ocean:before,.jarvis-ocean:after{content:"";position:absolute;inset:40% -15% -60%;border-top:1px solid #61eaff48;border-radius:50% 50% 0 0;background:repeating-linear-gradient(0deg,transparent 0 12px,#4ce2ff18 13px 14px);animation:oceanRipple 4s ease-in-out infinite alternate}
        .jarvis-ocean:after{inset:48% -20% -70%;opacity:.5;animation-duration:6s}
        .jarvis-ocean-label{position:absolute;top:7px;left:9px;z-index:2;color:#78eaff;font-size:7px;letter-spacing:.12em}
        .jarvis-fish{position:absolute;top:38%;width:39px;height:19px;fill:#78ecff;filter:drop-shadow(0 0 5px #2bdfff);animation:fishSwim 11s linear infinite}
        .jarvis-fish.fish-b{top:64%;width:27px;opacity:.68;animation-duration:15s;animation-delay:-6s}
        .jarvis-fish.fish-c{top:48%;width:20px;opacity:.42;animation-duration:18s;animation-delay:-10s}
        .jarvis-ocean-bubbles{position:absolute;right:17%;bottom:-14px;width:4px;height:4px;border-radius:50%;background:#82f7ff;box-shadow:-33px 8px 0 #82f7ff88,21px 14px 0 #82f7ff77,48px 10px 0 #82f7ff88;animation:bubbles 4s linear infinite}
        .jarvis-holo-foot{display:flex;justify-content:space-between;gap:9px;margin-top:8px;color:#638696;font-size:6px;letter-spacing:.11em}
        .jarvis-holo-foot b{color:#79ffb9;font-weight:400}
        @keyframes wakeOrbit{to{rotate:360deg}}
        @keyframes wakeStars{to{background-position:147px 101px,-100px 187px}}
        @keyframes wakeOcean{from{transform:perspective(420px) rotateX(55deg) translateY(16px);opacity:.55}to{transform:perspective(420px) rotateX(55deg) translateY(0);opacity:1}}
        @keyframes wakeWaves{to{background-position:0 75px}}
        @keyframes wakeNebula{to{transform:scale(1.1);filter:blur(28px)}}
        @keyframes faceFloat{50%{transform:translateY(-4px)}}
        @keyframes faceSweep{to{top:88%}}
        @keyframes corePulse{50%{transform:scale(1.12);filter:brightness(1.65)}}@keyframes holoPulse{0%,100%{transform:scale(.94);filter:brightness(1)}50%{transform:scale(1.12);filter:brightness(1.85)}}@keyframes holoBlink{0%,100%{filter:brightness(.9);box-shadow:0 0 10px #ffb947,0 0 28px #ff852b88,inset 0 0 20px #ffd07899}50%{filter:brightness(1.8);box-shadow:0 0 22px #fff0ad,0 0 68px #ff7d31,inset 0 0 30px #ffe9a4}}@keyframes holoSpin{to{rotate:360deg}}@keyframes holoParticle{to{transform:translate3d(9px,-12px,0);opacity:.35}}
        @keyframes dataPulse{to{transform:scaleY(.62);opacity:.65}}
        @keyframes chartDraw{0%{stroke-dashoffset:150}70%,100%{stroke-dashoffset:0}}
        @keyframes oceanRipple{to{transform:translateX(35px);opacity:.5}}
        @keyframes fishSwim{0%{transform:translateX(-10vw) scaleX(1)}49%{transform:translateX(100vw) scaleX(1)}50%{transform:translateX(100vw) scaleX(-1)}100%{transform:translateX(-10vw) scaleX(-1)}}
        @keyframes bubbles{to{transform:translateY(-120px);opacity:0}}
        @media(max-width:720px){.jarvis-wake-sky{align-items:start;overflow:auto;padding:8px 0}.jarvis-holo-shell{width:94vw;max-height:none}.jarvis-holo-grid{grid-template-columns:1fr 1fr}.jarvis-command-core{grid-column:1/-1;grid-row:1}.jarvis-holo-card{padding:8px}.jarvis-face-holo{height:90px}.jarvis-ocean{height:72px}.jarvis-holo-foot{font-size:5px}}
        @media(max-width:420px){.jarvis-holo-grid{grid-template-columns:1fr}.jarvis-command-core{grid-column:auto;grid-row:auto}.jarvis-face-holo{height:78px}}
        @media(prefers-reduced-motion:reduce){.jarvis-wake-sky *{animation:none!important;transition:none!important}}
      `;
      document.head.append(style);
      layer = document.createElement("div");
      layer.className = "jarvis-wake-sky";
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML = '<img class="jarvis-video-backdrop" src="../download.gif" alt="" aria-hidden="true"><div class="jarvis-wake-stars"></div><div class="jarvis-wake-nebula"></div><div class="jarvis-wake-orbit"></div><div class="jarvis-wake-horizon"></div><section class="jarvis-holo-shell"><header class="jarvis-holo-head"><span>DEVANSHU // CYBERSECURITY CONTROL</span><span>● <b id="wake-status">AWAKE // LISTENING</b></span></header><div class="jarvis-holo-grid"><article class="jarvis-holo-card"><div class="jarvis-holo-title"><span>THREAT SCAN / HOLOGRAM</span><b>LOCAL SIMULATION</b></div><div class="jarvis-face-holo"><svg viewBox="0 0 120 140" aria-hidden="true"><path d="M60 8C34 8 22 27 24 57l4 34 12 24 20 15 20-15 12-24 4-34C98 27 86 8 60 8Z"/><path d="M25 52q35-23 70 0M28 70q32-13 64 0M36 92q24 15 48 0M42 49q8-6 16 0M62 49q8-6 16 0M50 79q10 6 20 0"/></svg><i class="jarvis-face-sweep"></i><span class="jarvis-face-label">FACE TRACE // DEMO ONLY</span></div><div class="jarvis-threat-row"><span>PERIMETER</span><b>● SECURE</b></div><div class="jarvis-threat-row"><span>THREAT FEED</span><b>SIMULATED</b></div></article><article class="jarvis-holo-card jarvis-command-core"><div class="jarvis-core-ring" aria-hidden="true"><i class="orb-a"></i><i class="orb-b"></i><i class="orb-c"></i></div><div class="jarvis-holo-state" id="wake-state">AWAKE // LISTENING</div><p class="jarvis-holo-command" id="wake-command">VOICE CHANNEL READY</p><pre class="jarvis-holo-code" id="wake-code"></pre></article><article class="jarvis-holo-card"><div class="jarvis-holo-title"><span>DATA VISUALIZATION</span><b>SIMULATED</b></div><div class="jarvis-data-bars"><i style="--bar:42%;--speed:1.1s"></i><i style="--bar:78%;--speed:1.7s"></i><i style="--bar:56%;--speed:1.3s"></i><i style="--bar:91%;--speed:1.9s"></i><i style="--bar:64%;--speed:1.2s"></i><i style="--bar:73%;--speed:1.6s"></i><i style="--bar:48%;--speed:1.4s"></i></div><svg class="jarvis-sparkline" viewBox="0 0 180 36" preserveAspectRatio="none" aria-hidden="true"><path d="M0 28 L20 21 L38 24 L57 10 L78 17 L96 7 L116 15 L136 4 L157 11 L180 2"/></svg><div class="jarvis-threat-row"><span>SIGNAL</span><b>STABLE / GREEN</b></div></article></div><div class="jarvis-ocean"><span class="jarvis-ocean-label">OCEANIC SENSOR FIELD // HOLOGRAM</span><svg class="jarvis-fish fish-a" viewBox="0 0 80 40" aria-hidden="true"><path d="M7 20Q26 1 51 20Q26 39 7 20M50 20l23-15-2 15 2 15Z"/><circle cx="23" cy="18" r="2" fill="#06121d"/></svg><svg class="jarvis-fish fish-b" viewBox="0 0 80 40" aria-hidden="true"><path d="M7 20Q26 1 51 20Q26 39 7 20M50 20l23-15-2 15 2 15Z"/><circle cx="23" cy="18" r="2" fill="#06121d"/></svg><svg class="jarvis-fish fish-c" viewBox="0 0 80 40" aria-hidden="true"><path d="M7 20Q26 1 51 20Q26 39 7 20M50 20l23-15-2 15 2 15Z"/><circle cx="23" cy="18" r="2" fill="#06121d"/></svg><i class="jarvis-ocean-bubbles"></i></div><footer class="jarvis-holo-foot"><span>SIMULATED PORTFOLIO VISUALS · NO DARK WEB ACCESS OR COMMANDS</span><b id="wake-footer">AWAITING COMMAND</b></footer></section>';
      document.body.append(layer);
    }
    // Keep the hologram visible for at least two seconds after each wake/update.
    clearTimeout(layer._hideTimer);
    layer._visibleUntil = Date.now() + 2000;
    layer.classList.add("is-awake");
    layer.classList.toggle("is-listening", /LISTEN|HEAR|STANDBY|WAKE WORD/i.test(state));
    layer.classList.toggle("is-processing", /PROCESS|SEARCH|COMMAND ACCEPTED/i.test(state));
    const status = layer.querySelector("#wake-status");
    const stateNode = layer.querySelector("#wake-state");
    const commandNode = layer.querySelector("#wake-command");
    const footer = layer.querySelector("#wake-footer");
    if (status) status.textContent = state;
    if (stateNode) stateNode.textContent = state;
    if (commandNode) commandNode.textContent = command;
    if (footer) footer.textContent = state.includes("PROCESS") ? "COMMAND IN PROGRESS" : state.includes("COMPLETE") ? "ACTION COMPLETED" : "AWAITING COMMAND";
    const codeNode = layer.querySelector("#wake-code");
    if (codeNode) {
      clearInterval(layer._codeTimer);
      const lines = state.includes("PROCESS")
        ? ["$ jarvis.execute('" + command.toLowerCase().replaceAll("'", "") + "')", "resolving portfolio destination...", "rendering interactive module...", "status = 'working'"]
        : ["$ jarvis --listen", "voice.channel = 'english'", "security.monitor = 'simulated'", "await next_command()"];
      const code = lines.join("\n");
      let cursor = 0;
      codeNode.textContent = "";
      layer._codeTimer = window.setInterval(() => {
        codeNode.textContent = code.slice(0, ++cursor);
        if (cursor >= code.length) clearInterval(layer._codeTimer);
      }, 16);
    }
  };
  const hideWakeSky = (immediate = false) => {
    const layer = document.querySelector(".jarvis-wake-sky");
    if (!layer) return;
    clearInterval(layer._codeTimer);
    clearTimeout(layer._hideTimer);
    const hide = () => layer.classList.remove("is-awake");
    const remaining = (layer._visibleUntil || 0) - Date.now();
    if (!immediate && remaining > 0) layer._hideTimer = window.setTimeout(hide, remaining);
    else hide();
  };

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  let jarvisAwake = false;
  let restartTimer = 0;
  let greetOnStart = false;
  const startListening = () => {
    if (!voiceEnabled || !recognizer || listening) return;
    try { recognizer.start(); listening = true; } catch {}
  };
  const stopListening = () => {
    clearTimeout(restartTimer);
    if (!recognizer || !listening) return;
    try { recognizer.stop(); } catch {}
    listening = false;
  };
  if (SpeechRecognition) {
    recognizer = new SpeechRecognition();
    recognizer.lang = "en-IN";
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 5;
    let wakeArmed = false;
    const normalizeVoice = (value) => value.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wakePattern = /\b(?:wake\s+(?:up\s+)?(?:hey\s+)?(?:jarvis|jervis|travis|charvis|service)|(?:jarvis|jervis|travis|charvis)\s+wake\s+up|(?:utho|uttho|uthho)\s+(?:jarvis|jervis|travis|charvis))\b/i;
    const findProject = (command) => {
      const stop = new Set(["project", "projects", "section", "repo", "repository", "repositories", "open", "show", "display", "view", "please", "me", "my", "the", "a", "an", "and", "to", "for", "of", "with", "dashboard", "data"]);
      const candidates = entries.filter(entry => entry.kind === "project").map(entry => {
        const words = normalizeVoice([entry.id, entry.label, entry.data?.repo, entry.data?.title].filter(Boolean).join(" "))
          .split(" ").filter(word => word.length > 2 && !stop.has(word));
        const matched = [...new Set(words)].filter(word => command.includes(word));
        return { entry, score: matched.length };
      }).filter(candidate => candidate.score > 0).sort((a,b) => b.score - a.score);
      if (!candidates.length) return null;
      if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
      return candidates[0].entry;
    };
    const parseCommand = (raw) => {
      const command = normalizeVoice(raw);
      if (/\b(?:scan|inspect|check|analyze|analyse)\b.*\b(?:face|eyes|nose|cheeks|biometric)\b|\bface\s+scan(?:ning)?\b/.test(command)) {
        return { target: chooseEntry("about"), dest: "face-scan" };
      }
      const themeEntry = entries.find(entry => entry.kind === "themes");
      const themeIntent = /\b(themes?|color schemes?|colorschemes?|palette|appearance|select|choose|apply|set)\b/.test(command);
      // Voice transcripts may split a single theme name (for example, “Blackmoney”)
      // into separate words. Compare normalized names and prefer the most specific match.
      const themeName = themeIntent
        ? [...palettes.keys()].sort((a, b) => b.length - a.length).find(name => key(command).includes(name))
        : null;
      if (themeName && themeEntry) return { target: themeEntry, dest: "theme", themeName };
      if (/\b(themes?|color schemes?|colorschemes?|palette|appearance)\b/.test(command) && themeEntry) {
        return { target: themeEntry, dest: "themes" };
      }
      const stackOverflow = /\bstack overflow\b/.test(command);
      const stackIntent = !stackOverflow && /\b(tech stack|stack|skills|skill|technology|technical skills|excel|sql|power bi|python|pyspark|statistics|aws)\b/.test(command);
      if (stackIntent) return { target: chooseEntry("stack"), dest: "stack" };
      if (/\b(identity|profile|about|background|education|who am i|who are you)\b/.test(command)) return { target: chooseEntry("about"), dest: "about" };
      if (/\b(home|start|top)\b/.test(command)) return { target: chooseEntry("about"), dest: "about" };
      if (/\b(contact|email|reach me)\b/.test(command)) return { target: chooseEntry("about"), dest: "contact" };
      const project = findProject(command);
      if (project) return { target: project, dest: "project" };
      if (stackOverflow) {
        const survey = entries.find(entry => entry.id === "stack-overflow-developer-survey-dashboard");
        if (survey) return { target: survey, dest: "project" };
      }
      if (/\b(project|projects|archive|repository|repositories|work)\b/.test(command)) {
        return { target: chooseEntry("projects"), dest: "projects" };
      }
      return null;
    };
    recognizer.onstart = () => {
      if (!voiceEnabled) return;
      voiceToggle.textContent = jarvisAwake ? "AWAKE // LISTENING" : "ASLEEP // WAKE WORD";
      voiceToggle.setAttribute("aria-label", jarvisAwake ? "Jarvis is awake and listening for English commands" : "Jarvis is asleep and waiting for the Wake up Jarvis phrase");
      if (greetOnStart) {
        greetOnStart = false;
        if (!welcomeSpoken) {
          welcomeSpoken = true;
          sayWithDeck("Welcome to the Devanshu Portfolio.");
        }
      }
    };
    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const alternatives = Array.from(result, item => item.transcript);
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
      if (!result.isFinal) {
        const liveTranscript = alternatives[0] || "";
        if (!jarvisAwake && wakePattern.test(normalize(liveTranscript))) {
          showWakeSky("WAKE WORD DETECTED", liveTranscript.toUpperCase());
        } else if (jarvisAwake && liveTranscript) {
          showWakeSky("LISTENING // HEARING COMMAND", liveTranscript.toUpperCase());
        }
        return;
      }
      const stopCommand = alternatives.some(text => /\b(?:stop(?:ped)?(?:\s+(?:talking|speaking))?|silence|be quiet|stay quiet|shut up|cancel speech)\b|\bjarvis\s+(?:stop(?:ped)?|be quiet|shut up)\b|\b(?:stop(?:ped)?|shut up)\s+jarvis\b/i.test(normalize(text)));
      if (stopCommand) {
        voiceEngine?.cancel();
        activeJarvisSpeech = "";
        lastJarvisSpeech = "";
        jarvisAwake = false;
        faceScanner.stop();
        hideWakeSky(true);
        coreOrb.classList.remove("is-speaking");
        voiceToggle.textContent = "ASLEEP // WAKE WORD";
        voiceToggle.setAttribute("aria-label", "Jarvis is asleep and waiting for the Wake up Jarvis phrase");
        return;
      }
      const wakeTranscript = alternatives.find(text => wakePattern.test(normalize(text)));
      let routedAlternatives = alternatives;
      if (wakeTranscript) {
        if (!result.isFinal) return;
        const cleaned = normalize(wakeTranscript).replace(wakePattern, " ").replace(/\s+/g, " ").trim();
        jarvisAwake = true;
        voiceToggle.textContent = "AWAKE // LISTENING";
        voiceToggle.setAttribute("aria-label", "Jarvis is awake and listening for English commands");
        showWakeSky("AWAKE // LISTENING", "READY FOR A COMMAND");
        sayWithDeck("Command accepted.");
        if (!cleaned) return;
        routedAlternatives = [cleaned];
      } else if (!jarvisAwake || !result.isFinal) {
        return;
      }
      const activeText = normalize(activeJarvisSpeech || (Date.now() - lastJarvisSpeechAt < 4500 ? lastJarvisSpeech : ""));
      const isEcho = text => {
        const heard = normalize(text);
        if (!activeText || !heard) return false;
        const ratio = Math.min(activeText.length, heard.length) / Math.max(activeText.length, heard.length);
        return heard === activeText || (ratio > .82 && (activeText.includes(heard) || heard.includes(activeText)));
      };
      if (alternatives.every(isEcho)) return;
      if (faceScanActive) return;
      if (voiceEngine?.speaking) {
        voiceEngine.cancel();
        activeJarvisSpeech = "";
        coreOrb.classList.remove("is-speaking");
      }
      const thanksCommand = routedAlternatives.some(text => /\bthank you jarvis\b|\bthanks jarvis\b|\bjarvis thank you\b|\bjarvis thanks\b/i.test(normalize(text)));
      if (thanksCommand) {
        voiceToggle.textContent = "AWAKE // LISTENING";
        showWakeSky("COMMAND COMPLETE", "THANK YOU ACKNOWLEDGED");
        sayWithDeck("It's okay, sir.", () => showWakeSky("AWAKE // LISTENING", "READY FOR A COMMAND"));
        return;
      }
      voiceToggle.textContent = "PROCESSING...";
      showWakeSky("PROCESSING COMMAND", routedAlternatives[0] || "PORTFOLIO ACTION");
      const action = routedAlternatives.map(parseCommand).find(item => item?.target);
      if (!action?.target) {
        voiceToggle.textContent = "COMMAND NOT RECOGNIZED";
        sayWithDeck("I didn't understand that command. Try, open the IT spend and asset project, explain the tech stack, open identity, or show the projects.", () => showWakeSky("AWAKE // LISTENING", "READY FOR A COMMAND"));
        return;
      }
      const { target, dest, themeName } = action;
      const parent = entries.find(entry => entry.id === target.parent);
      const wheelEntry = parent || target;
      const index = items.findIndex(item => item.entry === wheelEntry);
      if (index >= 0) wheel.select(index);
      const label = dest === "face-scan" ? "FACE SCAN" : dest === "stack" ? "TECH STACK" : dest === "about" ? "IDENTITY" : dest === "projects" ? "PROJECT ARCHIVE" : dest === "themes" ? "THEMES" : dest === "theme" ? themeName.toUpperCase() + " THEME" : dest === "contact" ? "CONTACT" : target.label.replaceAll("-", " ");
      voiceToggle.textContent = "COMMAND ACCEPTED";
      showWakeSky("PROCESSING COMMAND", label);
      window.dispatchEvent(new CustomEvent("portfolio:scan", { detail: { mode: dest === "project" ? "projects" : dest === "theme" ? "themes" : dest === "face-scan" ? "face" : dest } }));
      const gate = document.createElement("div");
      gate.className = "hero-jump";
      gate.innerHTML = '<div class="jump-ring jump-ring-a"></div><div class="jump-ring jump-ring-b"></div><div class="jump-reactor"></div><p>COMMAND ACCEPTED</p><small>OPENING // ' + label.toUpperCase() + '</small>';
      document.body.append(gate);
      let details = "";
      if (dest === "stack") details = moduleSpeech.stack;
      else if (dest === "about") details = moduleSpeech.about;
      else if (dest === "projects") details = moduleSpeech.projects;
      else if (dest === "themes") details = "The Themes panel is open. Available color themes are " + themes.filter(theme => theme.included).map(theme => theme.name).join(", ") + ".";
      else if (dest === "theme") {
        applyTheme(themeName, true);
        details = "The " + themeName + " color theme is applied. The Themes panel is open.";
      } else if (dest === "contact") details = "Your email and profile links are in the identity panel.";
      else if (dest === "face-scan") details = "The holographic face landmark scan is ready. Please allow camera access.";
      else if (dest === "project") details = target.data?.description || "The selected project is now open in the portfolio window.";
      const response = dest === "theme" ? "Command accepted. Applying " + themeName + ". " + details : dest === "face-scan" ? "" : "Command accepted. Opening " + label + ". " + details;
      window.setTimeout(() => {
        if (dest === "face-scan") {
          faceScanActive = true;
          faceScanner.start();
        } else goTo(target);
        gate.classList.add("jump-exit");
        window.setTimeout(() => gate.remove(), 550);
        if (dest === "face-scan") showWakeSky("FACE SCAN IN PROGRESS", "WAITING FOR FACE LANDMARKS");
        else if (response) sayWithDeck(response, () => showWakeSky("AWAKE // LISTENING", "READY FOR A COMMAND"));
      }, reduced.matches ? 0 : 140);
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        voiceEnabled = false;
        listening = false;
        hideWakeSky();
        voiceToggle.setAttribute("aria-pressed", "false");
        voiceToggle.textContent = "MIC BLOCKED";
        voiceToggle.setAttribute("aria-label", "Microphone blocked. Allow microphone access for this site in browser settings.");
      } else if (event.error === "no-speech") {
        voiceToggle.textContent = "DIDN'T HEAR";
      } else if (event.error === "audio-capture") {
        voiceToggle.textContent = "MIC NOT FOUND";
      } else if (event.error === "network") {
        voiceToggle.textContent = "VOICE NETWORK ERROR";
      }
    };
    recognizer.onend = () => {
      listening = false;
      if (voiceEnabled && !voiceEngine?.speaking) restartTimer = window.setTimeout(startListening, 350);
    };
  }
  voiceToggle.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.setAttribute("aria-pressed", String(voiceEnabled));
    voiceToggle.setAttribute("aria-label", voiceEnabled ? "Turn Jarvis voice commands off" : "Turn Jarvis voice commands on");
    if (!voiceEnabled) {
      jarvisAwake = false;
      faceScanner.stop();
      hideWakeSky(true);
      stopListening();
      voiceToggle.textContent = "JARVIS // OFF";
      voiceEngine?.cancel();
      coreOrb.classList.remove("is-speaking");
      return;
    }
    voiceToggle.textContent = SpeechRecognition ? "ASLEEP // WAKE WORD" : "VOICE ONLY";
    if (SpeechRecognition) showWakeSky("STANDBY // WAKE WORD", "SAY WAKE UP JARVIS OR UTHO JARVIS");
    window.dispatchEvent(new CustomEvent("portfolio:scan", { detail: { mode: "about" } }));
    if (SpeechRecognition) {
      greetOnStart = true;
      try { recognizer.start(); listening = true; }
      catch {
        greetOnStart = false;
        sayWithDeck("Jarvis online and listening. Tell me which portfolio section or project to open.");
      }
    } else {
      sayWithDeck("Voice replies are on, but this browser does not support microphone commands.");
    }
  });

  const chooseEntry = (dest) => {
    if (dest === "about") return entries.find(e => e.kind === "about");
    if (dest === "projects") return entries.find(e => e.kind === "project") || entries.find(e => e.kind === "work") || entries[0];
    if (dest === "stack") return entries.find(e => e.kind === "stack") || entries.find(e => e.kind === "work") || entries[0];
    return entries[0];
  };
  deck.querySelectorAll(".hero-module").forEach((button) => {
    button.addEventListener("click", () => {
      const dest = button.dataset.dest;
      const target = chooseEntry(dest);
      if (!target) return;
      sayWithDeck(moduleSpeech[dest] || "Mission selected. Initiating navigation.");
      window.dispatchEvent(new CustomEvent("portfolio:scan", { detail: { mode: dest } }));
      const gate = document.createElement("div");
      gate.className = "hero-jump";
      gate.innerHTML = '<div class="jump-ring jump-ring-a"></div><div class="jump-ring jump-ring-b"></div><div class="jump-reactor"></div><p>INITIATING QUANTUM TRANSIT</p><small>DESTINATION LOCKED // ' + button.querySelector("b").textContent + '</small>';
      document.body.append(gate);
      button.classList.add("module-active");
      window.setTimeout(() => {
        open(target);
        gate.classList.add("jump-exit");
        window.setTimeout(() => { gate.remove(); button.classList.remove("module-active"); }, 550);
      }, reduced.matches ? 0 : 850);
    });
  });
  window.setTimeout(speakWelcome, 450);
})();
