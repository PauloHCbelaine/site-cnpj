const DNS_ENDPOINT = "https://dns.google/resolve";
const CONTENT_PROXY = "https://r.jina.ai/http://";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const COMMON_PATHS = ["/", "/contato", "/contato/", "/sobre", "/sobre/", "/empresa", "/empresa/", "/quem-somos", "/institucional"];
const BR_SECOND_LEVEL_DOMAINS = new Set([
  "com.br",
  "org.br",
  "net.br",
  "gov.br",
  "edu.br",
  "jus.br",
  "mil.br",
  "blog.br",
  "adm.br",
  "adv.br",
  "art.br",
  "coop.br",
  "emp.br",
  "eng.br",
  "esp.br",
  "far.br",
  "fm.br",
  "fot.br",
  "ind.br",
  "inf.br",
  "radio.br",
  "rec.br",
  "srv.br",
  "tur.br",
]);

const form = document.querySelector("#lookup-form");
const input = document.querySelector("#domain-input");
const statusPanelTitle = document.querySelector("#status-panel h2");
const statusText = document.querySelector("#status-text");
const mxResults = document.querySelector("#mx-results");
const cnpjResults = document.querySelector("#cnpj-results");
const clueResults = document.querySelector("#clue-results");
const summaryList = document.querySelector("#summary-list");

const mxTemplate = document.querySelector("#mx-item-template");
const cnpjTemplate = document.querySelector("#cnpj-item-template");
const clueTemplate = document.querySelector("#clue-item-template");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawDomain = input.value.trim();
  const normalized = normalizeDomain(rawDomain);

  if (!normalized) {
    setStatus("Dominio invalido", "Digite um dominio valido, como empresa.com.br ou mail.empresa.com.");
    return;
  }

  prepareLoadingState(normalized.displayDomain);

  try {
    const [mxRecords, clues] = await Promise.all([
      lookupMx(normalized.rootDomain),
      inspectDomain(normalized.rootDomain),
    ]);

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
  } catch (error) {
    console.error(error);
    setStatus(
      "Falha na coleta",
      "Nao foi possivel concluir a pesquisa. Verifique a conexao do navegador ou teste novamente em alguns instantes."
    );
    mxResults.textContent = "A consulta de MX nao retornou dados.";
    cnpjResults.textContent = "A pesquisa de CNPJ nao retornou dados.";
    clueResults.textContent = "Nao foi possivel carregar pistas do site.";
  }
});

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

    return parseClue(text, pageUrl);
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
  const matches = text.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}\b/g) || [];
  const unique = matches.filter((value, index, array) => array.indexOf(value) === index);
  return unique.filter(cnpj => validateCnpj(cnpj));
}

function findOrganization(text) {
  const jsonLdMatch = text.match(/"name"\s*:\s*"([^"]+)"/i);
  if (jsonLdMatch?.[1]) {
    return jsonLdMatch[1].trim();
  }

  const copyrightMatch = text.match(/(?:copyright|todos os direitos reservados|©)\s+([^.\n|]{3,90})/i);
  if (copyrightMatch?.[1]) {
    return copyrightMatch[1].trim();
  }

  return null;
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

function prepareLoadingState(domain) {
  setStatus("Coletando dados", `Consultando MX, paginas principais e possiveis CNPJs publicados para ${domain}.`);
  mxResults.textContent = "Buscando registros MX...";
  cnpjResults.textContent = "Varrendo paginas por possiveis CNPJs...";
  clueResults.textContent = "Reunindo pistas institucionais...";
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