/**
 * Servidor Express.js com API de Extração de CNPJ
 * Production-ready com logging, validação e rate limiting
 * 
 * Instalação:
 * npm install express cors dotenv morgan express-rate-limit axios cheerio
 * 
 * Execução:
 * node server-extract-cnpj.js
 */

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import CNPJExtractor from './extract-cnpj.js';

dotenv.config();

// ============================================
// INICIALIZAÇÃO
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar extrator
const extractor = new CNPJExtractor({
  apiKey: process.env.GEMINI_API_KEY,
  useAI: process.env.USE_AI !== 'false',
  timeout: parseInt(process.env.TIMEOUT || '15000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
});

console.log(`\n${'═'.repeat(60)}`);
console.log('🚀 Servidor de Extração de CNPJ');
console.log('═'.repeat(60));
console.log(`  Porta: ${PORT}`);
console.log(`  IA Habilitada: ${extractor.useAI ? '✓ Sim' : '✗ Não'}`);
console.log(`  Timeout: ${extractor.timeout}ms`);
console.log(`  Max Retries: ${extractor.maxRetries}`);
console.log('═'.repeat(60) + '\n');

// ============================================
// MIDDLEWARE
// ============================================

// Logging
app.use(morgan('combined'));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// JSON Parser
app.use(express.json({ limit: '10mb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT || '100'),
  message: 'Muitas requisições desta IP, tente novamente mais tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

const batchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: parseInt(process.env.BATCH_LIMIT || '10'),
  message: 'Limite de requisições em lote atingido.',
});

app.use('/api/', limiter);
app.use('/api/extract-cnpj/batch', batchLimiter);

// ============================================
// ROTAS
// ============================================

/**
 * Health Check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ai_enabled: extractor.useAI,
  });
});

/**
 * Informações do Servidor
 */
app.get('/api/info', (req, res) => {
  res.json({
    name: 'CNPJ Extractor API',
    version: '1.0.0',
    description: 'API robusta para extração de CNPJ de URLs',
    endpoints: {
      single: 'POST /api/extract-cnpj',
      batch: 'POST /api/extract-cnpj/batch',
      cache_stats: 'GET /api/extract-cnpj/cache',
      cache_clear: 'DELETE /api/extract-cnpj/cache',
    },
    features: [
      'Scraping inteligente em 4 camadas',
      'Validação de CNPJ com checksum',
      'Fallback com IA (Gemini)',
      'Cache automático',
      'Rate limiting',
      'Retry automático',
    ],
  });
});

/**
 * POST /api/extract-cnpj
 * Extrair CNPJ de uma única URL
 */
app.post('/api/extract-cnpj', async (req, res) => {
  try {
    const { url, validate_only = false } = req.body;

    // Validação de entrada
    if (!url) {
      return res.status(400).json({
        error: 'Campo "url" é obrigatório',
        example: { url: 'https://empresa.com.br' },
      });
    }

    if (typeof url !== 'string') {
      return res.status(400).json({
        error: 'Campo "url" deve ser uma string',
      });
    }

    // Validar URL
    if (!extractor.isValidUrl(url)) {
      return res.status(400).json({
        error: 'URL inválida',
        url,
      });
    }

    // Se apenas validação, retornar antes de fazer scraping
    if (validate_only) {
      return res.json({
        url,
        is_valid: true,
        validated_at: new Date().toISOString(),
      });
    }

    // Extrair CNPJ
    const result = await extractor.extract(url);

    res.json({
      url,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Erro em /api/extract-cnpj: ${error.message}`);
    res.status(500).json({
      error: 'Erro ao processar requisição',
      message: error.message,
    });
  }
});

/**
 * POST /api/extract-cnpj/batch
 * Extrair CNPJ de múltiplas URLs
 */
app.post('/api/extract-cnpj/batch', async (req, res) => {
  try {
    const { urls, delay = 500 } = req.body;

    // Validação
    if (!Array.isArray(urls)) {
      return res.status(400).json({
        error: 'Campo "urls" deve ser um array',
        example: { urls: ['https://...', 'https://...'] },
      });
    }

    if (urls.length === 0) {
      return res.status(400).json({
        error: 'Array "urls" não pode estar vazio',
      });
    }

    if (urls.length > 50) {
      return res.status(413).json({
        error: 'Máximo de 50 URLs por requisição',
        received: urls.length,
      });
    }

    // Validar que todos são strings
    if (!urls.every(u => typeof u === 'string')) {
      return res.status(400).json({
        error: 'Todas as URLs devem ser strings',
      });
    }

    console.log(`📦 Iniciando processamento em lote: ${urls.length} URLs`);

    const results = [];
    const errors = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        // Validar URL
        if (!extractor.isValidUrl(url)) {
          errors.push({
            url,
            error: 'URL inválida',
            index: i,
          });
          continue;
        }

        // Extrair CNPJ
        const result = await extractor.extract(url);
        results.push({
          url,
          index: i,
          ...result,
        });

        console.log(`  ✓ [${i + 1}/${urls.length}] ${url}: ${result.cnpj || 'N/A'}`);

        // Delay entre requisições
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        console.error(`  ✗ [${i + 1}/${urls.length}] ${url}: ${error.message}`);
        
        errors.push({
          url,
          error: error.message,
          index: i,
        });
      }
    }

    // Compilar resultado
    const successCount = results.filter(r => r.cnpj).length;
    const failureCount = urls.length - successCount;

    res.json({
      batch_id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      total_urls: urls.length,
      successful: successCount,
      failed: failureCount,
      processing_time_ms: process.uptime() * 1000,
      results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });

    console.log(`✓ Lote concluído: ${successCount} sucesso(s), ${failureCount} falha(s)\n`);
  } catch (error) {
    console.error(`Erro em /api/extract-cnpj/batch: ${error.message}`);
    res.status(500).json({
      error: 'Erro ao processar lote',
      message: error.message,
    });
  }
});

/**
 * GET /api/extract-cnpj/cache
 * Obter estatísticas de cache
 */
app.get('/api/extract-cnpj/cache', (req, res) => {
  const stats = extractor.getCacheStats();
  
  res.json({
    cache_size: stats.size,
    cache_entries: stats.entries,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /api/extract-cnpj/cache
 * Limpar cache
 */
app.delete('/api/extract-cnpj/cache', (req, res) => {
  extractor.clearCache();
  
  res.json({
    message: 'Cache limpo com sucesso',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Validar CNPJ (apenas validação local, sem scraping)
 */
app.post('/api/validate-cnpj', (req, res) => {
  try {
    const { cnpj } = req.body;

    if (!cnpj) {
      return res.status(400).json({
        error: 'Campo "cnpj" é obrigatório',
      });
    }

    const isValid = extractor.validateCNPJ(cnpj);
    const normalized = extractor.normalizeCNPJ(cnpj);

    res.json({
      cnpj_input: cnpj,
      cnpj_normalized: normalized,
      is_valid: isValid,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao validar CNPJ',
      message: error.message,
    });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

/**
 * 404 - Rota não encontrada
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.path,
    method: req.method,
    available_endpoints: [
      'GET /health',
      'GET /api/info',
      'POST /api/extract-cnpj',
      'POST /api/extract-cnpj/batch',
      'POST /api/validate-cnpj',
      'GET /api/extract-cnpj/cache',
      'DELETE /api/extract-cnpj/cache',
    ],
  });
});

/**
 * Error handler global
 */
app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error);
  
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const server = app.listen(PORT, () => {
  console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
  console.log(`\nEndpoints disponíveis:`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/api/info`);
  console.log(`  POST http://localhost:${PORT}/api/extract-cnpj`);
  console.log(`  POST http://localhost:${PORT}/api/extract-cnpj/batch`);
  console.log(`  GET  http://localhost:${PORT}/api/extract-cnpj/cache`);
  console.log(`\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n📛 SIGTERM recebido, encerrando...');
  server.close(() => {
    console.log('✓ Servidor encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n⏹️  Interrupção do usuário');
  server.close(() => {
    console.log('✓ Servidor encerrado');
    process.exit(0);
  });
});

export { app, extractor };
