"use strict";

/* ============================================================
   Radar de CNPJ — descobre o CNPJ do dono de um domínio.

   Ordem das fontes (da mais confiável para a menos):
   1. RDAP do Registro.br: registro oficial do domínio .br,
      traz o CNPJ do titular. Só funciona para domínios .br.
   2. O próprio site (lido pelo r.jina.ai): procura CNPJs no texto
      da home e de páginas comuns (contato, privacidade...).
   3. BrasilAPI: confirma na Receita Federal se o CNPJ existe,
      e traz razão social, situação e cidade.
   ============================================================ */

const API = {
  rdap: "https://rdap.registro.br/domain/",
  dns: ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"],
  reader: "https://r.jina.ai/",
  cnpj: "https://brasilapi.com.br/api/cnpj/v1/",
};

// Páginas onde sites brasileiros costumam publicar o CNPJ.
// A home vem primeiro; as outras só são lidas se a home não tiver CNPJ.
const SITE_PATHS = ["/", "/contato", "/politica-de-privacidade", "/sobre", "/quem-somos", "/termos-de-uso"];

// Categorias de segundo nível do .br (ex.: empresa.com.br, escritorio.adv.br).
const BR_SLD = new Set(("adm adv agr am app arq art ato b bib bio blog bmd cim cng cnt com coop " +
  "cri def des det dev ecn eco edu emp enf eng esp etc eti far flog fnd fot fst g12 geo ggf gov imb ind inf " +
  "jor jus leg lel log mat med mil mp mus net nom not ntr odo ong org ppg pro psc psi qsl radio rec rep " +
  "seg sjc slg srv taxi tc tec teo tmp trd tur tv vet vlog wiki zlg").split(" "));

const BATCH_CONCURRENCY = 3;
const cache = new Map();

/* ---------------- utilidades ---------------- */

const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");

function formatCnpj(v) {
  const d = onlyDigits(v);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(v);
}

// Valida os dois dígitos verificadores (módulo 11).
function isValidCnpj(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digit = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

/** Aceita domínio, URL ou e-mail. Retorna { host, root } ou null. */
function normalizeDomain(value) {
  let s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop(); // e-mail
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#:\s]/)[0].replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s)) return null;

  const parts = s.split(".");
  const tld = parts.at(-1);
  let rootLen = 2;
  if (tld === "br" && parts.length >= 3 && BR_SLD.has(parts.at(-2))) rootLen = 3;
  else if (parts.length >= 3 && parts.at(-2).length <= 3 && tld.length === 2 && ["com", "co", "net", "org", "gov", "edu"].includes(parts.at(-2))) rootLen = 3; // ex.: empresa.co.uk
  return { host: s, root: parts.slice(-rootLen).join(".") };
}

async function fetchWithTimeout(url, { timeout = 15000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

/* ---------------- fontes ---------------- */

/** 1. Registro oficial do domínio (.br). */
function lookupRdap(root) {
  return cached("rdap:" + root, async () => {
    if (!root.endsWith(".br")) return { status: "skip", note: "RDAP do Registro.br só cobre domínios .br" };
    const res = await fetchWithTimeout(API.rdap + encodeURIComponent(root));
    if (res.status === 404) return { status: "none", note: "Domínio não encontrado no Registro.br" };
    if (res.status === 429) return { status: "error", note: "Registro.br limitou as consultas, tente em 1 minuto" };
    if (!res.ok) return { status: "error", note: `Registro.br respondeu ${res.status}` };

    const data = await res.json();
    const holder = (data.entities || []).find((e) => (e.roles || []).includes("registrant"));
    const name = holder?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] || null;
    const ids = holder?.publicIds || [];
    const cnpj = ids.find((i) => i.type === "cnpj")?.identifier;
    const created = (data.events || []).find((e) => e.eventAction === "registration")?.eventDate;

    if (cnpj) return { status: "found", cnpj: onlyDigits(cnpj), name, created, note: `Titular: ${name || "?"}` };
    if (ids.some((i) => i.type === "cpf")) return { status: "none", name, note: "Titular é pessoa física (CPF)" };
    return { status: "none", name, note: "Registro sem CNPJ público" };
  });
}

/** MX via DNS-over-HTTPS (com servidor reserva). */
function lookupMx(root) {
  return cached("mx:" + root, async () => {
    for (const base of API.dns) {
      try {
        const res = await fetchWithTimeout(`${base}?name=${encodeURIComponent(root)}&type=MX`, {
          headers: { accept: "application/dns-json" },
          timeout: 8000,
        });
        if (!res.ok) continue;
        const data = await res.json();
        return (data.Answer || [])
          .filter((a) => a.type === 15)
          .map((a) => {
            const [prio, host] = String(a.data).split(/\s+/);
            const clean = (host || "").replace(/\.$/, "");
            return { priority: Number(prio), host: clean, provider: mxProvider(clean) };
          })
          .sort((a, b) => a.priority - b.priority);
      } catch { /* tenta o próximo servidor */ }
    }
    throw new Error("DNS indisponível");
  });
}

function mxProvider(host) {
  const h = host.toLowerCase();
  const known = [
    ["Google Workspace", /google(mail)?\.com$/],
    ["Microsoft 365", /(outlook|protection\.outlook|office365)\.com$/],
    ["Zoho Mail", /zoho\.(com|eu|in)$/],
    ["Locaweb", /locaweb\.com\.br$/],
    ["KingHost", /kinghost\.net$/],
    ["UOL Host", /uolhost|uol\.com\.br$/],
    ["Hostgator", /hostgator|websitewelcome\.com$/],
    ["Titan", /titan\.email$/],
    ["Proofpoint", /pphosted\.com$/],
    ["Mimecast", /mimecast\.com$/],
  ];
  return known.find(([, re]) => re.test(h))?.[0] || "Outro / próprio";
}

/** 2. Lê o site e procura CNPJs no texto. Home primeiro; se não tiver CNPJ, as outras páginas em paralelo. */
async function scanSite(host, { maxPages = SITE_PATHS.length } = {}) {
  const read = async (path) => {
    const url = `https://${host}${path}`;
    return { url, ...(await cached("page:" + url, () => readPage(url))) };
  };
  const [home, ...rest] = SITE_PATHS.slice(0, maxPages);
  const pages = [await read(home)];
  // Se o leitor bloqueou (limite), não adianta insistir.
  if (!pages[0].cnpjs?.length && pages[0].status !== "limit") pages.push(...(await Promise.all(rest.map(read))));
  return {
    pages,
    title: pages.find((p) => p.title)?.title || null,
    cnpjs: pages.flatMap((p) => p.cnpjs || []),
  };
}

async function readPage(url) {
  let res;
  try {
    res = await fetchWithTimeout(API.reader + url, { timeout: 25000 });
  } catch {
    return { status: "error", note: "tempo esgotado" };
  }
  if (res.status === 429) return { status: "limit", note: "limite do leitor de páginas (aguarde 1 min)" };
  if (!res.ok) return { status: "error", note: `HTTP ${res.status}` };

  const text = await res.text();
  const warn = text.match(/^Warning: Target URL returned error (\d+)/m);
  if (warn) return { status: "error", note: `site respondeu ${warn[1]}` };

  return {
    status: "ok",
    title: text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || null,
    cnpjs: findCnpjsInText(text, url),
  };
}

/** Acha CNPJs válidos e guarda o trecho ao redor, para mostrar como evidência. */
function findCnpjsInText(text, url) {
  const re = /(?<!\d)\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}(?!\d)/g;
  const found = new Map();
  for (const m of text.matchAll(re)) {
    const digits = onlyDigits(m[0]);
    if (!isValidCnpj(digits) || found.has(digits)) continue;
    const before = text.slice(Math.max(0, m.index - 90), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const snippet = (before + m[0] + after).replace(/\s+/g, " ").replace(/[*_#[\]]/g, "").trim();
    // CNPJ citado ao lado de "desenvolvido por", "agência" etc. costuma ser do fornecedor, não do dono.
    const thirdParty = /(desenvolvid|criad[oa] por|feito por|ag[eê]ncia|hospedad|powered|parceir|intermedia|pagamento)/i.test(before.slice(-60));
    const labeled = /cnpj|raz[aã]o social|inscri/i.test(before.slice(-40));
    found.set(digits, { cnpj: digits, url, snippet, thirdParty, labeled });
  }
  return [...found.values()];
}

/** 3. Dados na Receita (BrasilAPI). */
function lookupCnpj(cnpj) {
  return cached("cnpj:" + cnpj, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchWithTimeout(API.cnpj + cnpj, { timeout: 15000 });
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (res.status === 404) return { found: false };
      if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
      const d = await res.json();
      return {
        found: true,
        razao: d.razao_social,
        fantasia: d.nome_fantasia,
        situacao: d.descricao_situacao_cadastral,
        cidade: d.municipio ? `${d.municipio}/${d.uf}` : "",
        abertura: d.data_inicio_atividade,
        atividade: d.cnae_fiscal_descricao,
        email: (d.email || "").toLowerCase(),
        matriz: d.descricao_identificador_matriz_filial,
      };
    }
    throw new Error("BrasilAPI limitou as consultas");
  });
}

/* ---------------- análise ---------------- */

const CONF = { alta: 3, media: 2, baixa: 1 };

/**
 * Junta as evidências de todas as fontes e dá uma nota de confiança a cada CNPJ.
 * mode "full" lê todas as páginas comuns; "fast" (lote) só lê o site se o RDAP não achar nada.
 */
async function analyze(input, { mode = "full", onStep = () => {} } = {}) {
  const dom = normalizeDomain(input);
  if (!dom) throw new Error("Domínio inválido");
  const sources = [];
  const candidates = new Map();
  const add = (cnpj, evidence) => {
    const c = candidates.get(cnpj) || { cnpj, evidence: [] };
    c.evidence.push(evidence);
    candidates.set(cnpj, c);
  };

  onStep("Consultando registro do domínio e DNS…");
  const [rdap, mx] = await Promise.allSettled([lookupRdap(dom.root), lookupMx(dom.root)]);

  if (rdap.status === "fulfilled") {
    const r = rdap.value;
    sources.push({ name: "Registro.br (RDAP)", ok: r.status === "found", skip: r.status === "skip", note: r.note });
    if (r.status === "found") add(r.cnpj, { kind: "rdap", text: `Titular do domínio ${dom.root}: ${r.name}` });
  } else {
    sources.push({ name: "Registro.br (RDAP)", ok: false, note: "falha na consulta" });
  }

  const mxRecords = mx.status === "fulfilled" ? mx.value : null;
  sources.push({
    name: "DNS (MX)",
    ok: !!mxRecords?.length,
    note: mxRecords ? (mxRecords.length ? `${mxRecords.length} registro(s)` : "domínio sem MX") : "DNS indisponível",
  });

  let site = { pages: [], title: null, cnpjs: [] };
  if (mode === "full" || candidates.size === 0) {
    onStep("Lendo o site em busca de CNPJ…");
    site = await scanSite(dom.host, { maxPages: mode === "full" ? SITE_PATHS.length : 3 });
    for (const p of site.pages) {
      const path = new URL(p.url).pathname;
      sources.push({
        name: `Site ${path}`,
        ok: p.status === "ok" && p.cnpjs.length > 0,
        note: p.status === "ok" ? (p.cnpjs.length ? `${p.cnpjs.length} CNPJ(s)` : "sem CNPJ") : p.note,
      });
    }
    for (const c of site.cnpjs) add(c.cnpj, { kind: "site", text: c.snippet, url: c.url, thirdParty: c.thirdParty, labeled: c.labeled });
  }

  onStep("Confirmando CNPJs na Receita…");
  const list = [...candidates.values()].slice(0, 5);
  await Promise.all(list.map(async (c) => {
    try { c.receita = await lookupCnpj(c.cnpj); } catch (e) { c.receita = { error: e.message }; }
  }));
  if (list.length) {
    const okCount = list.filter((c) => c.receita?.found).length;
    sources.push({ name: "Receita (BrasilAPI)", ok: okCount > 0, note: `${okCount} de ${list.length} confirmado(s)` });
  }

  for (const c of list) scoreCandidate(c, dom);

  // Os 8 primeiros dígitos identificam a empresa; o resto, a filial.
  // Uma filial de um CNPJ já confirmado é da mesma empresa.
  const strongRoots = new Set(list.filter((c) => c.confidence === "alta").map((c) => c.cnpj.slice(0, 8)));
  for (const c of list) {
    if (c.confidence !== "alta" && strongRoots.has(c.cnpj.slice(0, 8)) && c.receita?.found !== false) {
      c.confidence = "alta";
      c.reasons.unshift("mesma empresa (outra filial) do CNPJ confirmado");
    }
  }

  list.sort((a, b) => CONF[b.confidence] - CONF[a.confidence] || b.evidence.length - a.evidence.length);

  return { dom, mx: mxRecords, sources, candidates: list, best: list[0] || null, siteTitle: site.title };
}

function scoreCandidate(c, dom) {
  const reasons = [];
  const kinds = new Set(c.evidence.map((e) => e.kind));
  const emailMatch = c.receita?.email && c.receita.email.endsWith("@" + dom.root);
  let level = "baixa";

  if (kinds.has("rdap")) { level = "alta"; reasons.push("é o titular oficial do domínio"); }
  if (emailMatch) { level = "alta"; reasons.push(`e-mail na Receita é @${dom.root}`); }
  if (kinds.has("site")) {
    const ev = c.evidence.filter((e) => e.kind === "site");
    const allThirdParty = ev.every((e) => e.thirdParty);
    if (allThirdParty) reasons.push("aparece no site perto de “desenvolvido por / agência” — pode ser fornecedor");
    else {
      reasons.push("publicado no próprio site");
      if (level === "baixa") level = "media";
    }
  }
  if (c.receita && c.receita.found === false) { level = "baixa"; reasons.push("não existe na Receita"); }
  if (c.receita?.situacao && c.receita.situacao !== "ATIVA") reasons.push(`situação: ${c.receita.situacao}`);

  c.confidence = level;
  c.reasons = reasons;
}

/* ---------------- interface ---------------- */

const $ = (sel) => document.querySelector(sel);

/** Cria elementos sem innerHTML (texto vindo de sites é sempre tratado como texto). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const badge = (level) => h("span", { class: `badge ${level}` },
  level === "alta" ? "Confiança alta" : level === "media" ? "Confiança média" : "Confiança baixa");

function setStatus(text, { loading = false, error = false } = {}) {
  $("#status").hidden = !text;
  $("#status").classList.toggle("error", error);
  $("#status-text").textContent = text || "";
  $("#spinner").hidden = !loading;
}

function setProgress(done, total) {
  $("#progress").hidden = total == null;
  if (total) $("#progress-fill").style.width = `${Math.round((done / total) * 100)}%`;
}

function setBusy(busy) {
  $("#lookup-btn").disabled = busy;
  $("#file-input").disabled = busy;
}

function renderSingle(r) {
  $("#batch").hidden = true;
  $("#single").hidden = false;
  const best = r.best;
  const answer = $("#answer");
  answer.replaceChildren();

  if (best) {
    const rf = best.receita || {};
    answer.append(
      h("p", { class: "kicker" }, r.dom.host),
      h("div", { class: "answer-head" },
        h("h2", { class: "cnpj" }, formatCnpj(best.cnpj)),
        badge(best.confidence)),
      h("p", { class: "company" }, rf.razao || r.siteTitle || "Razão social não confirmada"),
      h("dl", { class: "facts" },
        fact("Nome fantasia", rf.fantasia),
        fact("Situação", rf.situacao),
        fact("Cidade", rf.cidade),
        fact("Atividade", rf.atividade),
        fact("Aberta em", rf.abertura && new Date(rf.abertura + "T00:00").toLocaleDateString("pt-BR"))),
      h("p", { class: "muted" }, "Por quê: " + best.reasons.join("; ") + "."),
    );
  } else {
    answer.append(
      h("p", { class: "kicker" }, r.dom.host),
      h("h2", {}, "Nenhum CNPJ encontrado"),
      h("p", { class: "muted" }, r.dom.root.endsWith(".br")
        ? "O registro do domínio não mostra CNPJ e o site não publica um nas páginas comuns."
        : "Domínios fora do .br não têm registro público com CNPJ, e o site não publica um nas páginas comuns."),
    );
  }

  const cand = $("#candidates");
  cand.replaceChildren(...(r.candidates.length ? r.candidates.map(renderCandidate) : [h("p", { class: "empty" }, "Nenhum candidato.")]));

  $("#sources").replaceChildren(...r.sources.map((s) =>
    h("li", { class: s.skip ? "skip" : s.ok ? "ok" : "no" },
      h("span", { class: "dot" }), h("strong", {}, s.name), h("span", { class: "muted" }, s.note))));

  const mx = $("#mx");
  if (!r.mx) mx.replaceChildren(h("p", { class: "empty" }, "Não foi possível consultar o DNS."));
  else if (!r.mx.length) mx.replaceChildren(h("p", { class: "empty" }, "Este domínio não recebe e-mail (sem MX)."));
  else mx.replaceChildren(...r.mx.map((m) =>
    h("div", { class: "row" }, h("code", {}, m.host), h("span", { class: "muted" }, `${m.provider} · prioridade ${m.priority}`))));
}

function fact(label, value) {
  if (!value) return null;
  return h("div", {}, h("dt", {}, label), h("dd", {}, value));
}

function renderCandidate(c) {
  const rf = c.receita || {};
  return h("div", { class: "candidate" },
    h("div", { class: "row" }, h("strong", {}, formatCnpj(c.cnpj)), badge(c.confidence)),
    h("p", {}, rf.razao || (rf.found === false ? "Não encontrado na Receita" : rf.error ? `Receita: ${rf.error}` : "—")),
    ...c.evidence.map((e) => h("p", { class: "evidence" },
      h("span", { class: "tag" }, e.kind === "rdap" ? "Registro.br" : "Site"),
      e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, "“" + e.text + "”") : e.text)),
  );
}

/* ---------------- lote ---------------- */

let batchRows = [];

async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  let rows;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    await loadSheetJs();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    rows = wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }));
  } else {
    const text = await file.text();
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    rows = text.split(/\r?\n/).map((line) => line.split(sep).map((c) => c.replace(/^"|"$/g, "")));
  }

  // Procura domínios em qualquer célula (site, URL ou e-mail).
  const seen = new Map();
  const freeMail = /^(gmail|hotmail|outlook|yahoo|bol|uol|live|icloud|terra|ig)\./;
  for (const row of rows) {
    for (const cell of row || []) {
      const s = String(cell ?? "").trim();
      if (!s || s.length > 300 || !s.includes(".")) continue;
      const d = normalizeDomain(s);
      if (d && !freeMail.test(d.root) && !seen.has(d.root)) seen.set(d.root, d.host);
    }
  }
  return [...seen.values()];
}

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("não consegui carregar o leitor de Excel"));
    document.head.append(s);
  });
}

async function runBatch(domains) {
  $("#single").hidden = true;
  $("#batch").hidden = false;
  $("#export-btn").disabled = true;
  $("#batch-title").textContent = `Resultados (${domains.length} domínios)`;
  const body = $("#batch-body");
  body.replaceChildren();
  batchRows = domains.map((d) => {
    const tr = h("tr", {}, h("td", {}, d), h("td", { colspan: 5, class: "muted" }, "na fila…"));
    body.append(tr);
    return { domain: d, tr };
  });

  let done = 0;
  setProgress(0, domains.length);
  const queue = [...batchRows];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      row.tr.lastChild.textContent = "analisando…";
      try {
        row.result = await analyze(row.domain, { mode: "fast" });
      } catch (e) {
        row.error = e.message;
      }
      fillBatchRow(row);
      done++;
      setProgress(done, domains.length);
      setStatus(`Analisando planilha: ${done} de ${domains.length}`, { loading: done < domains.length });
    }
  };
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));

  const found = batchRows.filter((r) => r.result?.best).length;
  setStatus(`Pronto: CNPJ encontrado para ${found} de ${domains.length} domínios.`);
  setProgress(null);
  $("#export-btn").disabled = false;
}

function fillBatchRow(row) {
  const b = row.result?.best;
  const rf = b?.receita || {};
  const mx = row.result?.mx;
  row.tr.replaceChildren(
    h("td", {}, row.domain),
    h("td", {}, b ? h("code", {}, formatCnpj(b.cnpj)) : h("span", { class: "muted" }, row.error || "não encontrado")),
    h("td", {}, rf.razao || ""),
    h("td", {}, rf.situacao || ""),
    h("td", {}, b ? badge(b.confidence) : ""),
    h("td", {}, mx ? (mx.length ? mx[0].provider : "sem MX") : ""),
  );
}

function exportCsv() {
  const header = ["dominio", "cnpj", "razao_social", "nome_fantasia", "situacao", "cidade", "confianca", "motivo", "provedor_email"];
  const lines = batchRows.map((r) => {
    const b = r.result?.best;
    const rf = b?.receita || {};
    return [r.domain, b ? formatCnpj(b.cnpj) : "", rf.razao, rf.fantasia, rf.situacao, rf.cidade,
      b?.confidence, b?.reasons.join("; ") || r.error, r.result?.mx?.[0]?.provider];
  });
  // ";" e BOM para o Excel em português abrir certo.
  const csv = "﻿" + [header, ...lines]
    .map((cols) => cols.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "radar-cnpj.csv" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- eventos ---------------- */

$("#lookup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $("#domain-input").value;
  if (!normalizeDomain(value)) {
    setStatus("Domínio inválido. Use algo como empresa.com.br.", { error: true });
    return;
  }
  setBusy(true);
  try {
    const result = await analyze(value, { onStep: (t) => setStatus(t, { loading: true }) });
    renderSingle(result);
    setStatus(null);
  } catch (err) {
    console.error(err);
    setStatus("Falhou: " + err.message, { error: true });
  } finally {
    setBusy(false);
  }
});

$("#file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  setBusy(true);
  try {
    setStatus("Lendo planilha…", { loading: true });
    const domains = await readSpreadsheet(file);
    if (!domains.length) {
      setStatus("Não achei nenhum domínio na planilha.", { error: true });
      return;
    }
    await runBatch(domains);
  } catch (err) {
    console.error(err);
    setStatus("Erro na planilha: " + err.message, { error: true });
  } finally {
    setBusy(false);
  }
});

$("#export-btn").addEventListener("click", exportCsv);
