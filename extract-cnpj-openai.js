/**
 * Extração de CNPJ com Scraping + OpenAI ChatGPT
 * 
 * Lógica:
 * 1. Tentar scraping (HTML + regex)
 * 2. Se não encontrar, usar OpenAI
 * 3. Validar resultado
 * 4. Retornar no formato XX.XXX.XXX/XXXX-XX
 * 
 * Instalação:
 * npm install axios openai dotenv
 */

import axios from 'axios';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Inicializar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Regex para detectar CNPJ em texto
 */
const CNPJ_PATTERNS = [
  /\b(\d{2})[\.\s]?(\d{3})[\.\s]?(\d{3})[\/\s]?(\d{4})[-\s]?(\d{2})\b/g,
  /\bCNPJ[\s:]*(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})\b/gi,
  /\b(\d{14})\b/g,
];

/**
 * Normalizar CNPJ para formato padrão XX.XXX.XXX/XXXX-XX
 */
function normalizeCNPJ(cnpj) {
  if (!cnpj) return null;
  
  // Remover caracteres não numéricos
  const digits = cnpj.replace(/\D/g, '');
  
  // Validar se tem 14 dígitos
  if (digits.length !== 14) {
    return null;
  }

  // Formatar: XX.XXX.XXX/XXXX-XX
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Validar CNPJ usando algoritmo de checksum
 */
function validateCNPJ(cnpj) {
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
 * Extrair CNPJ do HTML usando regex
 */
function extractCNPJFromHTML(html) {
  if (!html) return null;

  for (const pattern of CNPJ_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      for (const cnpjMatch of match) {
        const normalized = normalizeCNPJ(cnpjMatch);
        if (normalized && validateCNPJ(normalized)) {
          return normalized;
        }
      }
    }
  }

  return null;
}

/**
 * Fazer scraping da página
 */
async function scrapePage(url, timeout = 10000) {
  try {
    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Erro ao fazer scraping de ${url}:`, error.message);
    return null;
  }
}

/**
 * Usar OpenAI ChatGPT para extrair CNPJ
 */
async function extractCNPJViaOpenAI(url) {
  try {
    console.log('🤖 Consultando OpenAI...');

    const message = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Você é um especialista em extração de dados corporativos brasileiros.
Sua tarefa é identificar o CNPJ de uma empresa a partir de sua URL.

INSTRUÇÕES CRÍTICAS:
- Retorne APENAS o CNPJ no formato: XX.XXX.XXX/XXXX-XX
- Se não tiver certeza, retorne: "CNPJ_NAO_ENCONTRADO"
- NUNCA invente ou alucine CNPJs
- O CNPJ deve ser da empresa proprietária do domínio
- Não retorne outros números que possam parecer CNPJ`,
        },
        {
          role: 'user',
          content: `Qual é o CNPJ da empresa deste domínio: ${url}?
Retorne apenas o CNPJ ou "CNPJ_NAO_ENCONTRADO".`,
        },
      ],
      max_tokens: 50,
      temperature: 0,
    });

    const response = message.choices[0].message.content.trim();

    // Validar resposta
    if (response === 'CNPJ_NAO_ENCONTRADO' || response.length === 0) {
      return null;
    }

    // Extrair CNPJ usando regex
    const cnpjMatch = response.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/);
    if (!cnpjMatch) {
      return null;
    }

    return normalizeCNPJ(cnpjMatch[0]);
  } catch (error) {
    console.error('Erro ao usar OpenAI:', error.message);
    return null;
  }
}

/**
 * Função principal: Extrair CNPJ da URL
 * 
 * @param {string} url - URL da empresa
 * @returns {Promise<string|null>} CNPJ no formato XX.XXX.XXX/XXXX-XX ou null
 */
export async function extractCnpjFromUrl(url) {
  console.log(`\n🔍 Extraindo CNPJ de: ${url}`);

  // Validar URL
  try {
    new URL(url);
  } catch (error) {
    console.log('❌ URL inválida');
    return null;
  }

  // Estratégia 1: Scraping
  console.log('📄 Tentando scraping...');
  const html = await scrapePage(url);
  
  if (html) {
    const cnpjFromHTML = extractCNPJFromHTML(html);
    if (cnpjFromHTML && validateCNPJ(cnpjFromHTML)) {
      console.log(`✅ CNPJ encontrado via scraping: ${cnpjFromHTML}`);
      return cnpjFromHTML;
    }
  }

  // Estratégia 2: OpenAI como fallback
  console.log('🤖 Scraping falhou, tentando OpenAI...');
  const cnpjFromAI = await extractCNPJViaOpenAI(url);
  
  if (cnpjFromAI && validateCNPJ(cnpjFromAI)) {
    console.log(`✅ CNPJ encontrado via OpenAI: ${cnpjFromAI}`);
    return cnpjFromAI;
  }

  console.log('❌ Não foi possível encontrar o CNPJ');
  return null;
}

/**
 * Validar CNPJ (função exposta)
 */
export function isValidCNPJ(cnpj) {
  return validateCNPJ(cnpj);
}

/**
 * Normalizar CNPJ (função exposta)
 */
export function normalizeCNPJExport(cnpj) {
  return normalizeCNPJ(cnpj);
}

// Exportar para uso direto
export default extractCnpjFromUrl;
