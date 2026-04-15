/**
 * Testes unitários para CNPJExtractor
 * 
 * Executar com: npm test
 * Ou: node tests-extract-cnpj.js
 */

import CNPJExtractor from './extract-cnpj.js';

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Função auxiliar para testes
 */
function assert(condition, message) {
  if (condition) {
    console.log(`  ${colors.green}✓${colors.reset} ${message}`);
    testsPassed++;
  } else {
    console.log(`  ${colors.red}✗${colors.reset} ${message}`);
    testsFailed++;
  }
}

/**
 * Suite de testes
 */
function testSuite(name, tests) {
  console.log(`\n${colors.cyan}${colors.bold}${name}${colors.reset}`);
  console.log('─'.repeat(60));
  tests();
}

/**
 * Execução dos testes
 */
async function runAllTests() {
  const extractor = new CNPJExtractor({
    useAI: false, // Desabilitar IA para testes rápidos
  });

  console.log(`\n${colors.bold}🧪 SUITE DE TESTES - CNPJExtractor${colors.reset}\n`);

  // ========== TESTES DE VALIDAÇÃO ==========
  testSuite('Validação de CNPJ', () => {
    // CNPJs válidos
    assert(
      extractor.validateCNPJ('11.222.333/0001-81'),
      'CNPJ válido formatado'
    );
    assert(
      extractor.validateCNPJ('11222333000181'),
      'CNPJ válido sem formatação'
    );
    assert(
      extractor.validateCNPJ('11.222.333/0001-81'),
      'CNPJ válido com pontos e barra'
    );

    // CNPJs inválidos
    assert(
      !extractor.validateCNPJ('11.111.111/1111-11'),
      'Rejeita sequências repetidas'
    );
    assert(
      !extractor.validateCNPJ('11.222.333/0001-82'),
      'Rejeita checksum inválido'
    );
    assert(
      !extractor.validateCNPJ('123'),
      'Rejeita CNPJ incompleto'
    );
    assert(
      !extractor.validateCNPJ(''),
      'Rejeita CNPJ vazio'
    );
    assert(
      !extractor.validateCNPJ(null),
      'Rejeita CNPJ nulo'
    );
    assert(
      !extractor.validateCNPJ('12.345.678/9012-34'),
      'Rejeita CNPJ inválido arbitrário'
    );
  });

  // ========== TESTES DE NORMALIZAÇÃO ==========
  testSuite('Normalização de CNPJ', () => {
    assert(
      extractor.normalizeCNPJ('11222333000181') === '11.222.333/0001-81',
      'Normaliza CNPJ sem formatação'
    );
    assert(
      extractor.normalizeCNPJ('11.222.333/0001-81') === '11.222.333/0001-81',
      'Mantém CNPJ já formatado'
    );
    assert(
      extractor.normalizeCNPJ('11-222-333-0001-81') === '11.222.333/0001-81',
      'Normaliza formatos variados'
    );
    assert(
      extractor.normalizeCNPJ('123') === null,
      'Retorna null para formato inválido'
    );
    assert(
      extractor.normalizeCNPJ('') === null,
      'Retorna null para entrada vazia'
    );
  });

  // ========== TESTES DE EXTRAÇÃO DE REGEX ==========
  testSuite('Extração de CNPJ (Regex)', () => {
    const html1 = 'A empresa tem CNPJ: 11.222.333/0001-81 conforme registro';
    assert(
      extractor.extractCNPJFromText(html1) === '11.222.333/0001-81',
      'Extrai CNPJ com prefixo'
    );

    const html2 = '<footer>CNPJ 11222333000181</footer>';
    const cnpj2 = extractor.extractCNPJFromText(html2);
    assert(
      cnpj2 === '11.222.333/0001-81',
      'Extrai CNPJ sem formatação'
    );

    const html3 = 'Sem CNPJ aqui';
    assert(
      extractor.extractCNPJFromText(html3) === null,
      'Retorna null quando não encontra'
    );

    const html4 = 'Múltiplos: 11.222.333/0001-81 e 11.222.333/0001-81';
    assert(
      extractor.extractCNPJFromText(html4) === '11.222.333/0001-81',
      'Retorna primeiro CNPJ válido'
    );

    const html5 = 'CNPJ inválido: 11.222.333/0001-82 (checksum errado)';
    assert(
      extractor.extractCNPJFromText(html5) === null,
      'Ignora CNPJ com checksum inválido'
    );
  });

  // ========== TESTES DE VALIDAÇÃO DE URL ==========
  testSuite('Validação de URL', () => {
    assert(
      extractor.isValidUrl('https://www.example.com'),
      'Aceita URL https válida'
    );
    assert(
      extractor.isValidUrl('http://example.com'),
      'Aceita URL http válida'
    );
    assert(
      extractor.isValidUrl('https://example.com.br/path?query=1'),
      'Aceita URL com path e query'
    );
    assert(
      !extractor.isValidUrl('invalid-url'),
      'Rejeita URL sem protocolo'
    );
    assert(
      !extractor.isValidUrl(''),
      'Rejeita URL vazia'
    );
    assert(
      !extractor.isValidUrl('ftp://example.com'),
      'Rejeita protocolos não-HTTP'
    );
  });

  // ========== TESTES DE EXTRAÇÃO DE URL BASE ==========
  testSuite('Extração de URL Base', () => {
    assert(
      extractor.getBaseUrl('https://example.com/path/page') === 'https://example.com',
      'Extrai base de URL com path'
    );
    assert(
      extractor.getBaseUrl('https://www.example.com:8080/') === 'https://www.example.com:8080',
      'Preserva porta'
    );
    assert(
      extractor.getBaseUrl('https://example.com') === 'https://example.com',
      'Mantém URL simples'
    );
  });

  // ========== TESTES DE CACHE ==========
  testSuite('Sistema de Cache', () => {
    extractor.clearCache();
    
    assert(
      extractor.getCacheStats().size === 0,
      'Cache inicia vazio'
    );

    // Simular inserção de dados no cache
    extractor.cache.set('https://example.com', {
      cnpj: '11.222.333/0001-81',
      source: 'test',
      confidence: 0.95,
    });

    assert(
      extractor.getCacheStats().size === 1,
      'Cache armazena dados'
    );

    const stats = extractor.getCacheStats();
    assert(
      stats.entries[0].url === 'https://example.com',
      'Cache retorna URL correta'
    );

    extractor.clearCache();
    assert(
      extractor.getCacheStats().size === 0,
      'Cache é limpo corretamente'
    );
  });

  // ========== TESTES DE CHECKSUM ==========
  testSuite('Algoritmo de Checksum', () => {
    // CNPJs com checksums conhecidos e validados
    const validCNPJs = [
      '11.222.333/0001-81',
      '34.028.316/0001-53',
      '27.865.757/0001-02',
    ];

    validCNPJs.forEach((cnpj, idx) => {
      assert(
        extractor.validateCNPJ(cnpj),
        `CNPJ válido ${idx + 1}: ${cnpj}`
      );
    });

    // Testar variação do último dígito (must fail)
    const testCNPJ = '11.222.333/0001-81';
    const invalidVariations = [
      '11.222.333/0001-80',
      '11.222.333/0001-82',
      '11.222.333/0001-83',
    ];

    invalidVariations.forEach((cnpj, idx) => {
      assert(
        !extractor.validateCNPJ(cnpj),
        `Rejeita variação inválida ${idx + 1}`
      );
    });
  });

  // ========== TESTES DE CASOS EXTREMOS ==========
  testSuite('Casos Extremos', () => {
    assert(
      !extractor.validateCNPJ('00.000.000/0000-00'),
      'Rejeita tudo zeros'
    );
    assert(
      !extractor.validateCNPJ('99.999.999/9999-99'),
      'Rejeita tudo noves'
    );
    assert(
      extractor.normalizeCNPJ('11 222 333 0001 81') === '11.222.333/0001-81',
      'Normaliza com espaços'
    );
    assert(
      extractor.normalizeCNPJ('11/222/333/0001/81') === '11.222.333/0001-81',
      'Normaliza com múltiplas barras'
    );
  });

  // ========== RESUMO ==========
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n${colors.bold}📊 RESUMO DOS TESTES${colors.reset}\n`);

  const totalTests = testsPassed + testsFailed;
  const percentage = ((testsPassed / totalTests) * 100).toFixed(1);

  console.log(`  Total: ${totalTests} testes`);
  console.log(`  ${colors.green}Passou: ${testsPassed}${colors.reset}`);
  console.log(`  ${colors.red}Falhou: ${testsFailed}${colors.reset}`);
  console.log(`  Taxa de sucesso: ${percentage}%`);

  if (testsFailed === 0) {
    console.log(`\n  ${colors.green}${colors.bold}✓ Todos os testes passaram!${colors.reset}\n`);
  } else {
    console.log(`\n  ${colors.red}${colors.bold}✗ Alguns testes falharam${colors.reset}\n`);
  }

  console.log('═'.repeat(60));
}

// Executar testes
runAllTests().catch(console.error);
