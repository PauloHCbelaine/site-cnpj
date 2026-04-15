/**
 * Integração com Projetos Existentes
 * 
 * Exemplos de como integrar a extração de CNPJ em diferentes tipos de projetos
 */

// ═══════════════════════════════════════════════════════════════
// 1️⃣ INTEGRAÇÃO COM EXPRESS.JS
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import { extractCnpjFromUrl, isValidCNPJ } from './extract-cnpj-openai.js';

const app = express();
app.use(express.json());

// Endpoint para extrair CNPJ
app.post('/api/extract-cnpj', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL é obrigatória' });
    }

    const cnpj = await extractCnpjFromUrl(url);

    res.json({
      url,
      cnpj,
      found: !!cnpj,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para validar CNPJ
app.post('/api/validate-cnpj', (req, res) => {
  try {
    const { cnpj } = req.body;

    if (!cnpj) {
      return res.status(400).json({ error: 'CNPJ é obrigatório' });
    }

    const isValid = isValidCNPJ(cnpj);

    res.json({
      cnpj,
      valid: isValid,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// app.listen(3000, () => console.log('API rodando em http://localhost:3000'));

// ═══════════════════════════════════════════════════════════════
// 2️⃣ INTEGRAÇÃO COM NEXT.JS (API Routes)
// ═══════════════════════════════════════════════════════════════

/*
// pages/api/extract-cnpj.js
import { extractCnpjFromUrl, isValidCNPJ } from '@/lib/extract-cnpj-openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL é obrigatória' });
    }

    const cnpj = await extractCnpjFromUrl(url);

    res.status(200).json({
      url,
      cnpj,
      found: !!cnpj,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
*/

// ═══════════════════════════════════════════════════════════════
// 3️⃣ INTEGRAÇÃO COM FASTAPI (Python)
// ═══════════════════════════════════════════════════════════════

/*
# Chamar a API Node.js do Python
import requests

response = requests.post('http://localhost:3000/api/extract-cnpj', json={
    'url': 'https://www.google.com'
})

data = response.json()
print(f"CNPJ: {data['cnpj']}")
*/

// ═══════════════════════════════════════════════════════════════
// 4️⃣ PROCESSAMENTO EM LOTE (CSV/JSON)
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import { parse } from 'csv-parse/sync';

async function processBatchFromCSV(csvPath) {
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, { columns: true });

  const results = [];

  for (const record of records) {
    const url = record.url;

    try {
      console.log(`🔍 Processando: ${url}`);
      const cnpj = await extractCnpjFromUrl(url);

      results.push({
        url,
        cnpj: cnpj || 'Não encontrado',
        status: cnpj ? 'sucesso' : 'falhou',
      });

      // Aguardar 2 segundos entre requisições
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      results.push({
        url,
        cnpj: null,
        status: 'erro',
        error: error.message,
      });
    }
  }

  // Salvar resultados
  const outputPath = csvPath.replace('.csv', '-resultados.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`\n✅ Processamento concluído! Resultados em: ${outputPath}`);
  return results;
}

// Uso: await processBatchFromCSV('empresas.csv');

// ═══════════════════════════════════════════════════════════════
// 5️⃣ COM CACHE E QUEUE (Redis)
// ═══════════════════════════════════════════════════════════════

/*
import Redis from 'ioredis';
import { extractCnpjFromUrl } from './extract-cnpj-openai.js';

const redis = new Redis();
const CACHE_TTL = 86400; // 24 horas

async function extractWithCache(url) {
  // Verificar cache
  const cached = await redis.get(`cnpj:${url}`);
  if (cached) {
    console.log('✅ Retornando do cache');
    return JSON.parse(cached);
  }

  // Extrair
  const cnpj = await extractCnpjFromUrl(url);

  // Salvar em cache
  if (cnpj) {
    await redis.setex(`cnpj:${url}`, CACHE_TTL, JSON.stringify(cnpj));
  }

  return cnpj;
}
*/

// ═══════════════════════════════════════════════════════════════
// 6️⃣ COM WORKER THREADS (Processamento paralelo)
// ═══════════════════════════════════════════════════════════════

/*
import { Worker } from 'worker_threads';
import path from 'path';

async function extractInWorker(url) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker-extract-cnpj.js');

    worker.on('message', (cnpj) => {
      resolve(cnpj);
      worker.terminate();
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker parou com código ${code}`));
      }
    });

    worker.postMessage({ url });
  });
}

// Uso:
// const cnpj = await extractInWorker('https://www.google.com');
*/

// ═══════════════════════════════════════════════════════════════
// 7️⃣ COM RATE LIMITING (evitar abuse)
// ═══════════════════════════════════════════════════════════════

import PQueue from 'p-queue';

const queue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1, // 1 requisição por segundo
});

async function extractWithRateLimit(url) {
  return queue.add(() => extractCnpjFromUrl(url));
}

// Uso:
// const cnpj = await extractWithRateLimit('https://www.google.com');

// ═══════════════════════════════════════════════════════════════
// 8️⃣ COM RETRY AUTOMÁTICO (resiliência)
// ═══════════════════════════════════════════════════════════════

async function extractWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Tentativa ${attempt}/${maxRetries}...`);
      const cnpj = await extractCnpjFromUrl(url);

      if (cnpj) {
        return cnpj;
      }
    } catch (error) {
      console.error(`Erro na tentativa ${attempt}: ${error.message}`);

      if (attempt < maxRetries) {
        // Aguardar antes de tentar novamente (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏳ Aguardando ${delay}ms antes de tentar novamente...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// 9️⃣ COM LOGGING E MONITORING
// ═══════════════════════════════════════════════════════════════

import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'extract-cnpj.log' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

async function extractWithLogging(url) {
  const startTime = Date.now();

  try {
    logger.info(`Iniciando extração: ${url}`);

    const cnpj = await extractCnpjFromUrl(url);
    const duration = Date.now() - startTime;

    if (cnpj) {
      logger.info(`Sucesso em ${duration}ms: ${url} -> ${cnpj}`);
    } else {
      logger.warn(`Não encontrado em ${duration}ms: ${url}`);
    }

    return cnpj;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Erro em ${duration}ms: ${url} - ${error.message}`);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔟 EXEMPLO COMPLETO COM TUDO JUNTO
// ═══════════════════════════════════════════════════════════════

async function completExample() {
  // 1. Extrair com retry + rate limit
  const cnpj = await extractWithRateLimit('https://www.google.com');

  // 2. Validar resultado
  if (!cnpj || !isValidCNPJ(cnpj)) {
    console.log('❌ CNPJ inválido');
    return null;
  }

  // 3. Log do resultado
  console.log(`✅ CNPJ válido: ${cnpj}`);

  // 4. Salvar em banco de dados (exemplo)
  // await saveToDatabase({ url, cnpj });

  return cnpj;
}

export {
  processBatchFromCSV,
  extractWithRateLimit,
  extractWithRetry,
  extractWithLogging,
  completExample,
};
