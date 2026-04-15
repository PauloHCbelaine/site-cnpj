const DNS_ENDPOINT = "https://dns.google/resolve";
const CONTENT_PROXY = "https://r.jina.ai/http://";
const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const COMMON_PATHS = ["/", "/contato", "/contato/", "/sobre", "/sobre/", "/empresa", "/empresa/", "/quem-somos", "/institucional", "/footer", "/rodape"];
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
const csvUpload = document.querySelector("#csv-upload");
const uploadLabel = document.querySelector(".upload-label");
const statusPanelTitle = document.querySelector("#status-panel h2");
const statusText = document.querySelector("#status-text");
const mxResults = document.querySelector("#mx-results");
const cnpjResults = document.querySelector("#cnpj-results");
const clueResults = document.querySelector("#clue-results");
const summaryList = document.querySelector("#summary-list");
const progressContainer = document.querySelector("#progress-container");
const progressFill = document.querySelector("#progress-fill");
const progressText = document.querySelector("#progress-text");
const batchResultsSection = document.querySelector("#batch-results-section");
const batchResults = document.querySelector("#batch-results");

const mxTemplate = document.querySelector("#mx-item-template");
const cnpjTemplate = document.querySelector("#cnpj-item-template");
const clueTemplate = document.querySelector("#clue-item-template");
const batchTemplate = document.querySelector("#batch-item-template");

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