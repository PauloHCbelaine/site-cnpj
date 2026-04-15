const DNS_ENDPOINT = "https://dns.google/resolve";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const JINA_PROXY = "https://r.jina.ai/";

const COMMON_PATHS = ["/", "/contato", "/sobre", "/empresa", "/quem-somos", "/institucional"];
const BR_SECOND_LEVEL = new Set(["com.br", "co.br", "gov.br", "edu.br", "org.br", "net.br", "jus.br"]);

// DOM Elements
const form = document.querySelector("#lookup-form");
const input = document.querySelector("#domain-input");
const csvUpload = document.querySelector("#csv-upload");

const statusPanel = document.querySelector("#status-panel");
const statusText = document.querySelector("#status-text");
const statusHeading = statusPanel.querySelector("h2");
const progressContainer = document.querySelector("#progress-container");
const progressFill = document.querySelector("#progress-fill");
const progressText = document.querySelector("#progress-text");

const summaryList = document.querySelector("#summary-list");
const mxResults = document.querySelector("#mx-results");
const cnpjResults = document.querySelector("#cnpj-results");
const clueResults = document.querySelector("#clue-results");

const batchResultsSection = document.querySelector("#batch-results-section");
const batchResults = document.querySelector("#batch-results");

// Templates
const mxTemplate = document.querySelector("#mx-item-template");
const cnpjTemplate = document.querySelector("#cnpj-item-template");
const clueTemplate = document.querySelector("#clue-item-template");
const batchTemplate = document.querySelector("#batch-item-template");

// Utilities
function normalizeDomain(value) {
  const cleaned = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return null;

  const parts = cleaned.split(".").filter(Boolean);
  const suffix = parts.slice(-2).join(".");
  const isSecondLevel = parts.length > 2 && BR_SECOND_LEVEL.has(suffix);
  const rootDomain = isSecondLevel ? parts.slice(-3).join(".") : parts.length > 2 ? parts.slice(-2).join(".") : cleaned;

  return { displayDomain: cleaned, rootDomain };
}

function validateCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  let sum = 0, mult = 5;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]) * mult;
    mult = mult === 2 ? 9 : mult - 1;
  }
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(digits[8]) !== d1) return false;

  sum = 0;
  mult = 6;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * mult;
    mult = mult === 2 ? 9 : mult - 1;
  }
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;

  return parseInt(digits[10]) === d2;
}

function formatCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function extractCnpjs(text) {
  const cnpjs = new Set();
  const patterns = [
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    /\b\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}[\s\/\-.]?\d{4}[\s\-.]?\d{2}\b/g,
    /\b\d{14}\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const digits = match.replace(/\D/g, "");
        if (digits.length === 14 && validateCnpj(digits)) {
          cnpjs.add(formatCnpj(digits));
        }
      });
    }
  }
  return Array.from(cnpjs);
}

function findOrganization(text) {
  const jsonLd = text.match(/"name"\s*:\s*"([^"]{5,100})"/i);
  if (jsonLd?.[1]) return jsonLd[1].trim();

  const og = text.match(/property="og:title"\s+content="([^"]{5,100})"/i);
  if (og?.[1]) return og[1].trim();

  const copyright = text.match(/(?:©|copyright)\s+([^.\n|]{5,100})/i);
  if (copyright?.[1]) return copyright[1].trim();

  return null;
}

function classifyMxProvider(host) {
  const normalized = host.toLowerCase();
  
  const providers = {
    "Google Workspace": ["aspmx.l.google.com", "google.com"],
    "Microsoft 365": ["outlook.com", "hotmail.com", "microsoft.com"],
    "Zoho Mail": ["zoho.com"],
    "Amazon SES": ["amazonses.com"],
    "SendGrid": ["sendgrid.com"],
    "Mailgun": ["mailgun.org", "mailgun.com"],
  };
  
  for (const [provider, domains] of Object.entries(providers)) {
    if (domains.some(d => normalized.includes(d))) return provider;
  }
  
  const parts = normalized.split(".");
  return parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : "Outro";
}

// API Calls
async function lookupMx(domain) {
  try {
    const response = await fetch(`${DNS_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`);
    const data = await response.json();
    const answers = data.Answer || [];
    return answers
      .map(record => {
        const [priority, ...hostParts] = String(record.data).split(" ");
        const host = hostParts.join(" ").replace(/\.$/, "");
        return { host, priority, ttl: record.TTL, provider: classifyMxProvider(host) };
      })
      .filter(r => r.host);
  } catch (e) {
    console.error("MX lookup failed:", e);
    return [];
  }
}

async function fetchPage(domain, path = "/") {
  try {
    const response = await fetch(`${JINA_PROXY}http://${domain}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.text();
  } catch (e) {
    console.error(`Error fetching ${domain}${path}:`, e.message);
    return null;
  }
}

async function enrichCnpj(cnpj) {
  try {
    const response = await fetch(`${BRASIL_API}${cnpj.replace(/\D/g, "")}`);
    if (!response.ok) throw new Error("Not found");
    const data = await response.json();
    return {
      company: data.nome_fantasia || data.razao_social,
      status: data.descricao_situacao_cadastral,
      city: data.municipio,
      state: data.uf,
    };
  } catch (e) {
    return { company: "Empresa não identificada", status: "", city: "", state: "" };
  }
}

// Main Functions
async function inspectDomain(domain) {
  const clues = [];
  
  for (const path of COMMON_PATHS) {
    const html = await fetchPage(domain, path);
    if (!html || html.length < 80) continue;

    const cnpjs = extractCnpjs(html);
    const organization = findOrganization(html);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || organization || domain;
    
    clues.push({
      path,
      label: path === "/" ? "Principal" : path.replace(/\//g, "").toUpperCase(),
      title,
      organization,
      cnpjs: cnpjs.map(cnpj => ({ raw: cnpj, formatted: cnpj })),
      sourceUrl: `http://${domain}${path}`,
      body: html.substring(0, 200),
    });
  }
  
  return clues;
}

async function analyzeDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    alert("Domínio inválido");
    return;
  }

  setStatus("Pesquisando...", true);

  try {
    const [mxRecords, clues] = await Promise.all([
      lookupMx(normalized.rootDomain),
      inspectDomain(normalized.rootDomain),
    ]);

    const allCnpjs = clues.flatMap(c => c.cnpjs);
    const uniqueCnpjs = [...new Map(allCnpjs.map(c => [c.formatted, c])).values()];
    const enrichedCnpjs = await Promise.all(
      uniqueCnpjs.map(async cnpj => ({
        ...cnpj,
        ...await enrichCnpj(cnpj.formatted),
      }))
    );

    const organization = clues.find(c => c.organization)?.organization || null;
    
    renderResults(normalized, mxRecords, enrichedCnpjs, clues, organization);
    setStatus("Pesquisa concluída com sucesso", false);

  } catch (error) {
    console.error(error);
    setStatus("Erro na pesquisa", false);
  }
}

// Render Functions
function setStatus(text, isLoading) {
  if (isLoading) {
    statusPanel.style.display = "block";
    statusHeading.textContent = text;
    statusText.style.display = "none";
    progressContainer.style.display = "block";
    progressFill.style.width = "30%";
    progressText.textContent = "Processando...";
  } else {
    progressFill.style.width = "100%";
    progressText.textContent = text;
    setTimeout(() => {
      statusPanel.style.display = "block";
      statusHeading.textContent = text;
      statusText.style.display = "block";
      progressContainer.style.display = "none";
    }, 500);
  }
}

function updateSummary(domain, organization, cnpjCount, mxCount) {
  const dds = summaryList.querySelectorAll("dd");
  dds[0].textContent = domain.displayDomain;
  dds[1].textContent = domain.rootDomain;
  dds[2].textContent = organization || "Não identificada";
  dds[3].textContent = cnpjCount;
}

function renderResults(domain, mxRecords, cnpjs, clues, organization) {
  // Summary
  updateSummary(domain, organization, cnpjs.length, mxRecords.length);

  // MX
  mxResults.innerHTML = "";
  if (mxRecords.length === 0) {
    mxResults.classList.add("empty-state");
    mxResults.textContent = "Nenhum registro MX encontrado";
  } else {
    mxResults.classList.remove("empty-state");
    mxRecords.forEach(record => {
      const fragment = mxTemplate.content.cloneNode(true);
      fragment.querySelector("[data-host]").textContent = record.host;
      fragment.querySelector("[data-priority]").textContent = `Prioridade ${record.priority}`;
      fragment.querySelector("[data-meta]").textContent = `TTL: ${record.ttl}s • ${record.provider}`;
      mxResults.appendChild(fragment);
    });
  }

  // CNPJs
  cnpjResults.innerHTML = "";
  if (cnpjs.length === 0) {
    cnpjResults.classList.add("empty-state");
    cnpjResults.textContent = "Nenhum CNPJ encontrado";
  } else {
    cnpjResults.classList.remove("empty-state");
    cnpjs.forEach(cnpj => {
      const fragment = cnpjTemplate.content.cloneNode(true);
      fragment.querySelector("[data-cnpj]").textContent = cnpj.formatted;
      fragment.querySelector("[data-source]").textContent = "Evidência pública";
      fragment.querySelector("[data-company]").textContent = cnpj.company;
      
      const meta = [];
      if (cnpj.status) meta.push(cnpj.status);
      if (cnpj.city) meta.push(`${cnpj.city}/${cnpj.state}`);
      fragment.querySelector("[data-extra]").textContent = meta.join(" • ") || "Sem dados";
      
      cnpjResults.appendChild(fragment);
    });
  }

  // Clues
  clueResults.innerHTML = "";
  if (clues.length === 0) {
    clueResults.classList.add("empty-state");
    clueResults.textContent = "Nenhuma pista encontrada";
  } else {
    clueResults.classList.remove("empty-state");
    clues.forEach(clue => {
      const fragment = clueTemplate.content.cloneNode(true);
      fragment.querySelector("[data-label]").textContent = clue.label;
      fragment.querySelector("[data-title]").textContent = clue.title;
      fragment.querySelector("[data-body]").textContent = clue.body.substring(0, 150) + "...";
      const link = fragment.querySelector("[data-link]");
      link.href = clue.sourceUrl;
      clueResults.appendChild(fragment);
    });
  }
}

// Batch Processing
async function processBatch(domains) {
  batchResultsSection.style.display = "block";
  batchResults.innerHTML = "";
  setStatus(`Processando ${domains.length} domínios...`, true);

  const results = [];

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    progressFill.style.width = `${(i / domains.length) * 100}%`;
    progressText.textContent = `${i + 1}/${domains.length} - ${domain}`;

    try {
      const [mxRecords, clues] = await Promise.all([
        lookupMx(domain),
        inspectDomain(domain),
      ]);

      const cnpjs = clues.flatMap(c => c.cnpjs);
      const uniqueCnpjs = [...new Map(cnpjs.map(c => [c.formatted, c])).values()];
      const enrichedCnpjs = await Promise.all(
        uniqueCnpjs.slice(0, 3).map(async cnpj => ({
          ...cnpj,
          ...await enrichCnpj(cnpj.formatted),
        }))
      );

      const organization = clues.find(c => c.organization)?.organization || null;

      results.push({
        domain,
        mxCount: mxRecords.length,
        cnpjCount: enrichedCnpjs.length,
        organization,
        cnpjs: enrichedCnpjs,
        status: enrichedCnpjs.length > 0 ? "success" : "warning",
      });
    } catch (error) {
      results.push({
        domain,
        mxCount: 0,
        cnpjCount: 0,
        organization: null,
        cnpjs: [],
        status: "error",
      });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  renderBatchResults(results);
  setStatus(`${domains.length} domínios processados`, false);
}

function renderBatchResults(results) {
  batchResults.innerHTML = "";
  results.forEach(result => {
    const fragment = batchTemplate.content.cloneNode(true);
    fragment.querySelector("[data-domain]").textContent = result.domain;
    fragment.querySelector("[data-mx-count]").textContent = result.mxCount;
    fragment.querySelector("[data-cnpj-count]").textContent = result.cnpjCount;
    fragment.querySelector("[data-organization]").textContent = result.organization || "-";
    
    const badge = fragment.querySelector("[data-status]");
    badge.textContent = result.status === "success" ? "✓ OK" : result.status === "warning" ? "⚠ Parcial" : "✗ Erro";
    badge.className = `batch-status ${result.status}`;
    
    if (result.cnpjs.length > 0) {
      const cnpjList = fragment.querySelector("[data-cnpj-list]");
      cnpjList.style.display = "flex";
      fragment.querySelector("[data-cnpj-formatted]").textContent = result.cnpjs
        .map(c => c.formatted)
        .join(", ");
    }
    
    batchResults.appendChild(fragment);
  });
}

// CSV Parsing
async function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text
          .split("\n")
          .map(l => l.trim())
          .filter(l => l && l.includes("."));

        const domains = lines.map(line => {
          try {
            const url = new URL(line.startsWith("http") ? line : `http://${line}`);
            return url.hostname;
          } catch {
            return line;
          }
        }).filter(d => normalizeDomain(d));

        resolve([...new Set(domains)]);
      } catch (error) {
        reject(new Error("Erro ao ler arquivo: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsText(file);
  });
}

// Event Listeners
form.addEventListener("submit", (e) => {
  e.preventDefault();
  analyzeDomain(input.value);
  input.value = "";
});

csvUpload.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const domains = await parseCsvFile(file);
    if (domains.length === 0) {
      alert("Nenhum domínio válido encontrado");
      return;
    }
    await processBatch(domains);
  } catch (error) {
    alert("Erro: " + error.message);
  }
});
const DNS_ENDPOINT = "https://dns.google/resolve";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const JINA_PROXY = "https://r.jina.ai/";

const COMMON_PATHS = ["/", "/contato", "/sobre", "/empresa", "/quem-somos", "/institucional"];
const BR_SECOND_LEVEL = new Set(["com.br", "co.br", "gov.br", "edu.br", "org.br", "net.br", "jus.br"]);

// DOM Elements
const form = document.querySelector("#lookup-form");
const input = document.querySelector("#domain-input");
const csvUpload = document.querySelector("#csv-upload");

const statusPanel = document.querySelector("#status-panel");
const statusText = document.querySelector("#status-text");
const progressFill = document.querySelector("#progress-fill");
const progressText = document.querySelector("#progress-text");

const summaryPanel = document.querySelector("#summary-panel");
const summaryDomain = document.querySelector("#summary-domain");
const summaryOrg = document.querySelector("#summary-org");
const summaryCnpjCount = document.querySelector("#summary-cnpj-count");
const summaryMxCount = document.querySelector("#summary-mx-count");

const mxPanel = document.querySelector("#mx-panel");
const mxResults = document.querySelector("#mx-results");
const cnpjPanel = document.querySelector("#cnpj-panel");
const cnpjResults = document.querySelector("#cnpj-results");
const cluePanel = document.querySelector("#clue-panel");
const clueResults = document.querySelector("#clue-results");

const batchResultsSection = document.querySelector("#batch-results-section");
const batchResults = document.querySelector("#batch-results");

// Templates
const mxTemplate = document.querySelector("#mx-item-template");
const cnpjTemplate = document.querySelector("#cnpj-item-template");
const clueTemplate = document.querySelector("#clue-item-template");
const batchTemplate = document.querySelector("#batch-item-template");

// Utilities
function normalizeDomain(value) {
  const cleaned = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return null;

  const parts = cleaned.split(".").filter(Boolean);
  const suffix = parts.slice(-2).join(".");
  const isSecondLevel = parts.length > 2 && BR_SECOND_LEVEL.has(suffix);
  const rootDomain = isSecondLevel ? parts.slice(-3).join(".") : parts.length > 2 ? parts.slice(-2).join(".") : cleaned;

  return { displayDomain: cleaned, rootDomain };
}

function validateCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  let sum = 0, mult = 5;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]) * mult;
    mult = mult === 2 ? 9 : mult - 1;
  }
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(digits[8]) !== d1) return false;

  sum = 0;
  mult = 6;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * mult;
    mult = mult === 2 ? 9 : mult - 1;
  }
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;

  return parseInt(digits[10]) === d2;
}

function formatCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function extractCnpjs(text) {
  const cnpjs = new Set();
  const patterns = [
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    /\b\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}[\s\/\-.]?\d{4}[\s\-.]?\d{2}\b/g,
    /\b\d{14}\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const digits = match.replace(/\D/g, "");
        if (digits.length === 14 && validateCnpj(digits)) {
          cnpjs.add(formatCnpj(digits));
        }
      });
    }
  }
  return Array.from(cnpjs);
}

function findOrganization(text) {
  const jsonLd = text.match(/"name"\s*:\s*"([^"]{5,100})"/i);
  if (jsonLd?.[1]) return jsonLd[1].trim();

  const og = text.match(/property="og:title"\s+content="([^"]{5,100})"/i);
  if (og?.[1]) return og[1].trim();

  const copyright = text.match(/(?:©|copyright)\s+([^.\n|]{5,100})/i);
  if (copyright?.[1]) return copyright[1].trim();

  return null;
}

function classifyMxProvider(host) {
  const normalized = host.toLowerCase();
  
  const providers = {
    "Google Workspace": ["aspmx.l.google.com", "google.com"],
    "Microsoft 365": ["outlook.com", "hotmail.com", "microsoft.com"],
    "Zoho Mail": ["zoho.com"],
    "Amazon SES": ["amazonses.com"],
    "SendGrid": ["sendgrid.com"],
    "Mailgun": ["mailgun.org", "mailgun.com"],
  };
  
  for (const [provider, domains] of Object.entries(providers)) {
    if (domains.some(d => normalized.includes(d))) return provider;
  }
  
  const parts = normalized.split(".");
  return parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : "Outro";
}

// API Calls
async function lookupMx(domain) {
  try {
    const response = await fetch(`${DNS_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`);
    const data = await response.json();
    const answers = data.Answer || [];
    return answers
      .map(record => {
        const [priority, ...hostParts] = String(record.data).split(" ");
        const host = hostParts.join(" ").replace(/\.$/, "");
        return { host, priority, ttl: record.TTL, provider: classifyMxProvider(host) };
      })
      .filter(r => r.host);
  } catch (e) {
    console.error("MX lookup failed:", e);
    return [];
  }
}

async function fetchPage(domain, path = "/") {
  try {
    const response = await fetch(`${JINA_PROXY}http://${domain}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.text();
  } catch (e) {
    console.error(`Error fetching ${domain}${path}:`, e.message);
    return null;
  }
}

async function enrichCnpj(cnpj) {
  try {
    const response = await fetch(`${BRASIL_API}${cnpj.replace(/\D/g, "")}`);
    if (!response.ok) throw new Error("Not found");
    const data = await response.json();
    return {
      company: data.nome_fantasia || data.razao_social,
      status: data.descricao_situacao_cadastral,
      city: data.municipio,
      state: data.uf,
    };
  } catch (e) {
    return { company: "Empresa não identificada", status: "", city: "", state: "" };
  }
}

// Main Functions
async function inspectDomain(domain) {
  const clues = [];
  
  for (const path of COMMON_PATHS) {
    const html = await fetchPage(domain, path);
    if (!html || html.length < 80) continue;

    const cnpjs = extractCnpjs(html);
    const organization = findOrganization(html);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || organization || domain;
    
    clues.push({
      path,
      label: path === "/" ? "Principal" : path.replace(/\//g, "").toUpperCase(),
      title,
      organization,
      cnpjs: cnpjs.map(cnpj => ({ raw: cnpj, formatted: cnpj })),
      sourceUrl: `http://${domain}${path}`,
      body: html.substring(0, 200),
    });
  }
  
  return clues;
}

async function analyzeDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    alert("Domínio inválido");
    return;
  }

  setStatus("Pesquisando...", true);

  try {
    const [mxRecords, clues] = await Promise.all([
      lookupMx(normalized.rootDomain),
      inspectDomain(normalized.rootDomain),
    ]);

    const allCnpjs = clues.flatMap(c => c.cnpjs);
    const uniqueCnpjs = [...new Map(allCnpjs.map(c => [c.formatted, c])).values()];
    const enrichedCnpjs = await Promise.all(
      uniqueCnpjs.map(async cnpj => ({
        ...cnpj,
        ...await enrichCnpj(cnpj.formatted),
      }))
    );

    const organization = clues.find(c => c.organization)?.organization || null;
    
    renderResults(normalized, mxRecords, enrichedCnpjs, clues, organization);
    setStatus("Pesquisa concluída", false);

  } catch (error) {
    console.error(error);
    setStatus("Erro na pesquisa", false);
  }
}

// Render Functions
function setStatus(text, isLoading) {
  statusPanel.style.display = "block";
  statusText.textContent = text;
  
  if (isLoading) {
    progressFill.style.width = "30%";
    progressText.textContent = "Processando...";
  } else {
    progressFill.style.width = "100%";
    progressText.textContent = "Concluído";
    setTimeout(() => statusPanel.style.display = "none", 3000);
  }
}

function renderResults(domain, mxRecords, cnpjs, clues, organization) {
  // Summary
  summaryPanel.style.display = "block";
  summaryDomain.textContent = domain.displayDomain;
  summaryOrg.textContent = organization || "Não identificada";
  summaryCnpjCount.textContent = cnpjs.length;
  summaryMxCount.textContent = mxRecords.length;

  // MX
  mxPanel.style.display = "block";
  mxResults.innerHTML = "";
  if (mxRecords.length === 0) {
    mxResults.innerHTML = '<div class="empty-state">Nenhum registro MX encontrado</div>';
  } else {
    mxRecords.forEach(record => {
      const fragment = mxTemplate.content.cloneNode(true);
      fragment.querySelector("[data-provider]").textContent = record.provider;
      fragment.querySelector("[data-provider-type]").textContent = `Prioridade ${record.priority}`;
      fragment.querySelector("[data-host]").textContent = record.host;
      mxResults.appendChild(fragment);
    });
  }

  // CNPJs
  cnpjPanel.style.display = "block";
  cnpjResults.innerHTML = "";
  if (cnpjs.length === 0) {
    cnpjResults.innerHTML = '<div class="empty-state">Nenhum CNPJ encontrado</div>';
  } else {
    cnpjs.forEach(cnpj => {
      const fragment = cnpjTemplate.content.cloneNode(true);
      fragment.querySelector("[data-cnpj]").textContent = cnpj.formatted;
      fragment.querySelector("[data-company]").textContent = cnpj.company;
      
      const meta = [];
      if (cnpj.status) meta.push(cnpj.status);
      if (cnpj.city) meta.push(`${cnpj.city}/${cnpj.state}`);
      fragment.querySelector("[data-meta]").textContent = meta.join(" • ") || "Sem dados";
      
      cnpjResults.appendChild(fragment);
    });
  }

  // Clues
  cluePanel.style.display = "block";
  clueResults.innerHTML = "";
  if (clues.length === 0) {
    clueResults.innerHTML = '<div class="empty-state">Nenhuma pista encontrada</div>';
  } else {
    clues.forEach(clue => {
      const fragment = clueTemplate.content.cloneNode(true);
      fragment.querySelector("[data-label]").textContent = clue.label;
      fragment.querySelector("[data-title]").textContent = clue.title;
      fragment.querySelector("[data-body]").textContent = clue.body.substring(0, 120) + "...";
      const link = fragment.querySelector("[data-link]");
      link.href = clue.sourceUrl;
      clueResults.appendChild(fragment);
    });
  }
}

// Batch Processing
async function processBatch(domains) {
  batchResultsSection.style.display = "block";
  batchResults.innerHTML = "";
  setStatus(`Processando ${domains.length} domínios...`, true);

  const results = [];

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    progressFill.style.width = `${(i / domains.length) * 100}%`;
    progressText.textContent = `${i + 1}/${domains.length} - ${domain}`;

    try {
      const [mxRecords, clues] = await Promise.all([
        lookupMx(domain),
        inspectDomain(domain),
      ]);

      const cnpjs = clues.flatMap(c => c.cnpjs);
      const uniqueCnpjs = [...new Map(cnpjs.map(c => [c.formatted, c])).values()];
      const enrichedCnpjs = await Promise.all(
        uniqueCnpjs.slice(0, 1).map(async cnpj => ({
          ...cnpj,
          ...await enrichCnpj(cnpj.formatted),
        }))
      );

      const providers = [...new Set(mxRecords.map(r => r.provider))].join(", ");

      results.push({
        domain,
        cnpj: enrichedCnpjs[0]?.formatted || "-",
        company: enrichedCnpjs[0]?.company || "-",
        email: providers || "-",
        status: enrichedCnpjs.length > 0 ? "success" : "warning",
      });
    } catch (error) {
      results.push({
        domain,
        cnpj: "-",
        company: "Erro",
        email: "-",
        status: "error",
      });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  renderBatchResults(results);
  setStatus(`${domains.length} domínios processados`, false);
}

function renderBatchResults(results) {
  batchResults.innerHTML = "";
  results.forEach(result => {
    const fragment = batchTemplate.content.cloneNode(true);
    fragment.querySelector("[data-domain]").textContent = result.domain;
    fragment.querySelector("[data-cnpj]").textContent = result.cnpj;
    fragment.querySelector("[data-company]").textContent = result.company;
    fragment.querySelector("[data-email]").textContent = result.email;
    
    const badge = fragment.querySelector("[data-status]");
    badge.textContent = result.status === "success" ? "✓ OK" : result.status === "warning" ? "⚠ Parcial" : "✗ Erro";
    badge.className = `batch-status ${result.status}`;
    
    batchResults.appendChild(fragment);
  });
}

// CSV Parsing
async function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text
          .split("\n")
          .map(l => l.trim())
          .filter(l => l && l.includes("."));

        const domains = lines.map(line => {
          try {
            const url = new URL(line.startsWith("http") ? line : `http://${line}`);
            return url.hostname;
          } catch {
            return line;
          }
        }).filter(d => normalizeDomain(d));

        resolve([...new Set(domains)]);
      } catch (error) {
        reject(new Error("Erro ao ler arquivo: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsText(file);
  });
}

// Event Listeners
form.addEventListener("submit", (e) => {
  e.preventDefault();
  analyzeDomain(input.value);
  input.value = "";
});

csvUpload.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const domains = await parseCsvFile(file);
    if (domains.length === 0) {
      alert("Nenhum domínio válido encontrado");
      return;
    }
    await processBatch(domains);
  } catch (error) {
    alert("Erro: " + error.message);
  }
});
const DNS_ENDPOINT = "https://dns.google/resolve";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const JINA_PROXY = "https://r.jina.ai/";

// DOM
const form = document.querySelector("#lookup-form");
const input = document.querySelector("#domain-input");
const csvUpload = document.querySelector("#csv-upload");
const statusText = document.querySelector("#status-text");
const progressContainer = document.querySelector("#progress-container");
const progressFill = document.querySelector("#progress-fill");
const resultsContainer = document.querySelector("#results-container");
const domainName = document.querySelector("#domain-name");
const organizationName = document.querySelector("#organization-name");
const cnpjDisplay = document.querySelector("#cnpj-display");
const mxDisplay = document.querySelector("#mx-display");
const batchResultsContainer = document.querySelector("#batch-results-container");
const batchResults = document.querySelector("#batch-results");

// Templates
const cnpjTemplate = document.querySelector("#cnpj-card");
const mxTemplate = document.querySelector("#mx-card");
const batchTemplate = document.querySelector("#batch-item");

// Utils
function normalizeDomain(value) {
  const cleaned = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function validateCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  
  let sum = 0, multiplier = 5;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]) * multiplier;
    multiplier = multiplier === 2 ? 9 : multiplier - 1;
  }
  let remainder = sum % 11;
  const firstDigit = remainder < 2 ? 0 : 11 - remainder;
  
  if (parseInt(digits[8]) !== firstDigit) return false;
  
  sum = 0;
  multiplier = 6;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * multiplier;
    multiplier = multiplier === 2 ? 9 : multiplier - 1;
  }
  remainder = sum % 11;
  const secondDigit = remainder < 2 ? 0 : 11 - remainder;
  
  return parseInt(digits[10]) === secondDigit;
}

function formatCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function extractCnpjs(text) {
  const cnpjs = new Set();
  
  const patterns = [
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    /\b\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}[\s\/\-.]?\d{4}[\s\-.]?\d{2}\b/g,
    /\b\d{14}\b/g,
    /cnpj[\s:]*(\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}[\s\/\-.]?\d{4}[\s\-.]?\d{2})/gi,
    /(?:empresa|razao[\s_-]social|cnpj)[\s:=]*(\d{2}[\s\-./]*\d{3}[\s\-./]*\d{3}[\s\-./]*\d{4}[\s\-./]*\d{2})/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const digits = match.replace(/\D/g, "");
        if (digits.length === 14 && validateCnpj(digits)) {
          cnpjs.add(formatCnpj(digits));
        }
      });
    }
  }
  
  return Array.from(cnpjs);
}

function findOrganization(text) {
  const jsonLd = text.match(/"name"\s*:\s*"([^"]{5,100})"/i);
  if (jsonLd?.[1]) return jsonLd[1].trim();
  
  const og = text.match(/property="og:title"\s+content="([^"]{5,100})"/i);
  if (og?.[1]) return og[1].trim();
  
  const copyright = text.match(/(?:©|copyright)\s+([^.\n|]{5,100})/i);
  if (copyright?.[1]) return copyright[1].trim();
  
  return null;
}

function getProviderName(host) {
  const normalized = host.toLowerCase();
  
  const providers = {
    "google": "Google Workspace",
    "outlook": "Microsoft 365",
    "hotmail": "Microsoft 365",
    "microsoft": "Microsoft 365",
    "zoho": "Zoho Mail",
    "amazonses": "Amazon SES",
    "sendgrid": "SendGrid",
    "mailgun": "Mailgun",
    "awsemailsupport": "AWS SES",
  };
  
  for (const [key, provider] of Object.entries(providers)) {
    if (normalized.includes(key)) {
      return provider;
    }
  }
  
  const parts = normalized.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
  }
  
  return "Outro";
}

// API Calls
async function lookupMx(domain) {
  try {
    const response = await fetch(`${DNS_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`);
    const data = await response.json();
    const answers = data.Answer || [];
    
    return answers.map(record => {
      const [priority, ...hostParts] = String(record.data).split(" ");
      const host = hostParts.join(" ").replace(/\.$/, "");
      return { host, priority };
    }).filter(r => r.host);
  } catch (e) {
    console.error("MX lookup failed:", e);
    return [];
  }
}

async function fetchPage(domain) {
  try {
    const response = await fetch(`${JINA_PROXY}http://${domain}`, {
      signal: AbortSignal.timeout(8000)
    });
    
    if (!response.ok) {
      console.warn(`HTTP ${response.status} for ${domain}`);
      return null;
    }
    
    return await response.text();
  } catch (e) {
    console.error(`Error fetching ${domain}:`, e.message);
    return null;
  }
}

async function enrichCnpj(cnpj) {
  try {
    const response = await fetch(`${BRASIL_API}${cnpj.replace(/\D/g, "")}`);
    if (!response.ok) throw new Error("Not found");
    
    const data = await response.json();
    return {
      company: data.nome_fantasia || data.razao_social,
      status: data.descricao_situacao_cadastral,
      city: data.municipio,
      state: data.uf
    };
  } catch (e) {
    return { company: "Empresa não identificada", status: "", city: "", state: "" };
  }
}

// Main
async function analyzeDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    alert("Domínio inválido");
    return;
  }
  
  statusText.textContent = "Buscando...";
  progressContainer.style.display = "block";
  resultsContainer.style.display = "none";
  
  try {
    const [mxRecords, pageHtml] = await Promise.all([
      lookupMx(normalized),
      fetchPage(normalized)
    ]);
    
    let cnpjs = [];
    if (pageHtml) {
      cnpjs = extractCnpjs(pageHtml);
    }
    
    const enrichedCnpjs = await Promise.all(
      cnpjs.map(async cnpj => ({
        formatted: cnpj,
        ...await enrichCnpj(cnpj)
      }))
    );
    
    let organization = null;
    if (pageHtml) {
      organization = findOrganization(pageHtml);
    }
    
    renderResults(normalized, organization, enrichedCnpjs, mxRecords);
    
  } catch (e) {
    console.error(e);
    statusText.textContent = "Erro na pesquisa";
    progressContainer.style.display = "none";
  }
}

function renderResults(domain, organization, cnpjs, mxRecords) {
  progressContainer.style.display = "none";
  resultsContainer.style.display = "block";
  
  domainName.textContent = domain;
  organizationName.textContent = organization || "Não identificada";
  
  if (cnpjs.length === 0) {
    cnpjDisplay.innerHTML = '<p class="empty">Não encontrado</p>';
  } else {
    cnpjDisplay.innerHTML = cnpjs.map(cnpj => {
      const fragment = cnpjTemplate.content.cloneNode(true);
      fragment.querySelector("[data-cnpj]").textContent = cnpj.formatted;
      fragment.querySelector("[data-company]").textContent = cnpj.company;
      
      const meta = [];
      if (cnpj.status) meta.push(cnpj.status);
      if (cnpj.city) meta.push(`${cnpj.city}/${cnpj.state}`);
      fragment.querySelector("[data-meta]").textContent = meta.join(" • ") || "Sem dados";
      
      return fragment;
    }).map(f => f.firstElementChild.outerHTML).join("");
  }
  
  const providers = new Set();
  if (mxRecords.length === 0) {
    mxDisplay.innerHTML = '<p class="empty">Nenhum registro</p>';
  } else {
    mxRecords.forEach(record => {
      const provider = getProviderName(record.host);
      providers.add(provider);
    });
    
    mxDisplay.innerHTML = Array.from(providers).map(provider => {
      const fragment = mxTemplate.content.cloneNode(true);
      fragment.querySelector("[data-provider]").textContent = provider;
      fragment.querySelector("[data-details]").textContent = `Detectado na infraestrutura de email`;
      return fragment;
    }).map(f => f.firstElementChild.outerHTML).join("");
  }
  
  statusText.textContent = `✓ Pesquisa concluída para ${domain}`;
}

async function processBatch(domains) {
  batchResultsContainer.style.display = "block";
  batchResults.innerHTML = "";
  statusText.textContent = `Processando ${domains.length} domínios...`;
  progressContainer.style.display = "block";
  
  const results = [];
  
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const percent = Math.round((i / domains.length) * 100);
    progressFill.style.width = percent + "%";
    
    try {
      const [mxRecords, pageHtml] = await Promise.all([
        lookupMx(domain),
        fetchPage(domain)
      ]);
      
      let cnpjs = [];
      let organization = null;
      
      if (pageHtml) {
        cnpjs = extractCnpjs(pageHtml);
        organization = findOrganization(pageHtml);
      }
      
      const enrichedCnpjs = await Promise.all(
        cnpjs.slice(0, 1).map(async cnpj => ({
          formatted: cnpj,
          ...await enrichCnpj(cnpj)
        }))
      );
      
      const providers = new Set();
      mxRecords.forEach(r => providers.add(getProviderName(r.host)));
      
      results.push({
        domain,
        cnpj: enrichedCnpjs[0]?.formatted || "-",
        company: enrichedCnpjs[0]?.company || "-",
        email: Array.from(providers).join(", ") || "-",
        status: enrichedCnpjs.length > 0 ? "success" : "warning"
      });
    } catch (e) {
      results.push({
        domain,
        cnpj: "-",
        company: "Erro",
        email: "-",
        status: "error"
      });
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  progressFill.style.width = "100%";
  renderBatchResults(results);
  statusText.textContent = `Análise de ${domains.length} domínios concluída`;
  progressContainer.style.display = "none";
}

function renderBatchResults(results) {
  batchResults.innerHTML = results.map(result => {
    const fragment = batchTemplate.content.cloneNode(true);
    fragment.querySelector("[data-domain]").textContent = result.domain;
    fragment.querySelector("[data-cnpj]").textContent = result.cnpj;
    fragment.querySelector("[data-company]").textContent = result.company;
    fragment.querySelector("[data-email]").textContent = result.email;
    
    const badge = fragment.querySelector(".badge");
    badge.textContent = result.status === "success" ? "✓ OK" : result.status === "warning" ? "⚠ Parcial" : "✗ Erro";
    badge.className = `badge ${result.status}`;
    
    return fragment;
  }).map(f => f.firstElementChild.outerHTML).join("");
}

async function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split("\n")
          .map(l => l.trim())
          .filter(l => l.length > 0 && l.includes("."));
        
        const domains = lines.map(line => {
          try {
            const url = new URL(line.startsWith("http") ? line : `http://${line}`);
            return url.hostname;
          } catch {
            return line;
          }
        }).filter(d => normalizeDomain(d));
        
        const unique = [...new Set(domains)];
        resolve(unique);
      } catch (e) {
        reject(new Error("Erro ao ler arquivo: " + e.message));
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsText(file);
  });
}

// Events
form.addEventListener("submit", (e) => {
  e.preventDefault();
  analyzeDomain(input.value);
});

csvUpload.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const domains = await parseCsvFile(file);
    if (domains.length === 0) {
      alert("Nenhum domínio válido encontrado");
      return;
    }
    resultsContainer.style.display = "none";
    await processBatch(domains);
  } catch (e) {
    alert("Erro: " + e.message);
  }
});
const DNS_ENDPOINT = "https://dns.google/resolve";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const JINA_PROXY = "https://r.jina.ai/";

// Elementos do DOM
const form = document.querySelector("#lookup-form");
const input = document.querySelector("#domain-input");
const csvUpload = document.querySelector("#csv-upload");
const statusText = document.querySelector("#status-text");
const progressContainer = document.querySelector("#progress-container");
const progressFill = document.querySelector("#progress-fill");
const resultsContainer = document.querySelector("#results-container");
const domainName = document.querySelector("#domain-name");
const organizationName = document.querySelector("#organization-name");
const cnpjDisplay = document.querySelector("#cnpj-display");
const mxDisplay = document.querySelector("#mx-display");
const batchResultsContainer = document.querySelector("#batch-results-container");
const batchResults = document.querySelector("#batch-results");

// Templates
const cnpjTemplate = document.querySelector("#cnpj-card");
const mxTemplate = document.querySelector("#mx-card");
const batchTemplate = document.querySelector("#batch-item");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawDomain = input.value.trim();
  const normalized = normalizeDomain(rawDomain);

  if (!normalized) {
    setStatus("Dominio invalido", "Digite um dominio valido, como empresa.com.br ou mail.empresa.com.");
    return;
  }

  batchResultsSection.style.display = "none";
  prepareLoadingState(normalized.displayDomain, 1);

  try {
    const [mxRecords, clues] = await Promise.all([
      lookupMx(normalized.rootDomain),
      inspectDomain(normalized.rootDomain),
    ]);

    updateProgress(100, "Processando resultados...");

    const cnpjs = uniqueBy(clues.flatMap((clue) => clue.cnpjs), (item) => item.formatted);
    const enrichedCnpjs = await enrichCnpjs(cnpjs);
    renderSummary(normalized, clues, enrichedCnpjs);
    renderMx(mxRecords);
    renderCnpjs(enrichedCnpjs);
    renderClues(clues);

    const organization = clues.find((clue) => clue.organization)?.organization || inferOrganization(clues);
    setStatus(
      "Analise concluida",
      organization
        ? `Encontramos sinais de ${organization}, ${enrichedCnpjs.length} CNPJ(s) candidato(s) e ${mxRecords.length} registro(s) MX para ${normalized.rootDomain}.`
        : `Coleta finalizada para ${normalized.rootDomain} com ${mxRecords.length} registro(s) MX e ${enrichedCnpjs.length} CNPJ(s) candidato(s).`
    );
    hideProgress();
  } catch (error) {
    console.error(error);
    setStatus(
      "Falha na coleta",
      "Nao foi possivel concluir a pesquisa. Verifique a conexao do navegador ou teste novamente em alguns instantes."
    );
    mxResults.textContent = "A consulta de MX nao retornou dados.";
    cnpjResults.textContent = "A pesquisa de CNPJ nao retornou dados.";
    clueResults.textContent = "Nao foi possivel carregar pistas do site.";
    hideProgress();
  }
});

csvUpload.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  batchResultsSection.style.display = "none";
  try {
    const domains = await parseCsvFile(file);
    
    if (!domains || domains.length === 0) {
      setStatus("Erro na planilha", "Nenhum dominio encontrado. Verifique o formato do arquivo.");
      return;
    }

    await processBatch(domains);
  } catch (error) {
    console.error(error);
    setStatus("Erro ao processar", `Erro ao ler o arquivo: ${error.message}`);
  }
});

uploadLabel.addEventListener("click", () => csvUpload.click());

function normalizeDomain(value) {
  const cleaned = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return null;
  }

  const parts = cleaned.split(".").filter(Boolean);
  const suffix = parts.slice(-2).join(".");
  const usesBrSecondLevel = parts.length > 2 && BR_SECOND_LEVEL_DOMAINS.has(suffix);
  const rootDomain = usesBrSecondLevel ? parts.slice(-3).join(".") : parts.length > 2 ? parts.slice(-2).join(".") : cleaned;

  return {
    displayDomain: cleaned,
    rootDomain,
  };
}

async function lookupMx(domain) {
  const url = `${DNS_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`;
  const response = await fetch(url);
  const data = await response.json();
  const answers = data.Answer || [];

  return answers
    .map((record) => {
      const [priority, ...hostParts] = String(record.data).split(" ");
      const host = hostParts.join(" ").replace(/\.$/, "");
      return {
        host,
        priority,
        ttl: record.TTL,
        provider: classifyMxProvider(host),
      };
    })
    .filter((record) => record.host);
}

function classifyMxProvider(host) {
  const normalized = host.toLowerCase();
  
  const providers = {
    "Google Workspace": ["aspmx.l.google.com", "google.com"],
    "Microsoft 365": ["outlook.com", "hotmail.com", "microsoft.com"],
    "Zoho Mail": ["zoho.com"],
    "Amazon SES": ["amazonses.com"],
    "SendGrid": ["sendgrid.com"],
    "Mailgun": ["mailgun.org", "mailgun.com"],
    "AWS": ["awsemailsupport.com"],
  };
  
  for (const [provider, domains] of Object.entries(providers)) {
    if (domains.some(d => normalized.includes(d))) {
      return provider;
    }
  }
  
  return "Provedor desconhecido";
}

async function inspectDomain(domain) {
  const tasks = COMMON_PATHS.map(async (path) => fetchClueForPath(domain, path));

  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

async function fetchClueForPath(domain, path) {
  const pageUrl = `http://${domain}${path}`;

  try {
    const response = await fetch(`${CONTENT_PROXY}${domain}${path}`);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    if (!text || text.length < 80) {
      return null;
    }

    const clue = parseClue(text, pageUrl);
    
    // Se não encontrou CNPJ e temos acesso ao HTML, busca de forma mais agressiva
    if (clue && clue.cnpjs.length === 0) {
      const aggressiveCnpjs = extractCnpjsAggressive(text);
      clue.cnpjs = aggressiveCnpjs.map((cnpj) => ({
        raw: cnpj,
        digits: onlyDigits(cnpj),
        formatted: formatCnpj(cnpj),
        sourceUrl: pageUrl,
      }));
    }
    
    return clue;
  } catch {
    return null;
  }
}

function parseClue(text, sourceUrl) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines.slice(0, 8).join(" ").slice(0, 160);
  const organization = findOrganization(text);
  const cnpjs = extractCnpjs(text).map((cnpj) => ({
    raw: cnpj,
    digits: onlyDigits(cnpj),
    formatted: formatCnpj(cnpj),
    sourceUrl,
  }));

  return {
    sourceUrl,
    label: guessPageLabel(sourceUrl),
    title: organization || heading || sourceUrl,
    body: summarizeText(lines),
    organization,
    cnpjs,
  };
}

function extractCnpjs(text) {
  const patterns = [
    // Padrão formatado: XX.XXX.XXX/XXXX-XX
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    // Padrão com espaços/caracteres: XX XXX XXX XXXX XX
    /\b\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}[\s\/\-.]?\d{4}[\s\-.]?\d{2}\b/g,
    // Padrão sem formatação: 14 dígitos
    /\b\d{14}\b/g,
    // CNPJ após "CNPJ:" ou "CNPJ ="
    /(?:cnpj|cnpj:|cnpj\s*=|cnpj\s*:)[\s]*([\d.\-/\s]+)/gi,
    // Padrão em contexto de rodapé
    /(?:empresa|cnpj|registr)\s*(?:n[°º]|:)?\s*([\d.\-/\s]{14,20})/gi,
  ];
  
  const matches = new Set();
  
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) {
      found.forEach(match => {
        // Extrai números da match
        const digits = match.replace(/\D/g, '');
        if (digits.length === 14 && validateCnpj(match)) {
          matches.add(formatCnpj(digits));
        }
      });
    }
  }
  
  return Array.from(matches);
}

function findOrganization(text) {
  // Schema.org / JSON-LD
  const jsonLdMatch = text.match(/"name"\s*:\s*"([^"]+)"/i);
  if (jsonLdMatch?.[1]) {
    return jsonLdMatch[1].trim();
  }

  // Meta tags OpenGraph
  const ogMatch = text.match(/property="og:title"\s+content="([^"]+)"/i);
  if (ogMatch?.[1]) {
    return ogMatch[1].trim();
  }

  // Copyright/rodapé
  const copyrightMatch = text.match(/(?:copyright|todos os direitos reservados|©)\s+([^.\n|]{3,90})/i);
  if (copyrightMatch?.[1]) {
    return copyrightMatch[1].trim();
  }
  
  // Razão social em meta tags
  const companyMatch = text.match(/(?:company|empresa|razao[_-]social)\s*[=:]\s*["']?([^"'\n]{5,90})/i);
  if (companyMatch?.[1]) {
    return companyMatch[1].trim();
  }

  return null;
}

function extractCnpjsAggressive(text) {
  // Busca ainda mais agressiva - procura em todo o HTML
  const cnpjs = new Set();
  
  // Busca em atributos data-*
  const dataMatches = text.match(/data-(?:cnpj|company|empresa)[^>]*[=\s](["']?[\d.\-/\s]+["']?)/gi);
  if (dataMatches) {
    dataMatches.forEach(m => {
      const digits = m.replace(/\D/g, '');
      if (digits.length === 14 && validateCnpj(m)) {
        cnpjs.add(formatCnpj(m));
      }
    });
  }
  
  // Busca em scripts JSON
  const scriptMatches = text.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches) {
    scriptMatches.forEach(script => {
      try {
        const matches = script.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g);
        if (matches) {
          matches.forEach(m => {
            if (validateCnpj(m)) {
              cnpjs.add(formatCnpj(m));
            }
          });
        }
      } catch (e) {
        // Ignora erros de parsing
      }
    });
  }
  
  return Array.from(cnpjs);
}

function summarizeText(lines) {
  return lines
    .filter((line) => line.length > 30)
    .slice(0, 2)
    .join(" ")
    .slice(0, 240) || "Conteudo institucional localizado, mas sem resumo suficiente.";
}

function guessPageLabel(url) {
  if (url.includes("/contato")) return "Contato";
  if (url.includes("/sobre")) return "Sobre";
  if (url.includes("/empresa")) return "Empresa";
  if (url.includes("/quem-somos")) return "Quem somos";
  if (url.includes("/institucional")) return "Institucional";
  return "Pagina principal";
}

async function enrichCnpjs(cnpjs) {
  const tasks = cnpjs.map(async (item) => {
    if (item.digits.length !== 14) {
      return {
        ...item,
        companyName: "Formato localizado, mas incompleto",
        extra: `Origem: ${item.sourceUrl}`,
      };
    }

    try {
      const response = await fetch(`${BRASIL_API}${item.digits}`);
      if (!response.ok) {
        throw new Error("cnpj enrichment failed");
      }

      const company = await response.json();
      return {
        ...item,
        companyName: company.razao_social || company.nome_fantasia || "Empresa localizada",
        extra: [company.descricao_situacao_cadastral, company.municipio, company.uf].filter(Boolean).join(" | "),
      };
    } catch {
      return {
        ...item,
        companyName: "CNPJ identificado no site",
        extra: `Nao foi possivel enriquecer via BrasilAPI. Origem: ${item.sourceUrl}`,
      };
    }
  });

  return Promise.all(tasks);
}

function renderSummary(domainData, clues, cnpjs) {
  const organization = inferOrganization(clues);
  const values = [
    domainData.displayDomain,
    domainData.rootDomain,
    organization || "Nao identificado",
    cnpjs.length ? `${cnpjs.length} candidato(s)` : "Nenhum localizado",
  ];

  [...summaryList.querySelectorAll("dd")].forEach((element, index) => {
    element.textContent = values[index];
  });
}

function renderMx(records) {
  mxResults.innerHTML = "";

  if (!records.length) {
    mxResults.textContent = "Nenhum registro MX encontrado.";
    mxResults.classList.add("empty-state");
    return;
  }

  mxResults.classList.remove("empty-state");

  records.forEach((record) => {
    const fragment = mxTemplate.content.cloneNode(true);
    fragment.querySelector("[data-host]").textContent = record.host;
    fragment.querySelector("[data-priority]").textContent = `Prioridade ${record.priority}`;
    fragment.querySelector("[data-meta]").textContent = `TTL: ${record.ttl}s • ${record.provider}`;
    mxResults.appendChild(fragment);
  });
}

function renderCnpjs(cnpjs) {
  cnpjResults.innerHTML = "";

  if (!cnpjs.length) {
    cnpjResults.textContent = "Nenhum CNPJ foi identificado nas paginas verificadas.";
    cnpjResults.classList.add("empty-state");
    return;
  }

  cnpjResults.classList.remove("empty-state");

  cnpjs.forEach((item) => {
    const fragment = cnpjTemplate.content.cloneNode(true);
    fragment.querySelector("[data-cnpj]").textContent = item.formatted || item.raw;
    fragment.querySelector("[data-source]").textContent = "Evidencia publica";
    fragment.querySelector("[data-company]").textContent = item.companyName;
    fragment.querySelector("[data-extra]").textContent = item.extra;
    cnpjResults.appendChild(fragment);
  });
}

function renderClues(clues) {
  clueResults.innerHTML = "";

  if (!clues.length) {
    clueResults.textContent = "Nao encontramos paginas acessiveis para extrair pistas.";
    clueResults.classList.add("empty-state");
    return;
  }

  clueResults.classList.remove("empty-state");

  clues.forEach((clue) => {
    const fragment = clueTemplate.content.cloneNode(true);
    fragment.querySelector("[data-label]").textContent = clue.label;
    fragment.querySelector("[data-title]").textContent = clue.title;
    fragment.querySelector("[data-body]").textContent = clue.body;
    const link = fragment.querySelector("[data-link]");
    link.href = clue.sourceUrl;
    clueResults.appendChild(fragment);
  });
}

function prepareLoadingState(domain, totalItems = 1) {
  setStatus("Coletando dados", `Consultando MX, paginas principais e possiveis CNPJs publicados para ${domain}.`);
  mxResults.textContent = "Buscando registros MX...";
  cnpjResults.textContent = "Varrendo paginas por possiveis CNPJs...";
  clueResults.textContent = "Reunindo pistas institucionais...";
  showProgress(totalItems);
}

function setStatus(title, description) {
  statusPanelTitle.textContent = title;
  statusText.textContent = description;
}

function inferOrganization(clues) {
  return clues.find((clue) => clue.organization)?.organization || null;
}

function onlyDigits(value) {
  return String(value).replace(/\D/g, "");
}

function formatCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) {
    return value;
  }

  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function validateCnpj(value) {
  const digits = onlyDigits(value);
  
  if (digits.length !== 14) {
    return false;
  }
  
  // Rejeita sequencias repetidas
  if (/^(\d)\1{13}$/.test(digits)) {
    return false;
  }
  
  // Calcula primeiro digito verificador
  let sum = 0;
  let multiplier = 5;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]) * multiplier;
    multiplier = multiplier === 2 ? 9 : multiplier - 1;
  }
  let remainder = sum % 11;
  const firstDigit = remainder < 2 ? 0 : 11 - remainder;
  
  if (parseInt(digits[8]) !== firstDigit) {
    return false;
  }
  
  // Calcula segundo digito verificador
  sum = 0;
  multiplier = 6;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * multiplier;
    multiplier = multiplier === 2 ? 9 : multiplier - 1;
  }
  remainder = sum % 11;
  const secondDigit = remainder < 2 ? 0 : 11 - remainder;
  
  return parseInt(digits[9]) === secondDigit;
}

function uniqueBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function showProgress(totalItems = 1) {
  progressContainer.style.display = "block";
  statusText.style.display = "none";
  updateProgress(0, `Processando 0 de ${totalItems}...`);
}

function hideProgress() {
  progressContainer.style.display = "none";
  statusText.style.display = "block";
}

function updateProgress(percent, text) {
  progressFill.style.width = percent + "%";
  progressText.textContent = text;
}

async function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let lines = [];
        
        // Se for XLSX, tenta interpretar como CSV básico
        if (file.name.endsWith('.xlsx')) {
          // Nota: Para XLSX completo, seria necessário usar uma biblioteca como xlsx
          // Por enquanto, tentamos extrair URLs básicas
          lines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && (line.includes('.') || line.match(/^https?:/)));
        } else {
          // CSV parsing
          lines = text.split('\n')
            .map(line => {
              // Remove aspas se existirem
              return line.replace(/^["']|["']$/g, '').trim();
            })
            .filter(line => line.length > 0);
        }

        // Normaliza e valida domínios
        const domains = lines
          .map(line => {
            // Extrai domínio se for URL completa
            if (line.includes('://')) {
              return new URL(line).hostname;
            }
            return line;
          })
          .filter(domain => domain && domain.includes('.'))
          .map(domain => normalizeDomain(domain))
          .filter(Boolean)
          .map(d => d.rootDomain);

        // Remove duplicatas
        const unique = [...new Set(domains)];
        resolve(unique);
      } catch (error) {
        reject(new Error(`Erro ao ler arquivo: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'));
    reader.readAsText(file);
  });
}

async function processBatch(domains) {
  batchResults.innerHTML = "";
  batchResultsSection.style.display = "block";
  mxResults.innerHTML = "";
  cnpjResults.innerHTML = "";
  clueResults.innerHTML = "";
  
  prepareLoadingState(`${domains.length} domínios`, domains.length);

  const results = [];
  
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    updateProgress(Math.floor((i / domains.length) * 100), `Processando ${i + 1} de ${domains.length}: ${domain}`);
    
    try {
      const [mxRecords, clues] = await Promise.all([
        lookupMx(domain).catch(() => []),
        inspectDomain(domain).catch(() => []),
      ]);

      const cnpjs = uniqueBy(clues.flatMap((clue) => clue.cnpjs), (item) => item.formatted);
      const enrichedCnpjs = await enrichCnpjs(cnpjs);
      const organization = clues.find((clue) => clue.organization)?.organization || inferOrganization(clues);

      results.push({
        domain,
        mxCount: mxRecords.length,
        cnpjCount: enrichedCnpjs.length,
        organization,
        cnpjs: enrichedCnpjs,
        error: false,
      });
    } catch (error) {
      console.error(`Erro ao processar ${domain}:`, error);
      results.push({
        domain,
        mxCount: 0,
        cnpjCount: 0,
        organization: null,
        cnpjs: [],
        error: true,
      });
    }
    
    // Delay entre requisições para evitar rate limit
    if (i < domains.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  updateProgress(100, "Renderizando resultados...");
  renderBatchResults(results);
  
  setStatus(
    "Análise em lote concluída",
    `${domains.length} domínios processados. ${results.filter(r => !r.error).length} sucessos, ${results.filter(r => r.error).length} erros.`
  );
  
  hideProgress();
}

function renderBatchResults(results) {
  batchResults.innerHTML = "";

  results.forEach((result) => {
    const fragment = batchTemplate.content.cloneNode(true);
    
    fragment.querySelector("[data-domain]").textContent = result.domain;
    
    const statusBadge = fragment.querySelector("[data-status]");
    statusBadge.textContent = result.error ? "Erro" : "OK";
    if (result.error) {
      statusBadge.classList.add("error");
    }
    
    fragment.querySelector("[data-mx-count]").textContent = result.mxCount;
    fragment.querySelector("[data-cnpj-count]").textContent = result.cnpjCount;
    fragment.querySelector("[data-organization]").textContent = result.organization || "-";
    
    if (result.cnpjs.length > 0) {
      const cnpjListRow = fragment.querySelector("[data-cnpj-list]");
      cnpjListRow.style.display = "flex";
      fragment.querySelector("[data-cnpj-formatted]").textContent = result.cnpjs
        .map(c => c.formatted || c.raw)
        .join(", ");
    }
    
    batchResults.appendChild(fragment);
  });
}