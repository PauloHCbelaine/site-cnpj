/**
 * Sistema robusto de extração de CNPJ de URLs
 * Estratégia: Scraping → Regex → Validação → IA (fallback)
 * 
 * Requisitos:
 * - npm install axios cheerio dotenv
 * - npm install @google/generative-ai (opcional, para IA)
 * 
 * Uso:
 * const extractor = new CNPJExtractor({ apiKey: process.env.GEMINI_API_KEY });
 * const result = await extractor.extract('https://empresa.com.br');
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Páginas comuns onde empresas publicam CNPJ
 */
const COMMON_PATHS = [
  '/',
  '/contato',
  '/contato/',
  '/sobre',
  '/sobre/',
  '/empresa',
  '/empresa/',
  '/quem-somos',
  '/quem-somos/',
  '/institucional',
  '/institucional/',
  '/footer',
  '/rodape',
  '/termos',
  '/privacidade',
];

/**
 * Regex para detectar padrões de CNPJ
 */
const CNPJ_PATTERNS = [
  /\b(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})\b/g,
  /\b(\d{2})\.(\d{3})\.(\d{3})/\d{4}-(\d{2})\b/g,
  /CNPJ[:\s]+(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})/gi,
  /CNPJ[:\s]*(\d{14})/gi,
];

/**
 * Selectors CSS comuns para campos de CNPJ
 */
const CNPJ_SELECTORS = [
  '[data-cnpj]',
  '[data-value*="cnpj"]',
  '[id*="cnpj"]',
  '[name*="cnpj"]',
  '[class*="cnpj"]',
  'div.cnpj',
  'span.cnpj',
  'p:contains("CNPJ")',
  'footer',
  '[role="contentinfo"]',
];

/**
 * Classe principal para extração de CNPJ
 */
class CNPJExtractor {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 10000;
    this.useAI = options.useAI !== false && !!this.apiKey;
    this.cache = new Map();
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    
    if (this.useAI && this.apiKey) {
      this.gemini = new GoogleGenerativeAI(this.apiKey);
    }
  }

  /**
   * Função principal de extração
   * @param {string} url - URL da empresa
   * @returns {Promise<{cnpj: string|null, score: number, source: string, validated: boolean, confidence: number}>}
   */
  async extract(url) {
    console.log(`\n🔍 Iniciando extração de CNPJ para: ${url}`);

    // Validar URL
    if (!this.isValidUrl(url)) {
      return {
        cnpj: null,
        score: 0,
        source: 'invalid-url',
        validated: false,
        confidence: 0,
        error: 'URL inválida',
      };
    }

    // Verificar cache
    const cached = this.cache.get(url);
    if (cached) {
      console.log(`✓ Resultado obtido do cache`);
      return cached;
    }

    try {
      // Estratégia 1: Scraping direto
      console.log('📄 Estratégia 1: Scraping do site...');
      let result = await this.scrapeSinglePage(url);
      if (result.cnpj) {
        result.source = 'scraping-primary';
        this.cache.set(url, result);
        return result;
      }

      // Estratégia 2: Buscar em páginas comuns
      console.log('📂 Estratégia 2: Varrendo páginas comuns...');
      result = await this.scrapeCommonPaths(url);
      if (result.cnpj) {
        result.source = 'scraping-secondary';
        this.cache.set(url, result);
        return result;
      }

      // Estratégia 3: Extrair conteúdo de footer
      console.log('👣 Estratégia 3: Buscando em footer...');
      result = await this.scrapeFooter(url);
      if (result.cnpj) {
        result.source = 'scraping-footer';
        this.cache.set(url, result);
        return result;
      }

      // Estratégia 4: IA como fallback (se habilitada)
      if (this.useAI) {
        console.log('🤖 Estratégia 4: Usando IA (fallback)...');
        result = await this.extractViaAI(url);
        if (result.cnpj) {
          result.source = 'ai-fallback';
          this.cache.set(url, result);
          return result;
        }
      }

      // Nenhuma estratégia funcionou
      console.log('❌ Nenhum CNPJ encontrado');
      const noResult = {
        cnpj: null,
        score: 0,
        source: 'not-found',
        validated: false,
        confidence: 0,
      };
      this.cache.set(url, noResult);
      return noResult;
    } catch (error) {
      console.error(`❌ Erro durante extração: ${error.message}`);
      return {
        cnpj: null,
        score: 0,
        source: 'error',
        validated: false,
        confidence: 0,
        error: error.message,
      };
    }
  }

  /**
   * Scraping de página única
   */
  async scrapeSinglePage(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) {
        return { cnpj: null, confidence: 0 };
      }

      const $ = cheerio.load(html);
      
      // 1. Procurar em atributos de dados
      const fromAttributes = this.extractFromAttributes($);
      if (fromAttributes) {
        return {
          cnpj: fromAttributes,
          confidence: 0.95,
          validated: this.validateCNPJ(fromAttributes),
        };
      }

      // 2. Procurar em texto de footer
      const footerText = $('footer').text() + ' ' + $('[role="contentinfo"]').text();
      const fromFooter = this.extractCNPJFromText(footerText);
      if (fromFooter) {
        return {
          cnpj: fromFooter,
          confidence: 0.9,
          validated: this.validateCNPJ(fromFooter),
        };
      }

      // 3. Procurar em todo o HTML
      const fromHTML = this.extractCNPJFromText(html);
      if (fromHTML) {
        return {
          cnpj: fromHTML,
          confidence: 0.7,
          validated: this.validateCNPJ(fromHTML),
        };
      }

      return { cnpj: null, confidence: 0 };
    } catch (error) {
      console.error(`Erro ao fazer scraping de ${url}: ${error.message}`);
      return { cnpj: null, confidence: 0 };
    }
  }

  /**
   * Varrer páginas comuns
   */
  async scrapeCommonPaths(url) {
    const baseUrl = this.getBaseUrl(url);
    
    for (const path of COMMON_PATHS) {
      try {
        const fullUrl = baseUrl + path;
        console.log(`  ↳ Verificando: ${path}`);
        
        const html = await this.fetchPage(fullUrl);
        if (!html) continue;

        const cnpj = this.extractCNPJFromText(html);
        if (cnpj && this.validateCNPJ(cnpj)) {
          return {
            cnpj,
            confidence: 0.85,
            validated: true,
            path,
          };
        }
      } catch (error) {
        // Continua para próxima página
        continue;
      }
    }

    return { cnpj: null, confidence: 0 };
  }

  /**
   * Extração específica de footer
   */
  async scrapeFooter(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) {
        return { cnpj: null, confidence: 0 };
      }

      const $ = cheerio.load(html);
      
      // Estratégias de footer
      const footerStrategies = [
        $('footer').html(),
        $('[role="contentinfo"]').html(),
        $('div[class*="footer"]').html(),
        $('div[class*="rodape"]').html(),
      ];

      for (const footerHtml of footerStrategies) {
        if (!footerHtml) continue;
        
        const cnpj = this.extractCNPJFromText(footerHtml);
        if (cnpj && this.validateCNPJ(cnpj)) {
          return {
            cnpj,
            confidence: 0.88,
            validated: true,
          };
        }
      }

      return { cnpj: null, confidence: 0 };
    } catch (error) {
      return { cnpj: null, confidence: 0 };
    }
  }

  /**
   * Extração via IA (Gemini)
   */
  async extractViaAI(url) {
    if (!this.useAI || !this.gemini) {
      return { cnpj: null, confidence: 0 };
    }

    try {
      // Fetch da página
      const html = await this.fetchPage(url);
      if (!html) {
        return { cnpj: null, confidence: 0 };
      }

      // Preparar texto para IA
      const $ = cheerio.load(html);
      const text = $('body').text().slice(0, 3000); // Limitar tamanho

      // Prompt específico
      const prompt = `Você é um especialista em extração de dados. Analise o conteúdo do site e extraia apenas o CNPJ da empresa.

IMPORTANTE:
- Retorne APENAS o CNPJ no formato XX.XXX.XXX/XXXX-XX
- Se não encontrar um CNPJ válido, retorne: "CNPJ_NAO_ENCONTRADO"
- Não alucine ou invente CNPJs
- O CNPJ deve ser da empresa proprietária do site

Conteúdo do site:
${text}

Responda com apenas o CNPJ ou "CNPJ_NAO_ENCONTRADO":`;

      const model = this.gemini.getGenerativeModel({ model: 'gemini-pro' });
      const response = await model.generateContent(prompt);
      const aiResponse = response.response.text().trim();

      // Validar resposta
      if (aiResponse === 'CNPJ_NAO_ENCONTRADO' || !aiResponse) {
        return { cnpj: null, confidence: 0 };
      }

      const cnpj = this.normalizeCNPJ(aiResponse);
      
      if (cnpj && this.validateCNPJ(cnpj)) {
        return {
          cnpj,
          confidence: 0.6, // Menor confiança para IA
          validated: true,
        };
      }

      return { cnpj: null, confidence: 0 };
    } catch (error) {
      console.error(`Erro ao usar IA: ${error.message}`);
      return { cnpj: null, confidence: 0 };
    }
  }

  /**
   * Fetch de página com retry
   */
  async fetchPage(url, attempt = 1) {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        maxRedirects: 5,
      });

      return response.data;
    } catch (error) {
      if (attempt < this.maxRetries) {
        console.log(`  ⚠️ Tentativa ${attempt} falhou, retentando...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.fetchPage(url, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Extrair CNPJ de texto usando regex
   */
  extractCNPJFromText(text) {
    if (!text) return null;

    for (const pattern of CNPJ_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const normalized = this.normalizeCNPJ(match[0]);
        if (this.validateCNPJ(normalized)) {
          return normalized;
        }
      }
    }

    return null;
  }

  /**
   * Extrair CNPJ de atributos HTML
   */
  extractFromAttributes($) {
    for (const selector of CNPJ_SELECTORS) {
      try {
        const element = $(selector);
        if (element.length === 0) continue;

        const content = element.attr('data-cnpj') ||
                       element.text() ||
                       element.html();

        if (content) {
          const cnpj = this.extractCNPJFromText(content);
          if (cnpj) {
            return cnpj;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Normalizar CNPJ para formato padrão
   */
  normalizeCNPJ(cnpj) {
    if (!cnpj) return null;
    
    // Remover caracteres não numéricos
    const digits = cnpj.replace(/\D/g, '');
    
    // Validar tamanho
    if (digits.length !== 14) {
      return null;
    }

    // Formatar: XX.XXX.XXX/XXXX-XX
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  /**
   * Validar CNPJ usando algoritmo de checksum
   */
  validateCNPJ(cnpj) {
    if (!cnpj) return false;

    // Normalizar
    const digits = cnpj.replace(/\D/g, '');

    // Deve ter 14 dígitos
    if (digits.length !== 14) {
      return false;
    }

    // Rejeitar sequências repetidas
    if (/^(\d)\1{13}$/.test(digits)) {
      return false;
    }

    // Validar primeiro dígito verificador
    let sum = 0;
    let multiplier = 5;
    
    for (let i = 0; i < 8; i++) {
      sum += parseInt(digits[i]) * multiplier;
      multiplier = multiplier === 2 ? 9 : multiplier - 1;
    }
    
    let remainder = sum % 11;
    let firstDigit = remainder < 2 ? 0 : 11 - remainder;

    if (parseInt(digits[8]) !== firstDigit) {
      return false;
    }

    // Validar segundo dígito verificador
    sum = 0;
    multiplier = 6;
    
    for (let i = 0; i < 9; i++) {
      sum += parseInt(digits[i]) * multiplier;
      multiplier = multiplier === 2 ? 9 : multiplier - 1;
    }
    
    remainder = sum % 11;
    let secondDigit = remainder < 2 ? 0 : 11 - remainder;

    return parseInt(digits[9]) === secondDigit;
  }

  /**
   * Validar URL
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Obter URL base
   */
  getBaseUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch (error) {
      return url;
    }
  }

  /**
   * Limpar cache
   */
  clearCache() {
    this.cache.clear();
    console.log('✓ Cache limpo');
  }

  /**
   * Estatísticas de cache
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([url, result]) => ({
        url,
        cnpj: result.cnpj,
        source: result.source,
        confidence: result.confidence,
      })),
    };
  }
}

export default CNPJExtractor;
