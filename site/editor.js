import { createArchive } from "./archive.js";
import { createWatch } from "./watch.js";
import { createBar } from "./bar.js";
import { createWheel } from "./wheel.js";
import { createTerminal } from "./terminal.js";
import { createBlueprint } from "./blueprint.js";
import { createTips } from "./tip.js";
import { createLightbox } from "./lightbox.js";

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
  const sayWithDeck = (message) => {
    if (!voiceEnabled || !voiceEngine) return;
    voiceEngine.cancel();
    refreshVoices();
    activeJarvisSpeech = message;
    lastJarvisSpeech = message;
    lastJarvisSpeechAt = Date.now();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = preferredVoice?.lang || "en-IN";
    utterance.rate = 0.88;
    utterance.pitch = 0.7;
    utterance.volume = 1;
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.onstart = () => coreOrb.classList.add("is-speaking");
    utterance.onend = () => { activeJarvisSpeech = ""; coreOrb.classList.remove("is-speaking"); startListening(); };
    utterance.onerror = () => { activeJarvisSpeech = ""; coreOrb.classList.remove("is-speaking"); startListening(); };
    voiceEngine.speak(utterance);
  };
  const moduleSpeech = {
    about: "Identity protocol activated. I am Devanshu Dwivedi, a Computer Science graduate focused on Data Analytics. I am open to opportunities across India.",
    projects: "Projects archive activated. Explore my analytics work, including sales and customer analytics, IT spend and asset utilization, Superstore sales insights, and hotel booking demand analysis. Each project links to its source repository.",
    stack: "Technology systems online. My practical foundations are Excel, SQL fundamentals, and Power BI. I am actively developing skills in Python, statistics, data cleaning, PySpark, and Amazon Web Services."
  };
  const greeting = () => sayWithDeck("Good day. All systems are online. Welcome to Devanshu Dwivedi's portfolio. Select a mission to explore identity, projects, or technology stack.");
  coreOrb.addEventListener("click", greeting);
  coreOrb.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      greeting();
    }
  });
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
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
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 5;
    let wakeArmed = false;
    const normalizeVoice = (value) => value.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
      let command = normalizeVoice(raw);
      if (/\bhey jarvis\b/.test(command)) {
        wakeArmed = true;
        command = command.replace(/\bhey jarvis\b/g, " ").replace(/\s+/g, " ").trim();
      }
      if (!command && wakeArmed) return { wakeOnly: true };
      const themeEntry = entries.find(entry => entry.kind === "themes");
      const themeName = [...palettes.keys()].find(name => command.includes(name));
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
      voiceToggle.textContent = "LISTENING";
      voiceToggle.setAttribute("aria-label", "Jarvis is listening for English commands");
      if (greetOnStart) {
        greetOnStart = false;
        sayWithDeck("Jarvis online and listening. Tell me which portfolio section or project to open.");
      }
    };
    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result.isFinal) return;
      const alternatives = Array.from(result, item => item.transcript);
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
      const stopCommand = alternatives.some(text => /\b(?:hey\s+)?jarvis\s+stop\b|\bstop\s+jarvis\b|\bstop\b|\bsilence\b|\bbe quiet\b|\bcancel speech\b/i.test(normalize(text)));
      if (stopCommand) {
        voiceEngine?.cancel();
        activeJarvisSpeech = "";
        coreOrb.classList.remove("is-speaking");
        voiceToggle.textContent = "LISTENING";
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
      if (voiceEngine?.speaking) {
        voiceEngine.cancel();
        activeJarvisSpeech = "";
        coreOrb.classList.remove("is-speaking");
      }
      voiceToggle.textContent = "PROCESSING...";
      const action = alternatives.map(parseCommand).find(item => item?.target || item?.wakeOnly);
      if (action?.wakeOnly) {
        voiceToggle.textContent = "LISTENING";
        sayWithDeck("Yes sir. What would you like me to open?");
        return;
      }
      if (!action?.target) {
        voiceToggle.textContent = "COMMAND NOT RECOGNIZED";
        sayWithDeck("I didn't understand that command. Try, open the IT spend and asset project, explain the tech stack, open identity, or show the projects.");
        return;
      }
      const { target, dest, themeName } = action;
      wakeArmed = false;
      const parent = entries.find(entry => entry.id === target.parent);
      const wheelEntry = parent || target;
      const index = items.findIndex(item => item.entry === wheelEntry);
      if (index >= 0) wheel.select(index);
      const label = dest === "stack" ? "TECH STACK" : dest === "about" ? "IDENTITY" : dest === "projects" ? "PROJECT ARCHIVE" : dest === "themes" ? "THEMES" : dest === "theme" ? themeName.toUpperCase() + " THEME" : dest === "contact" ? "CONTACT" : target.label.replaceAll("-", " ");
      voiceToggle.textContent = "COMMAND ACCEPTED";
      window.dispatchEvent(new CustomEvent("portfolio:scan", { detail: { mode: dest === "project" ? "projects" : dest === "theme" ? "themes" : dest } }));
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
      else if (dest === "project") details = target.data?.description || "The selected project is now open in the portfolio window.";
      const response = dest === "theme" ? "Command accepted. Applying " + themeName + ". " + details : "Command accepted. Opening " + label + ". " + details;
      window.setTimeout(() => {
        goTo(target);
        gate.classList.add("jump-exit");
        window.setTimeout(() => gate.remove(), 550);
        sayWithDeck(response);
      }, reduced.matches ? 0 : 700);
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        voiceEnabled = false;
        listening = false;
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
      stopListening();
      voiceToggle.textContent = "JARVIS // OFF";
      voiceEngine?.cancel();
      coreOrb.classList.remove("is-speaking");
      return;
    }
    voiceToggle.textContent = SpeechRecognition ? "JARVIS // ON" : "VOICE ONLY";
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
})();
